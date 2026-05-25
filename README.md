# OrgAI Platform

> **Landing page:** `landing-page/index.html` — open directly in a browser
>
> **Project code:** start at `index.html` or browse `dashboard/`, `api/`, `extension/`, `mcp/`

---

Org-wide AI compliance enforcement for developer teams.
Enforce coding policies across every AI agent your team uses — Claude Code, Cursor, Copilot, and more.

## What it does

- **Centralized Policy Hierarchy**: Define code standards (security, style, domain-specific rules) centrally and enforce them for every developer.
- **Universal AI Enforcement**: The MCP server works with any MCP-compatible agent, giving you 100% coverage across IDEs and standalone agents.
- **Audit Trail**: Real-time dashboard visibility into policy violations, fixes, and agent behavior across your whole team.

## Architecture

```text
orgai-platform/
├── packages/core/   Shared policy engine + evaluator
├── api/             REST API (Express + Prisma + PostgreSQL)
├── dashboard/       Web dashboard (Next.js)
├── mcp/             MCP server (works with any MCP-compatible agent)
└── extension/       VS Code extension
```

## Quick start (local dev)

```bash
git clone https://github.com/MrKuros/orgai-platform
cd orgai-platform
cp .env.example .env
# Edit .env with your values
docker-compose up
# API: http://localhost:8080
# Dashboard: http://localhost:3000
# MCP: http://localhost:8080/mcp/sse
```

## Manual setup (without Docker)

```bash
# ⚠️ Always build core first — mcp/ and extension/ depend on packages/core/dist/
cd packages/core && npm run build
cd ../

cd api && npm install && npx prisma migrate dev && npm run dev
cd dashboard && npm install && npm run dev
```

## Connect the VS Code extension

1. Install from .vsix or VS Code Marketplace (coming soon)
2. Open onboarding, enter your OrgAI API key
3. Policies sync automatically

## Connect any MCP agent (Cursor, Claude Code, etc.)

### Quick setup (recommended)
```bash
curl -fsSL https://api.orgai.dev/setup.sh | bash -s -- --key YOUR_API_KEY
```

### Manual configuration
```json
{
  "mcpServers": {
    "orgai": {
      "url": "https://api.orgai.dev/mcp/sse",
      "env": {
        "ORGAI_API_KEY": "oai_your_key_here"
      }
    }
  }
}
```

## Deploy

- **API (includes MCP)**: Railway (see `api/railway.json`)
- **Dashboard**: Vercel (see `dashboard/vercel.json`)
- Set GitHub secrets: `RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL_TEST`

## CI/CD

GitHub Actions runs on every push to main:
- Build + test all packages
- Deploy to Railway + Vercel on merge to main
