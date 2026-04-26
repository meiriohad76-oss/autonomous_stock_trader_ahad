param(
  [Parameter(Mandatory = $true)]
  [string]$PiHost,

  [string]$RemoteDir = "/home/ahad/sentiment-analyst"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

$files = @(
  "src/config.js",
  "src/app.js",
  "src/server.js",
  "src/http/router.js",
  "src/domain/persistence.js",
  "src/domain/fundamentals.js",
  "src/domain/fundamental-universe.js",
  "src/public/fundamentals.js",
  "src/public/fundamentals.html",
  "scripts/sqlite-backup.js"
)

foreach ($relativePath in $files) {
  $localPath = Join-Path $repoRoot $relativePath
  $remotePath = "$PiHost`:$RemoteDir/$($relativePath -replace '\\','/')"
  Write-Host "Copying $relativePath"
  scp $localPath $remotePath
}

Write-Host ""
Write-Host "Sync complete."
Write-Host "Next on the Pi:"
Write-Host "  sudo systemctl restart sentiment-analyst.service"
Write-Host "  sleep 3"
Write-Host "  curl -s http://127.0.0.1:3000/api/fundamentals/dashboard | grep -o '\"screener\"\\|\"initial_screen\"'"
