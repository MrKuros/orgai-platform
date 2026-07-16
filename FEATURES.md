# OrgAI — Platform Features

Self-hosted compliance enforcement for AI coding agents. One policy definition,
enforced across every agent your team runs — with the audit trail to prove it.

---

## Policy enforcement

- **Plain-English policies + regex evaluators** — human-readable rules the agent
  is told about, plus deterministic pattern evaluators for automatic enforcement.
  Evaluators are compile-checked and capped at creation (bad regex → 400).
- **Two severities** — `ERROR` blocks the action; `WARNING` flags it but allows.
- **Shadow mode (safe rollout)** — a policy can be created or switched to
  `SHADOW`: it is evaluated on every check and every would-have-blocked hit is
  audit-logged (`policy.shadow_violated`), but it never blocks an agent, commit,
  or build. Measure a new policy's noise in the dashboard audit trail, then flip
  it to `ENFORCED` — the flip itself is audit-logged. An enforced policy never
  loses a name conflict to a shadow one.
- **Fail-closed by design** — unknown role, unreachable policy source, or invalid
  remote config refuses instead of silently allowing. Violations are blocked
  *before* code is written; the agent receives the reason and fix guidance
  (`BLOCKED` / `WARNINGS`) so it self-corrects on the spot. At the agent layer
  this is policy guidance plus the MCP check; the git hook and CI are the hard
  enforcement — the agent is steered, the commit is stopped.
- **Built-in secret/credential detection** — pattern rules for credential
  assignments and credential-bearing URLs; extensible per org. No LLM in the
  loop: checks are deterministic, millisecond-fast, zero per-check token cost.
- **Role-scoped resolution** — every check evaluates against the requesting
  developer's resolved role and its inherited policy set.

## Role hierarchy & policy cascade

- Model the real org: CTO → Lead → Senior → Junior (any shape, any depth).
- Policies bind to roles and **cascade downward automatically** — juniors inherit
  every security rule set above them, nothing wired by hand.
- **Multiple superiors supported** — a developer under two departments checks as
  `"payments-dev,ml-dev"`: the union of both inheritance chains applies, and
  cross-branch conflicts resolve strictest-wins (enforced beats shadow, then
  ERROR beats WARNING).
- Role management UI in the dashboard; assigned role per member, editable.

## Enforcement surfaces (defense in depth)

1. **MCP server (agent-side gate)** — the primary control point.
   - Two transports: streamable HTTP (`/mcp`, session header) and legacy SSE
     (`/mcp/sse`) — works with Claude Code, Cursor, GitHub Copilot (agent mode,
     via VS Code MCP), Windsurf, and any MCP-compatible agent.
   - **API mode** (with `COMPLY_API_KEY`): org policies + audit logging.
     **Standalone mode**: bundled baseline policies, no server required.
   - MCP prompts double as slash commands in supporting agents.
   - Session hygiene: idle-TTL sweep, session cap, auth gate, rate-limited.
   - Also ships as a standalone CLI: `orgai-comply`.
2. **Git pre-commit hook (output backstop)** — POSIX sh, checks every staged
   file against the org policy API; blocks on `ERROR`, prints warnings,
   fail-closed if the API is unreachable, `COMPLY_SKIP=1` escape hatch logged
   to the org audit trail as `hook.bypassed`.
   Handles spaces in filenames, binary detection, missing-tool preflight.
3. **CI mode** — the same hook runs as `./hooks/pre-commit <base> <head>` in any
   pipeline, so nothing merges unchecked even if a laptop skips the hook.
4. **VS Code extension** — optional in-editor assistant that calls external
   cloud LLM APIs; not part of the self-hosted enforcement path.

## Audit & evidence

- **Append-only audit trail** — every check — blocked or allowed — is logged
  (`policy.checked`), plus every violation, invite, key event, and
  webhook change, with actor, org, action, resource, timestamp.
- **CSV export** (most recent 5,000 rows) — audit-ready evidence for SOC 2,
  ISO 27001, HIPAA, and India DPDP reviews. (Evidence, not certification — the
  honest claim.)
- **Live violations feed** — real-time stream in the dashboard (who, which
  policy, which agent, severity) with mono-formatted entries.
- **Webhooks** — pipe `policy.violated`, `policy.created/updated`,
  `member.invited` into Slack/SIEM/anything. HMAC-signed
  payloads; SSRF guard rejects private/loopback/link-local targets at creation
  *and* at dispatch.

## Identity & access

- **Email/password auth** with JWT + secure cookies; login rate-limited.
- **SSO (WorkOS)** — optional; endpoints return 501 cleanly when unconfigured.
- **Org RBAC** — `ORG_ADMIN` / `POLICY_ADMIN` / `MEMBER` membership roles gate
  every mutating route; UI hides what the role can't do. Last-admin demotion
  blocked (409). Cross-org access denied at the middleware root.
- **Invites** — transactional email (Resend) with tokenized acceptance; tokens
  are single-use (atomic consume) and invite/password-reset flows share one
  hardened path. Unconfigured email falls back to logging, nothing breaks.
- **API keys** — per-org, hashed at rest, shown once, revocable, rate-limited;
  key auth is org-pinned (no cross-tenant reach).

## Dashboard

- Next.js app: setup wizard (resumable), policy CRUD with **live policy tester**,
  role tree editor, team management, API keys, audit views, violations feed,
  org settings, unified IDE/MCP setup page with copy-paste agent configs.
- **Light + dark mode** (persisted toggle), IBM Plex brand theme, responsive
  down to mobile, SWR data layer with error/retry states, a11y labels.

## API

- Express + TypeScript + Prisma/Postgres. OpenAPI/Swagger docs served at
  `/v1/docs` (spec at `/v1/docs/openapi.json`).
- Public compliance check endpoint per org: `POST /v1/orgs/:orgId/check`.
- Health (`/health`) + human-readable `/status` (DB, email, MCP mode) for IT.
- Hardened: helmet, pinned credentialed CORS, trust-proxy aware rate limits
  (global / auth / API-key / MCP tiers), zod validation on every body,
  structured error envelope, async-error safe.

## Self-hosting & delivery

- **docker-compose stack** — postgres 16 + API + dashboard; API healthcheck
  gates dashboard start; same-origin `/v1` proxy baked at build.
- **One-command install** — `install.sh` (Linux/macOS) / `install.ps1`
  (Windows); generates secrets, guards against stale-volume/lost-.env foot-guns,
  chmod-600 env files.
- **Offline bundle** — `build-bundle.sh` produces a single tarball (images +
  compose + installer + hooks); no registry access needed on the target.
- **Podman support** — rootless-friendly, Mac machine init handled, systemd
  unit generation documented.
- **Ops docs** — README covers upgrade flow, `pg_dump` backup/restore, and the
  git-hook rollout; deploy reference in `DEPLOY.md`.
- **Zero external calls** — everything in the core stack runs inside the
  customer's network; nothing phones home. Air-gap friendly (SSO via WorkOS and
  invite email via Resend are optional online features).

## Plans & limits (built-in gating)

| Plan | Members | Policies | API keys | Evals/month |
|---|---|---|---|---|
| FREE | 5 | 10 | 5 | 5,000 |
| TEAM | 50 | 100 | 10 | 250,000 |
| ENTERPRISE | unlimited | unlimited | unlimited | unlimited |

Over-limit actions return a clear "contact sales" error; usage counters tracked
per org per period.

## Developer experience

- `./dev.sh` — one-command local stack (dockerized postgres + hot-reload API +
  dashboard). `./dev.sh --down` removes the dev database.
- Monorepo npm workspaces: `api`, `dashboard`, `packages/core` (shared policy
  engine + evaluator), `mcp` (standalone server/CLI), `extension`.
- Test suites: API (Jest, incl. SSRF + MCP transport tests), MCP core tests,
  dashboard Playwright e2e; CI-gated deploys.
