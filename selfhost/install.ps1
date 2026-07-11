# OrgAI self-host installer (Windows). From the unpacked bundle folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "Docker Desktop is required. Install it from https://docs.docker.com/desktop/ and re-run."
  exit 1
}

if (Test-Path orgai-images.tar.gz) {
  Write-Host "==> Loading application images (one-time, ~2 min)"
  docker load -i orgai-images.tar.gz
}

if (-not (Test-Path .env)) {
  Write-Host "==> Generating configuration (.env) with random secrets"
  Copy-Item .env.example .env
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  function New-Hex($bytes) {
    $b = New-Object byte[] $bytes; $rng.GetBytes($b)
    ($b | ForEach-Object { $_.ToString("x2") }) -join ""
  }
  (Get-Content .env) `
    -replace '^JWT_SECRET=.*', "JWT_SECRET=$(New-Hex 32)" `
    -replace '^POSTGRES_PASSWORD=.*', "POSTGRES_PASSWORD=$(New-Hex 16)" |
    Set-Content .env
}

Write-Host "==> Starting OrgAI"
docker compose up -d

Write-Host ""
Write-Host "Done. Open http://localhost:3000 and sign up - the first signup creates"
Write-Host "your organization. Full guide: README.md"
