# A records for the VPS-hosted APIs (proxied through Cloudflare).
# Caddy on the VPS routes by Host header; see ../Caddyfile.
resource "cloudflare_record" "api" {
  zone_id = data.cloudflare_zone.main.id
  name    = "api"
  content = var.vps_ip
  type    = "A"
  ttl     = 1 # auto
  proxied = true
}

resource "cloudflare_record" "auth" {
  zone_id = data.cloudflare_zone.main.id
  name    = "auth"
  content = var.vps_ip
  type    = "A"
  ttl     = 1 # auto
  proxied = true
}
