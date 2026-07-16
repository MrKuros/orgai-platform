# How OrgAI Works

Technical companion to the [README](README.md). Read this to understand what
actually happens on every check — as a contributor, a self-host operator, or
an evaluating security team.

## The one-sentence version

Admins define policies bound to org roles; every AI agent, git commit, and CI
run asks the OrgAI API "does this content violate the policies for this
developer's roles?" — and every answer is recorded in an append-only audit
trail.

## Request flow

```
agent writes code ──► MCP check_compliance ──► POST /v1/orgs/:id/check ─┐
developer commits ──► pre-commit hook ───────► POST /v1/orgs/:id/check ─┼─► resolve roles ─► run evaluators ─► audit row
CI pipeline ────────► hook in ref-range mode ► POST /v1/orgs/:id/check ─┘        │
                                                                                  ▼
                                                                     { passed, violations[] }
```

All three enforcement surfaces hit the **same endpoint** with the same
semantics — there is exactly one policy engine and one decision path.

- **MCP layer (steering, advisory):** the agent calls `check_compliance` /
  `check_command` / `scan_diff` *before* applying a change. A blocked result
  tells the agent to revise (autofix on) or stop and ask the human (autofix
  off). An agent can ignore this — that's why the next two layers exist.
- **Git hook (hard):** the POSIX-sh pre-commit hook checks every staged text
  file. Any enforced ERROR violation blocks the commit. `COMPLY_SKIP=1`
  bypasses once — and fires an audit event (`hook.bypassed`) naming the repo
  and actor. Unreachable server = commit blocked (fail-closed).
- **CI (hard):** the same hook script invoked as `pre-commit <base> <head>`
  checks the diff range and fails the build on enforced ERROR violations.

## Policy resolution

Policies attach to **roles**; roles form a single-parent inheritance tree
(`junior → senior → cto`). A member holds **one or more** assigned roles.

For a check as role `R`:

1. Walk `R`'s inheritance chain to the root, collecting every bound policy.
2. Same policy name appears twice in one chain → the **ancestor wins**
   (a superior's rule dominates a subordinate's) — *except* a SHADOW ancestor
   never displaces an ENFORCED policy (a rollout flag must not disable real
   enforcement).
3. For multiple roles (`"payments-dev,ml-dev"`): resolve each chain, take the
   **union**. Same policy name across branches → strictest wins:
   **ENFORCED beats SHADOW, then ERROR beats WARNING.**
4. Unknown role anywhere → the whole check **fails closed** (404, treated as
   a block by every client).

Results are cached in-process for 5 minutes; every policy/role mutation
invalidates the org's cache entries.

## Evaluation

Policies carry a deterministic evaluator — a compile-checked regex (code) or
command pattern (terminal commands). No LLM is in the evaluation path: checks
are milliseconds and cost zero tokens. `evaluatorType: none` policies are
steering-only guidance the agent reads via `get_policy`.

Severity and status decide the outcome per violation:

| | ENFORCED | SHADOW |
|---|---|---|
| **ERROR** | blocks (agent guidance BLOCKED, commit/build fail) | reported + audit-logged, never blocks |
| **WARNING** | reported, allowed | reported + audit-logged, never blocks |

`passed` is computed **only from enforced ERROR violations**. Shadow hits are
flagged `shadow: true` in responses, printed as `[SHADOW ERROR]` by the hook,
counted separately (`shadowCount`) by MCP tools, and excluded from webhooks
and the live violations feed — they are measurements, not alerts.

**Shadow rollout loop:** import or create a policy as SHADOW → watch
`policy.shadow_violated` events in the audit trail → tune the pattern → flip
to ENFORCED (the flip itself is audit-logged).

## API keys and identity

Two kinds of keys, one rule:

- **Developer-bound key** (has a `memberId`): every check runs as that
  member's assigned roles — a client-supplied `roleName` is **ignored**, so
  nobody selects a weaker policy set by editing their config. Audit rows
  carry the developer's identity (checks, violations, bypasses). Deleting or
  deactivating the member kills the key instantly.
- **Org-wide key** (no binding, for CI/services): must send `roleName`
  explicitly. Role-less checks are rejected with a 400 — never silently
  defaulted.

Dashboard logins (JWT) can also run checks — the live policy evaluator uses
this — attributed to the logged-in user.

**Deactivation:** `Membership.active = false` immediately blocks dashboard
access, SSE feeds, SSO re-entry, and all bound keys, while keeping the
member's audit history. Self-deactivation and removing the last active admin
are rejected (409).

## Audit trail

Append-only rows (`AuditLog`), one per event. The load-bearing actions:

| action | written when |
|---|---|
| `policy.checked` | every /check — role, file, passed, blocker/warning/shadow counts |
| `policy.violated` | each enforced ERROR hit |
| `policy.shadow_violated` | each shadow hit (any severity) — the rollout noise measurement |
| `hook.bypassed` | `COMPLY_SKIP=1` used |
| `policy.pack_imported` | starter pack imported (which policies, which status) |
| `member.deactivated` / `member.reactivated` | access toggled |
| `policy.*`, `role.*`, `member.*`, `apikey.*` | all admin mutations |

Export: dashboard CSV (formula-injection-safe) or `GET /audit` with an
`audit:read`-scoped key for SIEM pulls; `policy.violated` also dispatches
signed webhooks (HMAC-SHA256, SSRF-guarded, 3 retries).

This is **evidence** for SOC 2 / ISO 27001 / HIPAA / DPDP controls — who was
subject to what policy, what was blocked, who bypassed — not a certification.

## Data model (the short version)

```
Organization ─┬─ Role (single-parent tree) ──┬─ PolicyBinding ── Policy (severity, status, evaluator, versions)
              ├─ Membership (active flag) ───┴─ assignedRoles (many-to-many)
              ├─ ApiKey (hashed, optional memberId → Membership)
              ├─ AuditLog (append-only)
              └─ Webhook
```

## Repo layout

```
packages/core/   Policy engine + evaluator — THE single implementation
api/             Express + Prisma + PostgreSQL; serves REST, MCP (/mcp), setup.sh, the hook
dashboard/       Next.js admin UI
mcp/             Standalone MCP CLI (orgai-comply) — thin wrapper over packages/core
extension/       VS Code extension (optional cloud-LLM tool — NOT part of the self-hosted enforcement path)
selfhost/        Offline bundle builder, docker-compose, hook copy, operator README
api/src/policy-packs/  Importable starter packs (community PRs welcome)
```

Two files are deliberately duplicated and must stay byte-identical:
`api/src/hooks/pre-commit` ≡ `selfhost/hooks/pre-commit` (CI-served vs
bundle-shipped copies of the same hook), and `mcp/src/tools.ts` ≡
`api/src/mcp/tools.ts`. If you touch one, copy it over the other.
