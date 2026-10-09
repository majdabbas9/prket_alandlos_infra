# R2 provisioning + D1 seeding

`.github/workflows/provision.yml` runs two jobs:

- **terraform** (`storage/`): creates/adopts the R2 bucket. The D1 database is **not** managed by Terraform: it already exists and is referenced by `CLOUDFLARE_DATABASE_ID`. State lives in the R2 bucket `TF_STATE_BUCKET` (default `prket-terraform-state`), which you must create once by hand (the job fails if it is missing).
- **seed** (`provision.mjs`, idempotent, below).

2. Uploads every image in `seed/images/` to `products/seed-<name>` and writes
   `products/products.json` **only if it is missing or empty** (live data is never overwritten).
4. Creates the `users` table and the admin user from `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
   An existing user keeps its password unless the run is started manually with
   **reset_admin_password** ticked.
5. Fails the job if no images are found under `products/` in R2.

Triggers: push to `master` touching `seed/**`, or manual **Run workflow**.

## GitHub configuration (Settings → Secrets and variables → Actions)

| Kind | Name | Notes |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | needs **Account → D1 → Edit** and **Workers R2 Storage → Edit** (add to the Terraform token or create a second one) |
| Secret | `ACCESS_KEY_ID`, `SECRET_ACCESS_KEY` | same names as the backends' `.env`; R2 read/write key pair (also used by provision.yml) |
| Secret | `ADMIN_USERNAME`, `ADMIN_PASSWORD` | D1 admin login |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | already set |
| Variable | `CLOUDFLARE_DATABASE_ID` | **required** — UUID of the existing D1 database (same name and value as in the backends' `.env`) |
| Variable | `TF_STATE_BUCKET` | name of the pre-created state bucket (default `prket-terraform-state`) |
| Variable (optional) | `R2_BUCKET_NAME` | defaults to `prket-andlos` |
