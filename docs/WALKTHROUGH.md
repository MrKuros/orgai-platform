# OrgAI Platform - Full Walkthrough

## What is OrgAI?

OrgAI is an **org-wide AI compliance enforcement platform** for developer teams. It lets you define coding policies (security rules, style guidelines, domain-specific standards) once at the organization level, and automatically enforces them across every AI agent your team uses — including Claude Code, Cursor, Windsurf, VS Code Copilot, and any MCP-compatible agent.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        OrgAI Platform                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐ │
│  │  Dashboard  │    │     API     │    │   MCP Server        │ │
│  │  (Next.js) │◄──►│  (Express)  │◄──►│ (Model Context      │ │
│  │  Port 3000│    │  Port 8080  │    │  Protocol)           │ │
│  └─────────────┘    └──────┬──────┘    │  Port 3001         │ │
│                            │            │                     │ │
│                            ▼            │  ┌───────────────┐  │ │
│                     ┌─────────────┐     │  │ @comply/core │  │ │
│                     │  PostgreSQL │◄────┼──│  (Evaluator)  │  │ │
│                     │  (Neon/RL) │     │  └───────────────┘  │ │
│                     └─────────────┘     └─────────────────────┘ │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              VS Code Extension (Comply)                       ││
│  │  - Sidebar chat interface                                    ││
│  │  - Policy sync via API                                       ││
│  │  - System prompt injection                                   ││
│  │  - Real-time code evaluation                                 ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │              MCP-Compatible Agents                           ││
│  │  Claude Code │ Cursor │ Windsurf │ OpenCode │ Antigravity │ etc ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Monorepo Structure

```
orgai-platform/
├── packages/core/        # Shared policy engine + evaluator
│   └── src/
│       ├── evaluator.ts     # Regex + command evaluation logic
│       ├── policyEngine.ts # Policy resolution + inheritance
│       └── types/policy.ts  # TypeScript interfaces
│
├── api/                 # REST API (Express + Prisma)
│   └── src/
│       ├── index.ts          # Express app setup
│       ├── routes/
│       │   ├── auth.ts       # Signup, login, SSO
│       │   ├── orgs.ts      # Organization CRUD
│       │   ├── roles.ts      # Role hierarchy + inheritance
│       │   ├── policies.ts   # Policy CRUD
│       │   ├── members.ts   # Team membership
│       │   ├── apiKeys.ts   # API key management
│       │   ├── resolve.ts    # Policy resolution + conflict detection
│       │   ├── audit.ts     # Audit logging
│       │   ├── webhooks.ts  # Webhook dispatch
│       │   └── sso.ts       # WorkOS SSO
│       └── lib/
│           ├── prisma.ts    # Prisma client
│           └── jwt.ts       # JWT utilities
│
├── dashboard/           # Web dashboard (Next.js 14 App Router)
│   └── src/
│       ├── app/
│       │   ├── (auth)/     # Login + signup pages
│       │   ├── dashboard/  # Main dashboard
│       │   ├── policies/   # Policy management
│       │   ├── roles/      # Role management
│       │   ├── team/       # Member management
│       │   ├── settings/
│       │   │   └── api-keys/ # API key management
│       │   └── ide-setup/   # IDE connection guide
│       └── components/
│           └── ui/          # shadcn/ui components
│
├── mcp/                # MCP server (SSE transport)
│   └── src/
│       ├── http.ts         # Express server + SSE endpoints
│       ├── server.ts       # MCP protocol server
│       ├── tools.ts        # MCP tools (check_compliance, etc.)
│       └── api-client.ts  # OrgAPI client for MCP
│
└── extension/          # VS Code extension ("Comply")
    └── src/
        ├── extension.ts    # Extension entry point
        ├── agent.ts        # LLM agent with policy injection
        ├── policyEngine.ts # Policy loading + resolution
        ├── evaluator.ts    # Real-time code evaluation
        ├── orgai-client.ts # OrgAPI client
        └── webview/        # Sidebar UI panels
```

## Data Model (Prisma Schema)

```prisma
Organization
├── id, name, slug
├── memberships[]     # Users in the org
├── roles[]           # Role hierarchy
├── policies[]        # Organization policies
├── apiKeys[]         # API keys for agents
├── auditLogs[]       # Compliance audit trail
├── webhooks[]        # Outbound webhooks
└── ssoConfig?        # WorkOS SSO config

User
├── id, email, passwordHash
├── firstName, lastName
├── workosUserId      # SSO identity
└── memberships[]      # Per-org memberships

Role (hierarchical)
├── id, name, displayName
├── inheritsFromId?    # Parent role (inheritance chain)
├── children[]         # Subordinate roles
├── bindings[]         # Policy bindings
└── memberships[]       # Users with this role

Policy
├── id, name, rule     # Human-readable name + rule text
├── skill              # "How to comply" guidance
├── evaluatorType      # "regex" | "command" | "none"
├── evaluatorPattern   # Regex pattern or command match
├── evaluatorFlags     # Regex flags
├── fixSuggestion      # How to fix violations
├── severity           # ERROR | WARNING
└── bindings[]         # Which roles have this policy

PolicyBinding           # Many-to-many: Role ↔ Policy
├── roleId, policyId
```

## Key Concepts

### 1. Policy Inheritance Chain

Roles form a hierarchy via `inheritsFromId`. When resolving policies for a role:

1. Start from the leaf role (e.g., "Junior Developer")
2. Walk up the inheritance chain to root (e.g., "CTO")
3. Collect all policies from each role
4. **If two roles define the same policy name, the ancestor wins** (org-level dominates)
5. Return warnings for any conflicts detected

```typescript
// API: /v1/orgs/:orgId/resolve/:roleName
{
  role: { id, name, displayName },
  resolvedFrom: ["cto", "junior"],  // chain from root to leaf
  policies: [
    { name: "no-secrets", rule: "...", setByRole: "cto", ... },
    { name: "no-console-log", rule: "...", setByRole: "cto", ... }  // CTO's wins
  ],
  warnings: [
    { policyName: "no-console-log", overriddenByRole: "cto", originalRole: "junior" }
  ]
}
```

### 2. Policy Evaluators

Policies can have different evaluator types:

| Type | Purpose | Example |
|------|---------|---------|
| `none` | Advisory only, no blocking | "Always use PreparedStatements" |
| `regex` | Pattern match against code | `console\.(log\|debug)` |
| `command` | Block dangerous commands | `npm install --save` (not `--save-dev`) |

### 3. Severity Levels

- **ERROR** — Blocks the action, requires fix before proceeding
- **WARNING** — Informational, allows proceeding but logs it

### 4. API Key Scopes

| Scope | Permissions |
|-------|------------|
| `check` | Evaluate code/commands against policies |
| `resolve` | Fetch resolved policies for a role |
| `admin` | Create/revoke API keys, manage roles/policies |

## API Endpoints

### Authentication
- `POST /v1/auth/signup` — Create org + first admin user
- `POST /v1/auth/login` — Email/password login
- `GET /v1/auth/sso/:orgSlug` — Initiate WorkOS SSO
- `GET /v1/auth/sso/callback` — SSO callback
- `GET /v1/auth/me` — Current user info
- `GET /v1/auth/me/api` — API key identity lookup

### Organizations
- `GET/PATCH /v1/orgs/:orgId` — Get/update org
- `DELETE /v1/orgs/:orgId` — Delete org (admin only)

### Roles
- `GET /v1/orgs/:orgId/roles` — List all roles
- `POST /v1/orgs/:orgId/roles` — Create role (with optional inheritsFromId)
- `GET/PATCH/DELETE /v1/orgs/:orgId/roles/:roleId`

### Policies
- `GET /v1/orgs/:orgId/policies` — List all policies
- `POST /v1/orgs/:orgId/policies` — Create policy
- `POST /v1/orgs/:orgId/policies/:policyId/bindings` — Bind to roles
- `DELETE /v1/orgs/:orgId/policies/:policyId/bindings/:roleId`

### Compliance
- `GET /v1/orgs/:orgId/resolve/:roleName` — Get resolved policies with inheritance
- `POST /v1/orgs/:orgId/check` — Check code/command against policies

### Members
- `GET /v1/orgs/:orgId/members` — List members
- `POST /v1/orgs/:orgId/members/invite` — Invite by email
- `PATCH/DELETE /v1/orgs/:orgId/members/:userId`

### API Keys
- `GET /v1/orgs/:orgId/api-keys` — List keys
- `POST /v1/orgs/:orgId/api-keys` — Create key
- `DELETE /v1/orgs/:orgId/api-keys/:keyId`

### Audit
- `GET /v1/orgs/:orgId/audit` — Query audit logs

## MCP Server

The MCP server exposes tools that any MCP-compatible agent can use:

### Tools

**`check_compliance`**
```typescript
{
  code: string,      // Code to check
  filePath: string,   // For context (logger exemptions)
  userRole?: string,  // Role to check against
  policyUrl?: string  // Remote policy JSON URL
}
```

**`check_command`**
```typescript
{
  command: string,   // Terminal command to check
  userRole?: string,
  policyUrl?: string
}
```

**`get_policy`**
```typescript
{
  userRole?: string,  // Defaults to COMPLY_USER_ROLE env var
  policyUrl?: string
}
```

**`scan_diff`**
```typescript
{
  diff: string,        // Git diff to scan
  userRole?: string
}
```

**`list_roles`**
```typescript
{} // Returns available roles for the org
```

### Transport

- **SSE (Server-Sent Events)** — Long-lived connections for real-time responses
  - `GET /sse` — Initiate SSE connection
  - `POST /messages?sessionId=xxx` — Send messages

### Standalone vs API Mode

The MCP server works in two modes:

1. **Standalone mode** (no COMPLY_API_KEY)
   - Loads policies from local JSON file or remote URL
   - Uses `@comply/core` evaluator directly

2. **API mode** (COMPLY_API_KEY set)
   - Calls OrgAI API for policy resolution
   - API mode supports full inheritance chain + conflict warnings

## VS Code Extension (Comply)

The extension provides:

1. **Sidebar chat interface** — Chat with an LLM that has policy context injected
2. **Policy sync** — Pulls policies from OrgAI API on startup
3. **Real-time evaluation** — Checks code via regex before allowing writes
4. **System prompt injection** — Adds policy rules to LLM context
5. **Status bar** — Shows connected org and current role

### Policy Resolution Flow (Extension)

```
1. Extension activates
2. Load from OrgAI API (if apiKey configured)
   ├── Fetch org info via /v1/auth/me/api
   ├── Resolve policies via /v1/orgs/:orgId/resolve/:roleName
   ├── Map API response → ResolvedPolicy[]
   ├── Build system prompt with policy rules
   └── Show warnings for any conflicts
3. If no API key, fallback to:
   ├── Remote URL (comply.policies.url)
   ├── Workspace .comply/policies.json
   └── Bundled extension policies.json
```

## Dashboard Pages

| Route | Purpose |
|-------|---------|
| `/signup` | Create organization + admin account |
| `/login` | Email/password login |
| `/dashboard` | Overview with stats |
| `/policies` | Create/edit policies with evaluators |
| `/roles` | Role hierarchy editor (drag to reparent) |
| `/team` | Manage members + invites |
| `/settings/api-keys` | Generate + revoke API keys |
| `/ide-setup` | Connection guide for Claude Code, Cursor, etc. |

## CI/CD Pipeline

GitHub Actions workflow on every push to `main`:

```yaml
jobs:
  test:
    - Run API tests (19 tests)
    - Run MCP tests (10 tests)
    - TypeScript checks for all packages

  deploy-railway:
    - Deploy API to Railway (orgai-api service)
    - Deploy MCP to Railway (orgai-mcp service)
    needs: test

  deploy-vercel:
    - Deploy Dashboard to Vercel
    needs: test
```

## Environment Variables

### API (.env)
```
DATABASE_URL=postgresql://...       # Neon PostgreSQL
DIRECT_DATABASE_URL=postgresql://... # For Prisma migrations
JWT_SECRET=...                      # JWT signing secret
WORKOS_API_KEY=sk_test_...         # WorkOS SSO
WORKOS_CLIENT_ID=client_...        # WorkOS client ID
WORKOS_REDIRECT_URI=http://localhost:8080/v1/auth/sso/callback
PORT=8080
CORS_ORIGIN=http://localhost:3000
```

### Dashboard (.env.local)
```
NEXT_PUBLIC_API_URL=https://api.orgai.dev
NEXT_PUBLIC_MCP_URL=https://mcp.orgai.dev  # MCP server URL
```

### MCP
```
COMPLY_API_URL=http://api:8080     # Internal API URL (Docker)
COMPLY_API_KEY=oai_...            # API key for org
COMPLY_USER_ROLE=junior           # Default role
PORT=3001
```

## Deployment

| Service | Platform | URL |
|---------|----------|-----|
| Dashboard | Vercel | https://orgai-platform.vercel.app |
| API | Railway | https://api.orgai.dev |
| MCP | Railway | https://mcp.orgai.dev (DNS pending) |

## Getting Started

```bash
# Clone
git clone https://github.com/MrKuros/orgai-platform
cd orgai-platform

# Local development
docker compose up          # Starts API + Dashboard + MCP + Postgres

# Or manually
cd api && npm install && npx prisma migrate dev && npm run dev
cd dashboard && npm install && npm run dev
cd mcp && npm install && npm run build && npm run start:http
```

## Testing

```bash
# API tests (requires local Postgres via Docker)
cd api && npm test

# MCP tests
cd mcp && npm test

# Dashboard build + lint
cd dashboard && npm run build && npm run lint
```

## Key Files

| File | Purpose |
|------|---------|
| `packages/core/src/evaluator.ts` | Regex + command evaluation logic |
| `packages/core/src/policyEngine.ts` | Policy resolution with inheritance |
| `api/src/routes/resolve.ts` | Policy resolution API endpoint |
| `api/src/routes/check.ts` | Code/command compliance checking |
| `mcp/src/tools.ts` | MCP tool implementations |
| `extension/src/extension.ts` | VS Code extension entry point |
| `extension/src/policyEngine.ts` | Extension's policy loading (API-aware) |
| `dashboard/src/app/ide-setup/page.tsx` | IDE connection guide |
