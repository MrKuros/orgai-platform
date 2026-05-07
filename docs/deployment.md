# Deployment Guide

## Prerequisites
- Railway account (railway.app)
- Vercel account (vercel.com)
- Neon PostgreSQL database (neon.tech)
- WorkOS account (workos.com)
- Domain: orgai.dev (Cloudflare DNS)

## 1. Deploy the API to Railway

### Create Railway project
1. Go to railway.app → New Project → Deploy from GitHub
2. Select `orgai-platform` repo
3. Set root directory to `api/`
4. Railway will detect the Dockerfile automatically

### Set environment variables in Railway
Go to your service → Variables → add:
DATABASE_URL=<your Neon connection string>
JWT_SECRET=<random 32-char string>
WORKOS_API_KEY=<from workos.com dashboard>
WORKOS_CLIENT_ID=<from workos.com dashboard>
WORKOS_REDIRECT_URI=https://api.orgai.dev/v1/auth/sso/callback
NODE_ENV=production
CORS_ORIGIN=https://app.orgai.dev
PORT=8080

### Set custom domain
Railway service → Settings → Custom Domain → `api.orgai.dev`
In Cloudflare DNS: add CNAME `api` → Railway URL

## 2. Deploy MCP to Railway

1. In same Railway project → New Service → Deploy from GitHub
2. Set root directory to `mcp/`
3. Set environment variables:
PORT=3001
COMPLY_API_URL=https://api.orgai.dev
NODE_ENV=production
4. Custom domain: `mcp.orgai.dev`
In Cloudflare DNS: add CNAME `mcp` → Railway MCP service URL

## 3. Deploy Dashboard to Vercel

1. Go to vercel.com → New Project → Import `orgai-platform`
2. Set root directory to `dashboard/`
3. Set environment variables:
NEXT_PUBLIC_API_URL=https://api.orgai.dev
4. Custom domain: `app.orgai.dev`
In Cloudflare DNS: add CNAME `app` → `cname.vercel-dns.com`

## 4. Set GitHub Actions secrets

Go to GitHub → orgai-platform repo → Settings → Secrets → Actions:

| Secret | Where to get it |
|--------|----------------|
| `RAILWAY_TOKEN` | Railway → Account Settings → Tokens |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel → Account Settings → General |
| `VERCEL_PROJECT_ID` | Vercel → Project → Settings → General |
| `DATABASE_URL_TEST` | Neon → create second database `orgai-test` |

## 5. DNS Summary (Cloudflare)

| Subdomain | Type | Target |
|-----------|------|--------|
| `api.orgai.dev` | CNAME | Railway API service URL |
| `app.orgai.dev` | CNAME | `cname.vercel-dns.com` |
| `mcp.orgai.dev` | CNAME | Railway MCP service URL |

## 6. Seed production database

After first deploy:
```bash
railway run --service orgai-api npm run db:seed
```
Note the API key printed to logs — this is your first admin key.
