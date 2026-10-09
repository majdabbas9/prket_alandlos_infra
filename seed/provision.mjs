// Seeds Cloudflare R2 (sample images) and D1 (users table + admin user).
// The bucket and database are created by Terraform (storage/). Run from GitHub Actions; see
// .github/workflows/provision-storage.yml.
//
// Required env:
//   CLOUDFLARE_API_TOKEN   token with Account > D1 Edit
//   D1_DATABASE_ID         output of the terraform job
//   CLOUDFLARE_ACCOUNT_ID
//   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY   R2 S3 credentials (object upload)
//   ADMIN_USERNAME / ADMIN_PASSWORD           credentials for the D1 admin user
// Optional env:
//   R2_BUCKET_NAME (default prket-andlos)
//   RESET_ADMIN_PASSWORD=true  overwrite the password if the user already exists
import { readdir, readFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

const env = (name, fallback) => {
  const v = process.env[name] || fallback;
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
};

const accountId = env('CLOUDFLARE_ACCOUNT_ID');
const apiToken = env('CLOUDFLARE_API_TOKEN');
const bucket = env('R2_BUCKET_NAME', 'prket-andlos');
const dbId = env('D1_DATABASE_ID');
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
  credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
});

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
const titleOf = (file) =>
  path.parse(file).name.replace(/^parquet-/, 'Parquet Design ').replace(/^showroom-/, 'Showroom Project ');

async function seedImages() {
  const files = (await readdir(imagesDir)).filter((f) => MIME[path.extname(f).toLowerCase()]).sort();
  const products = [];
  for (const file of files) {
    // Fixed keys -> re-runs overwrite instead of piling up duplicates.
    const key = `products/seed-${file}`;
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: await readFile(path.join(imagesDir, file)),
      ContentType: MIME[path.extname(file).toLowerCase()],
    }));
    console.log(`  uploaded ${key}`);
    products.push({
      id: `prod_seed_${path.parse(file).name}`,
      title: titleOf(file),
      price: 0,
      category: file.startsWith('showroom-') ? 'Projects' : 'Parquet',
      description: 'Sample item added by the provisioning workflow. Edit or delete it from the admin panel.',
      imageKey: key,
      dateOfUpload: new Date().toISOString(),
    });
  }
  return products;
}

// Only write products.json when it is missing/empty so live catalogue data is never clobbered.
async function seedProductsJson(products) {
  const key = 'products/products.json';
  try {
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const current = JSON.parse(await obj.Body.transformToString());
    if (Array.isArray(current) && current.length > 0) {
      return console.log(`${key} already has ${current.length} products; left untouched`);
    }
  } catch (e) {
    if (e.name !== 'NoSuchKey' && e.$metadata?.httpStatusCode !== 404) throw e;
  }
  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(products, null, 2),
    ContentType: 'application/json',
  }));
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
