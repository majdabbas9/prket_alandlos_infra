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

# Authenticates via CLOUDFLARE_API_TOKEN (needs Workers R2 Storage: Edit and D1: Edit).
provider "cloudflare" {}

variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID"
}

variable "r2_bucket_name" {
  type    = string
  default = "prket-andlos"
}

variable "d1_database_name" {
  type    = string
  default = "prket-andlos"
}

resource "cloudflare_r2_bucket" "assets" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
}

resource "cloudflare_d1_database" "main" {
  account_id = var.cloudflare_account_id
  name       = var.d1_database_name
}

output "r2_bucket_name" {
  value = cloudflare_r2_bucket.assets.name
}

output "d1_database_id" {
  value = cloudflare_d1_database.main.id
}
