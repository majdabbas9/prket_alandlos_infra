# R2 + D1 provisioning

`.github/workflows/provision-storage.yml` runs two jobs:

- **terraform** (`storage/`): creates the R2 bucket and D1 database, adopting them (import) if they already exist. State lives in the R2 bucket `TF_STATE_BUCKET` (default `prket-terraform-state`, created automatically).
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
| Secret | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | already used by terraform.yml |
| Secret | `ADMIN_USERNAME`, `ADMIN_PASSWORD` | D1 admin login |
| Variable | `CLOUDFLARE_ACCOUNT_ID` | already set |
| Variable (optional) | `R2_BUCKET_NAME`, `D1_DATABASE_NAME` | set `D1_DATABASE_NAME` to the existing prod DB's name, otherwise a new empty DB is created |

If a new D1 database is created, the job summary prints its id — put it in
`CLOUDFLARE_DATABASE_ID` in the backends' `.env`.
