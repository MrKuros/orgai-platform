# OrgAI — Self-Hosted Installation

Runs entirely on your own machine or server. No internet connection or external
services required. Everything (app, database, audit logs) stays on your hardware.

**Requirements:** Docker with the Compose plugin (Docker Desktop, or
`docker` + `docker compose` on Linux). 2 GB RAM free.

---

## 1. Install

Unpack the bundle you received, then from inside the folder:

```bash
./install.sh
```

That's it — it loads the images, generates secrets into `.env`, and starts
everything. (On Windows, run it from Git Bash or WSL.)

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

Then each developer adds OrgAI to their agent. Claude Code:

```bash
claude mcp add --transport sse orgai http://<server>:8080/mcp/sse
```

Any other MCP-capable agent (Cursor, etc.): SSE endpoint
`http://<server>:8080/mcp/sse`.

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
docker compose exec db pg_dump -U orgai orgai > orgai-backup-$(date +%F).sql
```

**Restore:**

```bash
cat orgai-backup-YYYY-MM-DD.sql | docker compose exec -T db psql -U orgai orgai
```

## 5. Updating

When you receive a new bundle:

```bash
docker load -i orgai-images.tar.gz     # from the new bundle
# update ORGAI_VERSION in .env to the new version number
docker compose up -d                   # migrates the database automatically
```

Your data is kept — database migrations run automatically on start.

## Troubleshooting

- **Dashboard loads but login fails** — check the API is healthy:
  `curl http://localhost:8080/health` should return `{"status":"ok"}`.
- **See what's happening:** `docker compose logs -f api`
- **Start over completely** (deletes ALL data): `docker compose down -v`
