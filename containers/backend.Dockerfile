# Wraps the CI-built backend image for Cloudflare Containers.
# Containers can't reach each other over a private network, so the Redis cache
# runs inside the same container (cache only, nothing persisted - R2 is the source of truth).
FROM ghcr.io/majdabbas9/prket_alandlos_backend:latest

RUN apk add --no-cache redis

ENV NODE_ENV=production \
    PORT=8080 \
    REDIS_URL=redis://127.0.0.1:6379

EXPOSE 8080

CMD ["sh", "-c", "redis-server --daemonize yes --save '' --appendonly no --maxmemory 128mb --maxmemory-policy allkeys-lru && exec node server.js"]
