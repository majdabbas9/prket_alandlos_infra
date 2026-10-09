output "site_pages_url" {
  value = cloudflare_pages_project.main_frontend.subdomain
}

output "admin_pages_url" {
  value = cloudflare_pages_project.admin_frontend.subdomain
}

output "site_custom_domain" {
  value = cloudflare_pages_domain.site.name
}

output "admin_custom_domain" {
  value = cloudflare_pages_domain.admin.name
}

output "api_dns_record" {
  value = "api.${var.zone_name} -> ${var.vps_ip} (proxied)"
}
