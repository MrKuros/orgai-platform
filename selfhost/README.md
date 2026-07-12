# OrgAI — Self-Hosted Installation

Runs entirely on your own machine or server. No internet connection or external
services required. Everything (app, database, audit logs) stays on your hardware.

**Requirements:** a container engine — either of these, on the one machine
that will host OrgAI. 2 GB RAM free.

- **Podman** (free for everyone, incl. large enterprises — no Docker Desktop
  license needed): https://podman.io/docs/installation — on Windows/Mac also
  install the compose provider (`podman-compose` or Podman Desktop).
- **Docker**: Docker Engine on Linux (free), or Docker Desktop on Windows/Mac
  (check your company's licensing policy).

The install script auto-detects whichever one you have. Day-to-day commands
below use `docker compose`; on Podman substitute `podman compose`.

---

## 1. Install

Unpack the bundle you received, then from inside the folder:

```bash
./install.sh        # Mac / Linux
```

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1   # Windows
```

That's it — it loads the images, generates secrets into `.env`, and starts
everything.

Open **http://localhost:3000** and sign up — the first signup creates your
organization and makes you its admin.

If teammates will access it from other machines, uncomment `CORS_ORIGIN` and
`DASHBOARD_URL` in `.env`, set them to this machine's address
(e.g. `http://192.168.1.50:3000`), and run `docker compose up -d` again.
They then browse to that same address.

## 2. Connect your AI agents (MCP)

One-time setup:

1. In the dashboard: create your policies, then create an **API key**
   (Settings → API Keys — copy it, it is shown once).
2. Paste it into `.env` as `COMPLY_API_KEY=...` and run `docker compose up -d`
   again. This switches the built-in MCP server to enforce your live policies
   and record every check in the audit log.

Then each developer adds OrgAI to their agent — any MCP-capable tool works.
Two endpoints are served: `http://<server>:8080/mcp` (streamable HTTP, current
standard) and `http://<server>:8080/mcp/sse` (SSE, for older clients).

**Claude Code**

```bash
claude mcp add --transport http orgai http://<server>:8080/mcp
```

**Cursor** — `.cursor/mcp.json` in the project (or global settings):

```json
{ "mcpServers": { "orgai": { "url": "http://<server>:8080/mcp" } } }
```

**OpenAI Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.orgai]
url = "http://<server>:8080/mcp"
```

**Anything else** (Windsurf, Copilot, JetBrains…): point its MCP config at
`http://<server>:8080/mcp`; fall back to the `/mcp/sse` endpoint if the tool
only supports SSE.

## 3. Inviting team members

Since the offline install sends no email, invite links are printed to the API
log instead. After inviting someone in the dashboard, grab their link with:

```bash
docker compose logs api | grep -i invite
```

Send them the link; they set a password and are in.

## 4. Audit trail

Every policy check is recorded in the built-in database and visible in the
dashboard's Audit Log page. Data persists in the Docker volume `orgai_pgdata`
across restarts and updates.

**Backup** (recommended, cron-able):

```bash
docker compose exec -T db pg_dump -U orgai orgai > orgai-backup-$(date +%F).sql
```

(`-T` disables the pseudo-TTY — required under cron/CI, and it stops the dump
being corrupted by CRLF line-ending translation.)

**Restore:**

```bash
cat orgai-backup-YYYY-MM-DD.sql | docker compose exec -T db psql -U orgai orgai
```

## 5. Git backstop (optional, recommended)

The MCP integration checks AI output before it's written. As a safety net for
code that slips past (agent skipped the check, human paste, etc.), install the
bundled pre-commit hook in each developer repo:

```bash
cp hooks/pre-commit YOUR_REPO/.git/hooks/pre-commit
chmod +x YOUR_REPO/.git/hooks/pre-commit
cd YOUR_REPO
git config orgai.apiurl http://<server>:8080
git config orgai.apikey oai_...      # from dashboard → API Keys
git config orgai.role junior        # role to enforce
```

Commits with ERROR-severity violations are blocked (with file + line + fix
suggestion); WARNING-level ones are printed but allowed. Bypass once with
`COMPLY_SKIP=1 git commit ...`.

**CI:** the same script checks a ref range — add to your pipeline:

```bash
COMPLY_API_KEY=oai_... COMPLY_API_URL=http://<server>:8080 \
  ./hooks/pre-commit origin/main HEAD
```

Non-zero exit fails the build. Violations are always logged in the org audit
trail, whether or not the commit is blocked.

## 6. Updating

Each bundle generates fresh random secrets. Your existing data (in the
`orgai_pgdata` volume) is encrypted with the **original** `POSTGRES_PASSWORD`
and `JWT_SECRET`, so a new bundle must reuse your existing `.env` — otherwise
the API cannot open the database (crash-loop) and everyone is logged out.

When you receive a new bundle, unpack it and **copy your current `.env` into the
new folder first**:

```bash
cp /path/to/old-bundle/.env .            # reuse your existing secrets
docker load -i orgai-images.tar.gz       # from the new bundle
# set ORGAI_VERSION in .env to the new version number (see .env.example footer)
docker compose up -d                     # migrates the database automatically
```

`install.sh` / `install.ps1` also detect this: if they find existing
`orgai_pgdata` data but no `.env` in the folder, they abort and tell you to copy
the previous `.env` in first.

Your data is kept — database migrations run automatically on start.

## Starting on boot (Podman note)

Docker restarts the containers automatically after a reboot. Rootless Podman
does not — either run `podman compose up -d` after a reboot, or (Linux)
enable lingering + generate a systemd unit per container once. The compose
project is named `orgai`, so the containers are `orgai-db-1`, `orgai-api-1`,
`orgai-dashboard-1` (confirm with `podman ps --format '{{.Names}}'`).
`podman generate systemd` takes one container name per call:

```bash
loginctl enable-linger "$USER"        # keep units running after logout
podman generate systemd --new --files --name orgai-db-1
podman generate systemd --new --files --name orgai-api-1
podman generate systemd --new --files --name orgai-dashboard-1
mkdir -p ~/.config/systemd/user && mv container-orgai-*.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now container-orgai-db-1 container-orgai-api-1 container-orgai-dashboard-1
```

## Troubleshooting

- **Dashboard loads but login fails** — check the API is healthy:
  `curl http://localhost:8080/health` should return `{"status":"ok"}`.
- **See what's happening:** `docker compose logs -f api`
- **Start over completely** (deletes ALL data): `docker compose down -v`
