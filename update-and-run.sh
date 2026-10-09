#!/usr/bin/env bash
# Pull latest GHCR images and restart the API stack (Linux VPS).
# Usage: ./update-and-run.sh   (or schedule with cron)
set -e
cd "$(dirname "$0")"

echo "Pulling latest docker images..."
docker compose -f docker-compose.api.yml pull

echo "Starting containers in detached mode..."
docker compose -f docker-compose.api.yml up -d

echo "Cleaning up unused docker resources..."
docker image prune -a -f

echo "Done!"
