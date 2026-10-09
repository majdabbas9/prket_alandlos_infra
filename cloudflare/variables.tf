variable "cloudflare_account_id" {
  type        = string
  description = "Cloudflare account ID (see CLOUDFLARE_ACCOUNT_ID in ../.env)"
}

variable "zone_name" {
  type        = string
  description = "The Cloudflare zone (domain), e.g. YOURDOMAIN.com"
}

variable "vps_ip" {
  type        = string
  description = "Public IP of the VPS hosting the APIs"
}

variable "github_owner" {
  type        = string
  default     = "majdabbas9"
  description = "GitHub user/org that owns the frontend repos"
}

variable "main_frontend_repo" {
  type        = string
  default     = "prket_alandlos_frontend"
  description = "GitHub repo of the main marketing frontend"
}

variable "admin_frontend_repo" {
  type        = string
  default     = "prket_alandlos_admin_frontend"
  description = "GitHub repo of the admin frontend"
}

variable "site_domain" {
  type        = string
  default     = ""
  description = "Custom domain for the main site; defaults to site.<zone_name>"
}

variable "admin_domain" {
  type        = string
  default     = ""
  description = "Custom domain for the admin panel; defaults to admin.<zone_name>"
}

locals {
  site_domain  = var.site_domain != "" ? var.site_domain : "site.${var.zone_name}"
  admin_domain = var.admin_domain != "" ? var.admin_domain : "admin.${var.zone_name}"
}
