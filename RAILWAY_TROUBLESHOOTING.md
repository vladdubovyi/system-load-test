# Railway Troubleshooting

All solutions below reference [Railway Config as Code](https://docs.railway.com/config-as-code) and [Monorepo Guide](https://docs.railway.com/guides/monorepo).

---

## Build fails immediately after connecting the repo

**Likely cause:** Railway is using the wrong config file, or no config file is set.

**Fix:**

1. Open the service → **Settings**
2. Set **Config-as-code file** to the correct absolute path:
   - Backend: `/backend/railway.toml`
   - Frontend: `/railway.toml`
3. Redeploy

Config in code overrides dashboard build/deploy settings: https://docs.railway.com/config-as-code#understanding-config-source

---

## Backend builds as Node.js instead of .NET

**Likely cause:** Service is not using `/backend/railway.toml`, so Railway auto-detects the root `package.json`.

**Fix:** Set config file path to `/backend/railway.toml`. That file sets an explicit .NET `buildCommand`:

```toml
[build]
buildCommand = "dotnet publish backend/SystemDesignSimulator.Api/SystemDesignSimulator.Api.csproj -c Release -o backend/out"
```

---

## Backend build fails with `dotnet: not found`

**Cause:** Railpack detects the root `package.json` and installs Node only. A `buildCommand` with `dotnet publish` cannot work without the .NET SDK in that image.

**Fix:** Backend uses `builder = "DOCKERFILE"` in `/backend/railway.toml` so Railway builds with `backend/Dockerfile` (includes .NET SDK). Do not use a plain `buildCommand` for .NET in this monorepo layout.

---

## Backend Docker build fails with `SystemDesignSimulator.Api: not found`

**Cause:** Docker build context is the repository root, but `COPY` paths assumed the `backend/` folder.

**Fix:** Backend now uses Railpack with `buildCommand` (no Docker). If you switch back to Docker, prefix paths with `backend/`.

---

## Frontend build fails with `EBUSY` on `node_modules/.vite`

**Cause:** Railpack already runs `npm ci` before `buildCommand`. Running `npm ci` again causes a cache conflict.

**Fix:** `/railway.toml` uses `buildCommand = "npm run build"` only.

---

## Frontend cannot reach the API (CORS)

**Fix:** On the backend service, set:

```env
CORS_ORIGINS=https://<your-frontend-domain>
```

Use the exact public URL Railway assigns to the frontend service.

---

## `VITE_API_URL` not applied

Vite embeds `VITE_*` variables at **build** time.

**Fix:**

1. Add `VITE_API_URL` to the frontend service variables in Railway
2. Trigger a new deployment (rebuild)

---

## Database connection errors

**Fix:**

1. Ensure PostgreSQL is in the **same Railway project**
2. On the backend service:

   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```

   Use Railway's variable reference syntax so the backend receives the private database URL.

---

## Health check fails

The backend health endpoint is:

```
GET /api/health
```

`/backend/railway.toml` sets `healthcheckPath = "/api/health"`.

If you change the route, update `healthcheckPath` in the config file.

---

## Both services redeploy on every commit

**Fix:** `watchPatterns` in each config file limit redeploys:

- Backend: `["backend/**"]`
- Frontend: `["src/**", "public/**", "index.html", "package.json", "vite.config.ts"]`

Documented at: https://docs.railway.com/reference/config-as-code#watch-patterns

---

## Checking what config a deployment used

On the deployment details page, settings that came from a config file show a **file icon**. Hover to see which file and field supplied the value.

Source: https://docs.railway.com/config-as-code#understanding-config-source

---

## Using the Railway CLI with multiple services

When a project has multiple services from one repo, link the CLI to the correct service:

```bash
railway link
```

Source: https://docs.railway.com/guides/monorepo#using-the-cli

---

## GitHub Actions deploy fails with "Invalid RAILWAY_TOKEN"

The workflow in `.github/workflows/deploy-railway.yml` is optional. It skips deployment when `RAILWAY_TOKEN` is not set.

Either:

1. **Recommended:** rely on Railway's native GitHub integration (no token needed), or
2. Add `RAILWAY_TOKEN` from https://railway.app/account/tokens

---

## Still stuck?

1. Open the failed deployment in Railway → read the build log
2. Confirm the config file path is exactly `/backend/railway.toml` or `/railway.toml`
3. Check https://status.railway.app
