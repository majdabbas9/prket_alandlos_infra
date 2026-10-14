#!/usr/bin/env bash
# Derives every hostname of the DEV stack from DEV_URL and prints them as key=value lines
# (ready for $GITHUB_OUTPUT): zone_id, site, admin, api, images, api_url.
#
# DEV_URL is a hostname in a Cloudflare zone on this account, e.g. majdabbas.dev or
# dev.majdabbas.dev (a scheme, path or port is ignored). PROD_URL belongs to the separate
# production stack; it is only checked so dev can never be deployed onto it. Every name
# stays one level below the zone so Cloudflare's free Universal SSL certificate covers it:
#
#            DEV_URL = zone (majdabbas.dev)   DEV_URL = sub.zone (dev.majdabbas.dev)
#   site     majdabbas.dev                    dev.majdabbas.dev
#   admin    admin.majdabbas.dev              dev-admin.majdabbas.dev
#   api      api.majdabbas.dev                dev-api.majdabbas.dev
#   images   images.majdabbas.dev             dev-images.majdabbas.dev  (public R2 CDN)
#
# DEV_URL unset = no custom domains: only api_url (the workers.dev URL) is printed.
# Needs: DEV_URL, PROD_URL, CLOUDFLARE_API_TOKEN (Zone > Zone: Read), CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail

WORKERS_DEV_URL="https://prket-alandlos-api.majd-abbas222.workers.dev"

host() { printf '%s' "${1:-}" | sed -E 's#^[a-zA-Z]+://##; s#[/:].*$##' | tr 'A-Z' 'a-z'; }
dev=$(host "${DEV_URL:-}")
prod=$(host "${PROD_URL:-}")

if [ -z "$dev" ]; then
  echo "DEV_URL not set: using workers.dev / pages.dev only" >&2
  echo "api_url=$WORKERS_DEV_URL"
  exit 0
fi

# The zone is the longest suffix of DEV_URL that is a zone on this account
zone="" zone_id="" name="$dev"
while [ -z "$zone_id" ] && [[ "$name" == *.* ]]; do
  zone_id=$(curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/zones?name=$name&account.id=$CLOUDFLARE_ACCOUNT_ID" \
    | jq -r '.result[0].id // empty') \
    || { echo "Zone lookup failed (token needs Zone > Zone: Read)" >&2; exit 1; }
  if [ -n "$zone_id" ]; then zone="$name"; else name="${name#*.}"; fi
done
[ -n "$zone_id" ] || { echo "No Cloudflare zone on this account contains $dev" >&2; exit 1; }

if [ "$dev" = "$zone" ]; then prefix=""; else prefix="$(printf '%s' "${dev%."$zone"}" | tr '.' '-')-"; fi
site="$dev" admin="${prefix}admin.$zone" api="${prefix}api.$zone" images="${prefix}images.$zone"

# Never take over a production hostname (PROD_URL itself or its admin/api/images names)
if [ -n "$prod" ]; then
  for name in "$site" "$admin" "$api" "$images"; do
    case "$name" in
      "$prod" | "admin.$prod" | "api.$prod" | "images.$prod")
        echo "Dev hostname $name collides with production ($prod): set DEV_URL to another name" >&2
        exit 1 ;;
    esac
  done
fi

echo "zone_id=$zone_id"
echo "site=$site"
echo "admin=$admin"
echo "api=$api"
echo "images=$images"
echo "api_url=https://$api"
