# Cloudflare IaC (Terraform)

Provisions everything Cloudflare-side for the production split described in the
repo root `DEPLOYMENT.md`:

- 2 Cloudflare Pages projects (main site + admin panel), connected to GitHub,
  with build config, env vars, and custom domains
- 2 proxied A records: `api.<zone>` and `auth.<zone>` → VPS IP

**Runs in GitHub Actions** (`.github/workflows/terraform.yml`):

- PR touching `cloudflare/**` → `terraform plan` posted as a PR comment
- Merge to `master` (or manual dispatch) → `terraform apply`

Remote state lives in Cloudflare R2 via the S3 backend (partial config;
bucket/key/endpoint come from `-backend-config` at init time). R2 has no
S3-style lock (no DynamoDB), so the workflow uses a `concurrency` group to
serialize runs.

## One-time prerequisites

1. **Create the state bucket in R2** (dashboard or API): bucket name
   `prket-terraform-state` (any name works — set the repo Variable
   `TF_STATE_BUCKET` to match). This must exist before the first `init`.
2. **Cloudflare API token** with:
   - Zone → Zone → **Read**
   - Zone → DNS → **Edit**
   - Account → Cloudflare Pages → **Edit**
   Do NOT reuse the D1-scoped token from `../.env`.
3. **GitHub ↔ Cloudflare Pages connection** (OAuth, one-time). Dashboard →
   Workers & Pages → Create → Connect to GitHub → authorize the account.
   Pages project creation with a `github` source fails until this is done.
4. **GitHub repo configuration** — Settings → Secrets and variables → Actions:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `CLOUDFLARE_API_TOKEN` | token from step 2 |
   | Secret | `R2_ACCESS_KEY_ID` | = `ACCESS_KEY_ID` from `../.env` |
   | Secret | `R2_SECRET_ACCESS_KEY` | = `SECRET_ACCESS_KEY` from `../.env` |
   | Variable | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID |
   | Variable | `ZONE_NAME` | e.g. `YOURDOMAIN.com` |
   | Variable | `VPS_IP` | public IP of the API VPS |
   | Variable | `TF_STATE_BUCKET` | `prket-terraform-state` |

5. If `api`/`auth` DNS records already exist in the zone, import them first:
   `terraform import cloudflare_record.api <zone_id>/<record_id>` (same for
   `auth`) so Terraform adopts instead of creating duplicates.

## Not managed here (manual, one-time)

- Zone SSL mode: Dashboard → SSL/TLS → set **Flexible**. Intentionally left out
  of Terraform: `zone_settings_override` replaces ALL zone settings, which can
  silently reset unrelated configuration.

## Local usage (optional)

```bash
cd prket_alandlos_infra/cloudflare

export CLOUDFLARE_API_TOKEN=...      # same token
export AWS_ACCESS_KEY_ID=...         # R2 creds (state backend)
export AWS_SECRET_ACCESS_KEY=...
export TF_VAR_cloudflare_account_id=...
export TF_VAR_zone_name=...
export TF_VAR_vps_ip=...

terraform init \
  -backend-config="bucket=prket-terraform-state" \
  -backend-config="key=cloudflare/terraform.tfstate" \
  -backend-config="endpoints.s3=https://$TF_VAR_cloudflare_account_id.r2.cloudflarestorage.com"

terraform plan
```

After apply, `terraform output` prints the `*.pages.dev` URLs and custom domains.
