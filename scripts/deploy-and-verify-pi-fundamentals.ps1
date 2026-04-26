param(
  [Parameter(Mandatory = $true)]
  [string]$PiHost,

  [string]$RemoteDir = "/home/ahad/sentiment-analyst"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$deployScript = Join-Path $PSScriptRoot "deploy-pi-fundamentals.ps1"

& $deployScript -PiHost $PiHost -RemoteDir $RemoteDir

$remoteCommands = @'
set -euo pipefail
cd /home/ahad/sentiment-analyst
sudo systemctl restart sentiment-analyst.service
sleep 3
sudo systemctl status sentiment-analyst.service --no-pager -l
echo
echo "Dashboard screener keys:"
curl -s http://127.0.0.1:3000/api/fundamentals/dashboard | grep -o '"screener"\|"initial_screen"' | head -n 20 || true
echo
echo "Health fundamental universe:"
curl -s http://127.0.0.1:3000/api/health
echo
echo "Public config:"
curl -s http://127.0.0.1:3000/api/config
'@

ssh $PiHost $remoteCommands
