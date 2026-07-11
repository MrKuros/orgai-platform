# OrgAI self-host installer (Windows). From the unpacked bundle folder:
#   powershell -ExecutionPolicy Bypass -File install.ps1
# Works with Docker or Podman (no Docker Desktop required).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# Pick a container engine: docker if present and running, else podman.
$engine = $null
if (Get-Command docker -ErrorAction SilentlyContinue) {
  docker info *> $null
  if ($LASTEXITCODE -eq 0) { $engine = "docker" }
}
if (-not $engine -and (Get-Command podman -ErrorAction SilentlyContinue)) {
  $engine = "podman"
  # Podman on Windows needs its Linux VM running
  podman machine inspect *> $null
  if ($LASTEXITCODE -ne 0) { podman machine init }
  podman machine start *> $null
}
if (-not $engine) {
  Write-Host "Docker or Podman is required."
  Write-Host "  - Podman (free, no license restrictions): https://podman.io/docs/installation"
  Write-Host "  - Docker Desktop (license may be required at large companies): https://docs.docker.com/desktop/"
  exit 1
}
Write-Host "==> Using $engine"

if (Test-Path orgai-images.tar.gz) {
  Write-Host "==> Loading application images (one-time, ~2 min)"
  & $engine load -i orgai-images.tar.gz
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
& $engine compose up -d
if ($LASTEXITCODE -ne 0) { throw "$engine compose failed - see output above" }

Write-Host ""
Write-Host "Done. Open http://localhost:3000 and sign up - the first signup creates"
Write-Host "your organization. Full guide: README.md"
