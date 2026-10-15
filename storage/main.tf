terraform {
  required_version = ">= 1.5"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }

  # Remote state in R2. bucket/key/endpoint are supplied via -backend-config
  # (see .github/workflows/provision.yml).
  backend "s3" {
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
  }
}

# Authenticates via CLOUDFLARE_API_TOKEN (needs Workers R2 Storage: Edit, Workers KV Storage: Edit).
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

variable "kv_cache_title" {
  type        = string
  default     = "prket-alandlos-backend-cache"
  description = "Title of the backend's cache KV namespace; the backend repo's deploy finds it by this title"
}

variable "r2_public_domain" {
  type        = string
  default     = ""
  description = "Optional hostname (e.g. images.example.com) to serve the bucket publicly through Cloudflare's CDN. Must be in a zone on this account. Empty = bucket stays private."
}

variable "r2_public_zone_id" {
  type        = string
  default     = ""
  description = "Zone ID of r2_public_domain's zone (required when r2_public_domain is set)"
}

resource "cloudflare_r2_bucket" "assets" {
  account_id = var.cloudflare_account_id
  name       = var.r2_bucket_name
}

# Makes every object in the bucket publicly readable at https://<r2_public_domain>/<key>.
# Cloudflare creates the DNS record and certificate, and caches responses at the edge.
resource "cloudflare_r2_custom_domain" "assets" {
  count = var.r2_public_domain == "" ? 0 : 1

  account_id  = var.cloudflare_account_id
  bucket_name = cloudflare_r2_bucket.assets.name
  domain      = var.r2_public_domain
  zone_id     = var.r2_public_zone_id
  enabled     = true
  min_tls     = "1.2"
}

# The backend's cache (products, store info). Only a cache: R2 stays the source of truth, so
# the namespace can be emptied or recreated at any time.
resource "cloudflare_workers_kv_namespace" "cache" {
  account_id = var.cloudflare_account_id
  title      = var.kv_cache_title
}

output "r2_public_url" {
  value = var.r2_public_domain == "" ? "" : "https://${var.r2_public_domain}"
}

output "r2_bucket_name" {
  value = cloudflare_r2_bucket.assets.name
}

output "kv_cache_id" {
  value = cloudflare_workers_kv_namespace.cache.id
}

output "cloudflare_database_id" {
  value = var.cloudflare_database_id
}
