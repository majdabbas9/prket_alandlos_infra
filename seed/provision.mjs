// Seeds Cloudflare R2 (sample images + thumbnails) and D1 (users table + admin user).
// The bucket and database are created by Terraform (storage/). Run from GitHub Actions; see
// .github/workflows/provision.yml.
//
// Required env:
//   CLOUDFLARE_API_TOKEN   token with Account > D1 Edit
//   CLOUDFLARE_DATABASE_ID  UUID of the existing D1 database
//   CLOUDFLARE_ACCOUNT_ID
//   ACCESS_KEY_ID / SECRET_ACCESS_KEY   R2 S3 credentials (object upload)
//   ADMIN_USERNAME / ADMIN_PASSWORD           credentials for the D1 admin user
// Optional env:
//   R2_BUCKET_NAME (default prket-andlos)
//   RESET_ADMIN_PASSWORD=true  overwrite the password if the user already exists
import { readdir, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const env = (name, fallback) => {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

const accountId = env('CLOUDFLARE_ACCOUNT_ID');
const apiToken = env('CLOUDFLARE_API_TOKEN');
const bucket = env('R2_BUCKET_NAME', 'prket-andlos');
const dbId = env('CLOUDFLARE_DATABASE_ID');
const adminUser = env('ADMIN_USERNAME');
const adminPass = env('ADMIN_PASSWORD');
const resetPassword = process.env.RESET_ADMIN_PASSWORD === 'true';

const api = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
const imagesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'images');

async function cf(method, url, body) {
  const res = await fetch(`${api}${url}`, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.success !== false, data };
}

const fail = (what, r) => {
  throw new Error(`${what} failed (HTTP ${r.status}): ${JSON.stringify(r.data.errors ?? r.data)}`);
};

// ---------- R2 ----------
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env('ACCESS_KEY_ID'), secretAccessKey: env('SECRET_ACCESS_KEY') },
});

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const titleOf = (file) =>
  path.parse(file).name.replace(/^parquet-/, 'Parquet Design ').replace(/^showroom-/, 'Showroom Project ');

// Same variants the backend makes for admin uploads (prket_alandlos_backend/src/models/Product.js):
// a large image for the detail view and a thumbnail for product cards.
const LARGE_WIDTH = 1600;
const THUMB_WIDTH = 600;
const resizeImage = (input) => {
  const variant = (width, quality) =>
    sharp(input).rotate().resize({ width, withoutEnlargement: true }).webp({ quality }).toBuffer();
  return Promise.all([variant(LARGE_WIDTH, 82), variant(THUMB_WIDTH, 75)]);
};

const put = (Key, Body, ContentType) => s3.send(new PutObjectCommand({ Bucket: bucket, Key, Body, ContentType }));

async function seedImages() {
  const files = (await readdir(imagesDir)).filter((f) => MIME[path.extname(f).toLowerCase()]).sort();
  const products = [];
  for (const file of files) {
    // Fixed keys -> re-runs overwrite instead of piling up duplicates.
    const { name } = path.parse(file);
    const original = await readFile(path.join(imagesDir, file));
    let imageKey = `products/seed-${name}.webp`;
    let thumbKey = `products/seed-${name}-thumb.webp`;
    try {
      const [large, thumb] = await resizeImage(original);
      await Promise.all([put(imageKey, large, 'image/webp'), put(thumbKey, thumb, 'image/webp')]);
      console.log(`  uploaded ${imageKey} (${large.length} B) + ${thumbKey} (${thumb.length} B)`);
    } catch (e) {
      // Like the backend: an image sharp can't decode is stored as-is and used for both
      console.warn(`  could not resize ${file} (${e.message}); uploading original`);
      imageKey = thumbKey = `products/seed-${file}`;
      await put(imageKey, original, MIME[path.extname(file).toLowerCase()]);
      console.log(`  uploaded ${imageKey}`);
    }
    products.push({
      id: `prod_seed_${name}`,
      title: titleOf(file),
      price: 0,
      category: file.startsWith('showroom-') ? 'Projects' : 'Parquet',
      description: 'Sample item added by the provisioning workflow. Edit or delete it from the admin panel.',
      imageKey,
      thumbKey,
      dateOfUpload: new Date().toISOString(),
    });
  }
  return products;
}

// Writes products.json only when it is missing/empty so live catalogue data is never clobbered.
// In an existing catalogue, seed products still on their original upload (seeded before
// thumbnails existed) are pointed at the new variants; everything else is left as is.
async function seedProductsJson(products) {
  const key = 'products/products.json';
  let current = [];
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    current = JSON.parse(await obj.Body.transformToString());
  } catch (e) {
    if (e.name !== 'NoSuchKey' && e.$metadata?.httpStatusCode !== 404) throw e;
  }

  if (Array.isArray(current) && current.length > 0) {
    const seeded = new Map(products.map((p) => [p.id, p]));
    let updated = 0;
    for (const product of current) {
      const seed = seeded.get(product.id);
      if (seed && !product.thumbKey && product.imageKey?.startsWith('products/seed-')) {
        product.imageKey = seed.imageKey;
        product.thumbKey = seed.thumbKey;
        updated++;
      }
    }
    if (updated === 0) return console.log(`${key} already has ${current.length} products; left untouched`);
    await put(key, JSON.stringify(current, null, 2), 'application/json');
    return console.log(`${key}: added thumbnails to ${updated} seed products (backend cache refreshes on its next cold start)`);
  }

  await put(key, JSON.stringify(products, null, 2), 'application/json');
  console.log(`${key} written with ${products.length} seed products`);
}

// ---------- D1 ----------
async function seedDatabase() {
  const query = async (sql, params = []) => {
    const r = await cf('POST', `/d1/database/${dbId}/query`, { sql, params });
    if (!r.ok) fail('D1 query', r);
    return r.data.result[0].results;
  };

  // Same schema as prket_alandlos_admin_backend/src/scripts/init-db.ts
  await query(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'admin'
  )`);

  const hash = await bcrypt.hash(adminPass, 10);
  const existing = await query('SELECT id FROM users WHERE username = ?', [adminUser]);
  if (existing.length === 0) {
    await query('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [adminUser, hash, 'admin']);
    console.log(`Admin user "${adminUser}" created`);
  } else if (resetPassword) {
    await query('UPDATE users SET password_hash = ? WHERE username = ?', [hash, adminUser]);
    console.log(`Admin user "${adminUser}" password reset`);
  } else {
    console.log(`Admin user "${adminUser}" already exists; password unchanged (use reset_admin_password to override)`);
  }
}

// ---------- main ----------
console.log('== R2 ==');
await seedProductsJson(await seedImages());
console.log('== D1 ==');
await seedDatabase();

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `### Provisioned\n- R2 bucket: \`${bucket}\`\n- D1 database id: \`${dbId}\`\n- Admin user: \`${adminUser}\`\n\n`
  );
}
