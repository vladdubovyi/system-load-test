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

4. Add **Variables** on the backend service (Variables tab → New Variable, or RAW Editor):

   ```env
   ASPNETCORE_ENVIRONMENT=Production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   CORS_ORIGINS=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
   ```

   - `DATABASE_URL` — reference the Postgres service (use your DB service name if not `Postgres`)
   - `CORS_ORIGINS` — reference the frontend service's public domain (create the frontend service first, or add this variable after)

   Railway docs: https://docs.railway.com/guides/variables#reference-variables

5. Deploy and confirm `GET /api/health` works on the backend's public URL

---

## Step 3: Add the frontend service

1. In the same project: New → GitHub Repo → select the **same** repository again
2. Open the service → **Settings**
3. Set config file path to:

   ```
   /railway.toml
   ```

4. Add **Variables** on the frontend service:

   ```env
   VITE_API_URL=https://${{backend.RAILWAY_PUBLIC_DOMAIN}}
   ```

   Replace `backend` with your backend **service name** if different.

   `RAILWAY_PUBLIC_DOMAIN` is provided automatically by Railway for each service.

5. Deploy the frontend

---

## Step 4: Review and deploy variable changes

Railway stages variable changes — click **Deploy** after adding or editing variables.

If you created the backend before the frontend, go back to the backend and set:

```env
CORS_ORIGINS=https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}
```

---

## Environment variables summary

You do **not** look these up externally. Configure them in each service's **Variables** tab:

| Variable | Service | Value |
|----------|---------|-------|
| `DATABASE_URL` | Backend | `${{Postgres.DATABASE_URL}}` |
| `CORS_ORIGINS` | Backend | `https://${{frontend.RAILWAY_PUBLIC_DOMAIN}}` |
| `VITE_API_URL` | Frontend | `https://${{backend.RAILWAY_PUBLIC_DOMAIN}}` |

Service names (`Postgres`, `backend`, `frontend`) must match what you named each service in Railway. Use the autocomplete dropdown in the Variables UI to pick references.

Source: https://docs.railway.com/guides/variables

---

## What the config files do

### `/backend/railway.toml`

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "backend/Dockerfile"
watchPatterns = ["backend/**"]

[deploy]
startCommand = "dotnet SystemDesignSimulator.Api.dll --urls http://0.0.0.0:$PORT"
healthcheckPath = "/api/health"
```

- `dockerfilePath` — documented in https://docs.railway.com/reference/config-as-code#dockerfile-path
- `watchPatterns` — documented in https://docs.railway.com/reference/config-as-code#watch-patterns
- `startCommand` — documented in https://docs.railway.com/reference/config-as-code#start-command
- `healthcheckPath` — documented in https://docs.railway.com/reference/config-as-code#healthcheck-path

### `/railway.toml` (frontend)

```toml
[build]
buildCommand = "npm ci && npm run build"
watchPatterns = ["src/**", "public/**", "index.html", "package.json", "vite.config.ts"]

[deploy]
startCommand = "npm run preview -- --host 0.0.0.0 --port $PORT"
```

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
