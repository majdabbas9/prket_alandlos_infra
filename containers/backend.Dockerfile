# Wraps the CI-built backend image for Cloudflare Containers.
# Containers can't reach each other over a private network, so the Redis cache
# runs inside the same container (cache only, nothing persisted - R2 is the source of truth).
# Runtime settings (env, ports, Redis memory) live in src/index.ts (Cloudflare) and docker-compose.yml (local).
FROM ghcr.io/majdabbas9/prket_alandlos_backend:latest

RUN apk add --no-cache redis

CMD ["sh", "-c", "redis-server --daemonize yes --save '' --appendonly no --maxmemory \"${REDIS_MAXMEMORY:?}\" --maxmemory-policy \"${REDIS_MAXMEMORY_POLICY:?}\" && exec node server.js"]
