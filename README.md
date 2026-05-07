# OrgAI Platform

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
# MCP: http://localhost:3001
```

## Manual setup (without Docker)

```bash
cd api && npm install && npx prisma migrate dev && npm run dev
cd dashboard && npm install && npm run dev
cd mcp && npm install && npm run build && npm run start:http
```

## Connect the VS Code extension

1. Install from .vsix or VS Code Marketplace (coming soon)
2. Open onboarding, enter your OrgAI API key
3. Policies sync automatically

## Connect any MCP agent (Cursor, Claude Code, etc.)

```json
{
  "mcpServers": {
    "orgai": {
      "url": "https://mcp.orgai.dev/sse",
      "env": {
        "COMPLY_API_KEY": "oai_your_key_here"
      }
    }
  }
}
```

## Deploy

- **API + MCP**: Railway (see `api/railway.json`, `mcp/railway.json`)
- **Dashboard**: Vercel (see `dashboard/vercel.json`)
- Set GitHub secrets: `RAILWAY_TOKEN`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `DATABASE_URL_TEST`

## CI/CD

GitHub Actions runs on every push to main:
- Build + test all packages
- Deploy to Railway + Vercel on merge to main
