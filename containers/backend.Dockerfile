# Wraps the CI-built backend image for Cloudflare Containers.
# Containers can't reach each other over a private network, so the Redis cache
# runs inside the same container (cache only, nothing persisted - R2 is the source of truth).
# Runtime settings (env, ports, Redis memory) live in src/index.ts (Cloudflare) and docker-compose.yml (local).
FROM ghcr.io/majdabbas9/prket_alandlos_backend:latest

RUN apk add --no-cache redis

# Redis runs in the foreground under a restart loop, so a crash shows up in the
# container logs and Redis comes back, instead of the cache staying dead (every
# request then waits on it) until the container restarts. Node starts once Redis answers.
CMD ["sh", "-c", ": \"${REDIS_MAXMEMORY:?}\" \"${REDIS_MAXMEMORY_POLICY:?}\"; (while true; do redis-server --save '' --appendonly no --maxmemory \"$REDIS_MAXMEMORY\" --maxmemory-policy \"$REDIS_MAXMEMORY_POLICY\"; echo \"redis-server exited with code $?, restarting\" >&2; sleep 1; done) & until redis-cli ping >/dev/null 2>&1; do sleep 0.1; done; exec node server.js"]
