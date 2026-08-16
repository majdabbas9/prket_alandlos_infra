# Pull latest images and restart containers
Write-Host "Pulling latest docker images..." -ForegroundColor Cyan
docker compose pull

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nStarting containers in detached mode..." -ForegroundColor Cyan
    docker compose up -d
    Write-Host "`nCleaning up unused docker resources..." -ForegroundColor Cyan
    docker image prune -a -f
    Write-Host "`nDone!" -ForegroundColor Green
}
else {
    Write-Host "`nDocker compose pull failed. Skipping startup." -ForegroundColor Red
}
