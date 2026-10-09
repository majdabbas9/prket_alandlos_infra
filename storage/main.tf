terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Remote state in R2. bucket/key/endpoint are supplied via -backend-config
  # (see .github/workflows/provision-storage.yml).
  backend "s3" {
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Authenticates via CLOUDFLARE_API_TOKEN (needs Workers R2 Storage: Edit).
# The D1 database is NOT managed here: it already exists in Cloudflare.
provider "cloudflare" {}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID"
}

variable "r2_bucket_name" {
  type    = string
  default = "prket-andlos"
}

variable "cloudflare_database_id" {
  type        = string
  description = "UUID of the existing D1 database (Cloudflare dashboard -> Storage & databases -> D1)"
}

resource "cloudflare_r2_bucket" "assets" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
}

output "r2_bucket_name" {
  value = cloudflare_r2_bucket.assets.name
}

output "cloudflare_database_id" {
  value = var.cloudflare_database_id
}
