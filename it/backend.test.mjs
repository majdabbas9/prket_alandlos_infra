// Integration tests for the deployed main backend (/api/* on the API Worker).
// Mostly read-only. The one write test creates a throwaway product (pointing at an image
// key that doesn't exist, so deleting it removes no real image), then deletes it again.
// That also covers the Backend -> auth.internal -> AdminBackend token check in the Worker.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, waitUntilReady, login, hasCredentials } from './lib.mjs';

const needsCredentials = { skip: !hasCredentials && 'ADMIN_USERNAME / ADMIN_PASSWORD not set' };

before(async () => {
  await waitUntilReady('GET', '/api/health', (res) => res.status === 200 && res.body?.status === 'ok');
});

test('health reports ok', async () => {
  const res = await request('GET', '/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.ok(!Number.isNaN(Date.parse(res.body.timestamp)));
});

test('unknown endpoint returns 404 JSON', async () => {
  const res = await request('GET', '/api/does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('lists products', async () => {
  const res = await request('GET', '/api/products');
  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.count, res.body.data.length);
  for (const p of res.body.data) {
    assert.equal(typeof p.id, 'string');
    assert.equal(typeof p.imageKey, 'string');
  }
});

test('paginates products', async () => {
  const res = await request('GET', '/api/products?page=1&limit=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.page, 1);
  assert.ok(res.body.data.length <= 1);
  assert.equal(res.body.totalPages, Math.ceil(res.body.total / 1));
});

test('unknown product id returns 404', async () => {
  const res = await request('GET', '/api/products/prod_it-does-not-exist');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

test('serves a product photo from R2', async (t) => {
  const { body } = await request('GET', '/api/products');
  const product = body.data.find((p) => p.imageKey?.startsWith('products/'));
  if (!product) return t.skip('no products with an image yet');

  const key = encodeURIComponent(product.thumbKey || product.imageKey);
  const res = await request('GET', `/api/products/photo?key=${key}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^image\//);
  assert.ok(res.body.byteLength > 0);

  // ETag round-trip: the Worker answers 304 for an unchanged image
  const etag = res.headers.get('etag');
  assert.ok(etag, 'photo response should carry an ETag');
  const cached = await request('GET', `/api/products/photo?key=${key}`, { headers: { 'If-None-Match': etag } });
  assert.equal(cached.status, 304);
});

test('missing product photo returns 404', async () => {
  const res = await request('GET', '/api/products/photo?key=products/it-does-not-exist.webp');
  assert.equal(res.status, 404);
  assert.equal(res.body.success, false);
});

for (const lang of ['en', 'ar', 'he']) {
  test(`store info (${lang})`, async () => {
    const res = await request('GET', `/api/info?lang=${lang}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(typeof res.body.data, 'object');
  });
}

test('unsupported info language returns 400', async () => {
  const res = await request('GET', '/api/info?lang=xx');
  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
});

for (const path of ['/api/homepage-image', '/api/logo']) {
  test(`${path} metadata and image`, async () => {
    const meta = await request('GET', `${path}?info=true`);
    assert.equal(meta.status, 200);
    assert.equal(meta.body.success, true);

    const img = await request('GET', path);
    assert.equal(img.status, 200);
    assert.match(img.headers.get('content-type'), /^image\//);
    assert.ok(img.body.byteLength > 0);
  });
}

test('writes are rejected without a token', async () => {
  const attempts = [
    ['POST', '/api/products', { title: 'it', imageKey: 'products/it.webp' }],
    ['PUT', '/api/products/prod_it-does-not-exist', { title: 'it' }],
    ['DELETE', '/api/products/prod_it-does-not-exist'],
    ['POST', '/api/info', { phone: '000' }],
  ];
  for (const [method, path, body] of attempts) {
    const res = await request(method, path, { body });
    assert.equal(res.status, 401, `${method} ${path}`);
  }
});

test('writes are rejected with an invalid token (validated by the admin backend)', async () => {
  // 401 (not 500) proves the backend reached the admin backend through auth.internal
  const res = await request('POST', '/api/info', { token: 'not-a-jwt', body: { phone: '000' } });
  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

let createdId;

after(async () => {
  // Clean up if the CRUD test failed midway
  if (!createdId) return;
  try {
    await request('DELETE', `/api/products/${createdId}`, { token: await login() });
  } catch (err) {
    console.error(`Failed to clean up test product ${createdId}: ${err.message}`);
  }
});

test('admin can create, update and delete a product', needsCredentials, async () => {
  const token = await login();
  const imageKey = `products/it-${Date.now()}-${Math.round(Math.random() * 1e9)}.webp`;

  const created = await request('POST', '/api/products', {
    token,
    body: { title: 'IT test product', price: 1, category: 'it-test', description: 'created by CI', imageKey },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  createdId = created.body.data.id;
  assert.equal(created.body.data.imageKey, imageKey);

  const fetched = await request('GET', `/api/products/${createdId}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.data.title, 'IT test product');

  const updated = await request('PUT', `/api/products/${createdId}`, { token, body: { price: 2 } });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.price, 2);
  assert.equal(updated.body.data.title, 'IT test product');

  const deleted = await request('DELETE', `/api/products/${createdId}`, { token });
  assert.equal(deleted.status, 200);
  createdId = undefined;

  const gone = await request('GET', `/api/products/${deleted.body.data.id}`);
  assert.equal(gone.status, 404);
});
