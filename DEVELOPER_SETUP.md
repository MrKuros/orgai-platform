# OrgAI — Developer Setup

For developers whose org runs OrgAI. **From your admin you need:** the OrgAI
server URL and an org API key (`oai_…`).

## The one-liner (recommended)

Run inside each git repo you work in:

```bash
curl -fsSL https://<orgai-host>/setup.sh | bash -s -- --key oai_... --url https://<orgai-host> --role <your-role>
```

In two teams? Comma-separate the roles — policies from both apply:
`--role "payments-dev,ml-dev"`

**Got a developer-bound key** (your admin issued it to you in the dashboard)?
Skip `--role` entirely — the server already knows your roles and every check
you run is attributed to you in the audit trail.

That's it — it auto-configures every AI agent it detects on your machine
(Claude Code, Cursor, Windsurf, OpenCode, Antigravity, and VS Code / Copilot
agent mode via `.vscode/mcp.json`) *and* installs the git pre-commit hook with
your role, reporting only the agents it actually configured. Restart your IDE.
Done. Note: the one-liner stores your API key in `.git/config` — treat the repo
directory accordingly.

Everything below is the manual fallback / reference.

## 1. Connect your AI agent (MCP)

One JSON block, same shape everywhere — replace URL and key:

```json
{
  "mcpServers": {
    "orgai": {
      "url": "https://<orgai-host>/mcp",
      "headers": { "x-api-key": "oai_..." }
    }
  }
}
```

(The key must go in `headers` — a client-side `env` block never reaches a
remote server.)

| Agent | Where |
|---|---|
| Claude Code | `claude mcp add orgai --transport http https://<orgai-host>/mcp --header "x-api-key: oai_..."` |
| Cursor | `.cursor/mcp.json` in the repo (or global Cursor settings) |
| VS Code / GitHub Copilot (agent mode) | `.vscode/mcp.json` in the repo: `{ "servers": { "orgai": { "type": "http", "url": "https://<orgai-host>/mcp", "headers": { "x-api-key": "oai_..." } } } }` — setup.sh writes this automatically when run inside a repo |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| Other MCP agents | same JSON in that agent's MCP config |

Older agents that only speak SSE: use `https://<orgai-host>/mcp/sse` instead.

Once connected, the agent checks policy before writing code; blocked actions come
back with the rule and the fix. Slash-command style prompts are available too
(e.g. `/mcp__orgai__load-policies`).

## 2. Install the git hook (commit backstop)

Get `hooks/pre-commit` from your admin (ships in the OrgAI bundle), then in each repo:

```bash
cp pre-commit .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
git config orgai.apiurl https://<orgai-host>
git config orgai.apikey oai_...
git config orgai.role   <your-role>        # default: junior
```

(Or set `COMPLY_API_URL` / `COMPLY_API_KEY` / `COMPLY_ROLE` as env vars.
Global install for all repos: `git config core.hooksPath <dir>`.)

Behavior: `ERROR` violations block the commit, `WARNING`s print and allow,
unreachable server blocks (fail-closed). Emergency bypass — logged to the org
audit trail as `hook.bypassed`, use sparingly:

```bash
COMPLY_SKIP=1 git commit ...
```

## 3. Verify

```bash
curl -s -X POST https://<orgai-host>/v1/orgs/<ORG_ID>/check \
  -H "x-api-key: oai_..." -H 'Content-Type: application/json' \
  -d '{"type":"code","content":"const apiKey = \"sk-live-123\"","roleName":"junior"}'
```

Expect a blocked response naming the hardcoded-secret rule. Then commit a file
containing that line — the hook should refuse it.

## Troubleshooting

- **Agent ignores policies** — MCP server not connected; check the agent's MCP
  list/logs, confirm the URL is reachable and the key is set.
- **Hook says "COMPLY_API_KEY not set"** — set it via env or `git config orgai.apikey`.
- **Everything blocked / server unreachable** — fail-closed is intentional; ping
  your admin, or `COMPLY_SKIP=1` for a genuine emergency.
- **401s** — key revoked or wrong org. Ask your admin for a fresh key.

---

## Contributing to the platform itself

```bash
git clone <repo> && cd orgai-platform
./dev.sh                 # dockerized postgres + API :8080 + dashboard :3000, hot reload
```

Tests: `npm test -w api` · `npm test -w mcp` · `npm run lint -w dashboard`.
Layout: npm workspaces — `api`, `dashboard`, `packages/core` (policy engine),
`mcp` (standalone server/CLI), `extension`. Feature inventory: `FEATURES.md`.
