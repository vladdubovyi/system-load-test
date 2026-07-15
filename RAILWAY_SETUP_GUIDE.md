# Railway Deployment Guide

This guide uses only settings documented in [Railway Config as Code](https://docs.railway.com/config-as-code) and [Deploying a Monorepo](https://docs.railway.com/guides/monorepo).

Railway can host **frontend**, **backend**, and **PostgreSQL** in one project.

---

## Repository layout

This is an **isolated monorepo** (per Railway's terminology):

```
/
├── package.json          # frontend (Vite)
├── src/
├── railway.toml          # frontend service config
├── railway.json
└── backend/
    ├── Dockerfile
    ├── railway.toml      # backend service config
    └── SystemDesignSimulator.Api/
```

---

## Config files in this repo

| File | Service | Purpose |
|------|---------|---------|
| `/railway.toml` | Frontend | `buildCommand`, `startCommand`, `watchPatterns` |
| `/backend/railway.toml` | Backend API | `dockerfilePath`, `healthcheckPath`, `watchPatterns` |

Equivalent JSON versions exist at the same paths (`railway.json`).

Schema reference: https://railway.com/railway.schema.json

---

## Step 1: Create a Railway project

1. Go to [railway.app](https://railway.app) and create a new project
2. Add **PostgreSQL** (New → Database → PostgreSQL)

---

## Step 2: Add the backend service

1. New → GitHub Repo → select this repository
2. Open the new service → **Settings**
3. Under **Config-as-code**, set the config file path to:

   ```
   /backend/railway.toml
   ```

   Railway docs: the config file path is **absolute from the repository root** and does not follow any subdirectory scope.

   Source: https://docs.railway.com/config-as-code#using-a-custom-config-as-code-file

4. Add **Variables**:

   ```env
   ASPNETCORE_ENVIRONMENT=Production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   CORS_ORIGINS=https://<your-frontend-domain>
   ```

5. Deploy and copy the generated public URL (e.g. `https://backend-production-xxxx.up.railway.app`)

6. Verify: `GET https://<backend-url>/api/health` should return `200`

---

## Step 3: Add the frontend service

1. In the same project: New → GitHub Repo → select the **same** repository again
2. Open the service → **Settings**
3. Set config file path to:

   ```
   /railway.toml
   ```

4. Add **Variables**:

   ```env
   VITE_API_URL=https://<your-backend-url>
   ```

   `VITE_*` variables must be present at **build time** for Vite to embed them.

5. Deploy and copy the frontend public URL

---

## Step 4: Update backend CORS

On the backend service, set:

```env
CORS_ORIGINS=https://<your-frontend-domain>
```

Redeploy the backend after changing this variable.

---

## What the config files do

### `/backend/railway.toml`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "backend/Dockerfile"
watchPatterns = ["backend/**"]

[deploy]
healthcheckPath = "/api/health"
```

Docker `ENTRYPOINT` uses a shell so Railway's `PORT` is expanded. Do not add a `startCommand` with `$PORT` — it overrides the entrypoint without shell expansion.

### `/railway.toml` (frontend)

```toml
[build]
buildCommand = "npm run build"
watchPatterns = ["src/**", "public/**", "index.html", "package.json", "vite.config.ts"]

[deploy]
startCommand = "npm run preview -- --host 0.0.0.0 --port $PORT"
```

Railpack runs `npm ci` automatically; `buildCommand` only needs to build.

---

## Monorepo notes (from Railway docs)

From https://docs.railway.com/guides/monorepo:

- For isolated monorepos, Railway supports setting a **root directory** per service in the service **Settings** tab. If your dashboard shows this option, you can set:
  - Backend: `backend/SystemDesignSimulator.Api`
  - Frontend: repository root
- The config file path is always absolute (e.g. `/backend/railway.toml`), even when a root directory is set.
- `watchPatterns` in config-as-code limit which file changes trigger redeploys.

If you do **not** see a root directory setting in your dashboard, the config-as-code files above still work because build/start commands and `dockerfilePath` are relative to the repository root.

---

## GitHub Actions (optional)

The repo includes `.github/workflows/deploy-railway.yml`, but it requires a `RAILWAY_TOKEN` secret.

**Recommended:** let Railway deploy directly from GitHub (no Actions token needed). The GitHub Actions workflow skips deployment when `RAILWAY_TOKEN` is not configured.

---

## Cost

Railway free tier includes **$5/month** in usage credits. This MVP typically fits within that allowance.

---

## Troubleshooting

See [RAILWAY_TROUBLESHOOTING.md](./RAILWAY_TROUBLESHOOTING.md).

Official references:

- Config as code: https://docs.railway.com/config-as-code
- Config reference: https://docs.railway.com/reference/config-as-code
- Monorepo guide: https://docs.railway.com/guides/monorepo
