# Wraps the CI-built admin (auth) backend image for Cloudflare Containers.
# Runtime env/ports live in src/index.ts (Cloudflare) and docker-compose.yml (local).
FROM ghcr.io/majdabbas9/prket_alandlos_admin_backend:latest

# `npm start` re-runs `tsc` (prestart) on every boot; dist/ is already built in the image.
CMD ["node", "dist/index.js"]
