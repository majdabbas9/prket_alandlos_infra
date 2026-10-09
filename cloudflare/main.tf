terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Remote state in Cloudflare R2 (S3-compatible). Partial config:
  # bucket/key/endpoint are supplied per-environment via
  # `terraform init -backend-config=...` (see README / GitHub Actions workflow).
  backend "s3" {
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Authenticates via the CLOUDFLARE_API_TOKEN environment variable.
# Do NOT reuse the D1-scoped token from .env — create a dedicated token with:
#   Zone > Zone > Read
#   Zone > DNS > Edit
#   Account > Cloudflare Pages > Edit
provider "cloudflare" {}

data "cloudflare_zone" "main" {
  name = var.zone_name
}
