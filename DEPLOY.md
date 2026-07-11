# OrgAI Production Deployment (Render + Neon + Vercel)

Total cost at launch: **$0/month** (free tiers). Upgrade path noted at the bottom.

Architecture:

| Piece | Host | URL |
|---|---|---|
| API + MCP endpoints | Render (Docker, free) | https://api.orgai.dev |
| PostgreSQL | Neon (free) | — |
| Dashboard | Vercel (free) | https://app.orgai.dev |
| Landing page | Vercel (free, static) | https://orgai.dev |
| Email | Resend (free, 3k/mo) | — |

The MCP server is served by the API itself (`/mcp/sse`) — no separate service.

---

## 1. Database — Neon (~5 min)

1. Sign up at https://neon.tech (GitHub login works).
2. Create a project: name `orgai`, Postgres 16, pick the region closest to your Render region (e.g. `aws-us-east-2` ↔ Render Ohio).
3. From the project dashboard, copy **two** connection strings:
   - **Pooled** (has `-pooler` in the hostname) → this is `DATABASE_URL`
   - **Direct** (no `-pooler`) → this is `DIRECT_DATABASE_URL`
   Both must end with `?sslmode=require`.

## 2. API — Render (~10 min)

1. Sign up at https://render.com with the GitHub account that owns `MrKuros/orgai-platform`.
2. Commit and push this repo (including `render.yaml` at the repo root).
3. Render dashboard → **New → Blueprint** → select the `orgai-platform` repo. It reads `render.yaml` and proposes the `orgai-api` service.
4. When prompted for env vars, paste:
   - `DATABASE_URL` = Neon pooled string
   - `DIRECT_DATABASE_URL` = Neon direct string
   - `RESEND_API_KEY` = leave blank for now (step 5)
5. Deploy. First build takes ~5 min. Migrations run automatically at boot (`prisma migrate deploy`).
6. (Recommended) Render → orgai-api → Settings → **Auto-Deploy: After CI Checks Pass**.
   This gates production deploys on the GitHub Actions test jobs, replacing the
   `needs: [test-api]` gating the old Railway job used to do.
7. Verify: `curl https://orgai-api.onrender.com/health` → `{"status":"ok"}`.

## 3. Dashboard — Vercel (~5 min)

1. Sign up at https://vercel.com with GitHub.
2. **Add New → Project** → import `orgai-platform`, set **Root Directory** to `dashboard`.
3. Env var: `NEXT_PUBLIC_API_URL` = `https://api.orgai.dev` (or the onrender.com URL until DNS is set).
4. Deploy. Note: `NEXT_PUBLIC_*` is baked at build time — redeploy after changing it.

## 4. DNS — orgai.dev (~10 min, propagation up to 1 h)

At your registrar's DNS panel:

| Record | Name | Value |
|---|---|---|
| CNAME | `api` | `orgai-api.onrender.com` |
| CNAME | `app` | `cname.vercel-dns.com` |
| A | `@` (root, for landing) | `76.76.21.21` (Vercel) |
| CNAME | `www` | `cname.vercel-dns.com` |

Then:
- Render → orgai-api → Settings → Custom Domains → add `api.orgai.dev` (auto-TLS).
- Vercel → dashboard project → Domains → add `app.orgai.dev`.
- Vercel → landing project (step 6) → Domains → add `orgai.dev` + `www.orgai.dev`.

## 5. Email — Resend (~10 min)

1. Sign up at https://resend.com (free: 3,000 emails/mo, 100/day).
2. **Domains → Add Domain** → `orgai.dev` → add the DKIM/SPF records it shows to your DNS.
3. **API Keys → Create** → set it as `RESEND_API_KEY` on the Render service → redeploy.
4. Without the key, the API still works — invite/reset emails are logged instead of sent.

## 6. Landing page — Vercel (~5 min)

The `orgai-site` folder is static HTML. In Vercel: **Add New → Project**, import it
(or `vercel deploy` from the folder), framework preset "Other". Attach `orgai.dev` domain.

## Continuous deployment

`.github/workflows/ci.yml` runs **tests only** — `test-api`, `test-mcp`,
`test-dashboard`, `test-dashboard-e2e`, `test-extension`. It no longer deploys.

Deploys are driven by the platforms' native git integration:

| Target | Trigger | Migrations |
|---|---|---|
| API (Render) | push to `main` → Render Blueprint rebuilds | at boot, `prisma migrate deploy` |
| Dashboard (Vercel) | push to `main` → Vercel GitHub app rebuilds | n/a |

No `RAILWAY_*` or `VERCEL_*` secrets are needed in GitHub anymore — you can delete
them from repo settings. The only CI secrets still used are `DATABASE_URL_TEST`
(API test job) and `E2E_TEST_EMAIL` / `E2E_TEST_PASSWORD` (E2E job).

## 7. Smoke test

```bash
API=https://api.orgai.dev
# health
curl -s $API/health
# signup
curl -s -X POST $API/v1/auth/signup -H 'Content-Type: application/json' -d '{
  "email":"you@example.com","password":"changeme123",
  "firstName":"Test","lastName":"User","orgName":"Test Org","orgSlug":"test-org"}'
# then log in at https://app.orgai.dev, create a policy, an API key,
# and run a check:
curl -s -X POST $API/v1/orgs/<orgId>/check -H "x-api-key: <key>" \
  -H 'Content-Type: application/json' \
  -d '{"type":"code","content":"console.log(1)","roleName":"junior"}'
```

## Manual billing operations (until Stripe is added)

Plans: `FREE` (5 members / 10 policies / 5 API keys / 5k evals/mo),
`TEAM` (50 / 100 / 10 / 250k), `ENTERPRISE` (unlimited).

After a customer pays (Stripe payment link, invoice, whatever), upgrade them via Neon's SQL editor:

```sql
UPDATE "Organization" SET plan = 'TEAM' WHERE slug = '<customer-slug>';
```

Check usage:

```sql
SELECT o.slug, u.period, u.evaluations
FROM "UsageCounter" u JOIN "Organization" o ON o.id = u."orgId"
ORDER BY u.period DESC;
```

## Free-tier caveats & upgrade path

- **Render free** spins down after 15 min idle → first request takes ~30–60 s.
  Fine for demos; upgrade to Starter ($7/mo) before onboarding paying customers —
  a compliance API that agents call synchronously cannot cold-start.
- **Neon free**: 0.5 GB storage, autosuspends compute — resume is fast (~1 s), fine.
- **Vercel free**: fine indefinitely for this traffic.
- First realistic paid bill: **$7/mo** (Render Starter). Everything else stays free
  until real scale.
