# Wraps the CI-built admin (auth) backend image for Cloudflare Containers.
FROM ghcr.io/majdabbas9/prket_alandlos_admin_backend:latest

ENV NODE_ENV=production \
    PORT=5001

EXPOSE 5001

# `npm start` re-runs `tsc` (prestart) on every boot; dist/ is already built in the image.
CMD ["node", "dist/index.js"]
