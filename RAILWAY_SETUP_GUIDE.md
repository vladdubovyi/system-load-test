# Railway Setup Guide - Both Frontend & Backend

Railway can host **everything** — frontend, backend, and PostgreSQL — in one project. You do **not** need Vercel.

> **If your first deploy failed:** Railway likely tried to build the whole monorepo as one app. Fix it by creating **two services** from the same repo with different **Root Directory** settings (see below). Do **not** use a single service at the repository root.

---

## 🎯 Recommended: One Railway Project, Three Services

| Service | Root Directory | Purpose |
|---------|----------------|---------|
| `postgres` | (managed) | Database |
| `backend` | `backend/SystemDesignSimulator.Api` | ASP.NET Core API |
| `frontend` | `.` (repo root) | Vite static app |

Build configs are included via `nixpacks.toml` in each root directory.

---

### Step 1: Create Railway Project

1. Go to [railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Choose `vladdubovyi/system-load-test`

### Step 2: Add PostgreSQL Database

1. In your project, click "New"
2. Select "Database" → "PostgreSQL"
3. Railway provisions it automatically
4. Copy the connection string for later

### Step 3: Deploy Backend Service

1. In your project, click "New"
2. Select "GitHub Repo" (same repo)
3. Click "Add Service"
4. **Configure the backend service:**

   **Settings → General:**
   - Service Name: `backend` or `api`
   - Root Directory: `backend/SystemDesignSimulator.Api`
   - Watch Paths: `backend/**`

   **Settings → Build:**
   - Builder: Nixpacks (auto-detected)
   - Build Command: 
     ```bash
     dotnet restore && dotnet publish -c Release -o out
     ```

   **Settings → Deploy:**
   - Start Command:
     ```bash
     dotnet out/SystemDesignSimulator.Api.dll --urls http://0.0.0.0:$PORT
     ```

   **Variables (Important!):**
   ```env
   ASPNETCORE_ENVIRONMENT=Production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   CORS_ORIGINS=https://your-frontend.railway.app
   PORT=5000
   ```

5. Click "Deploy"
6. Wait for deployment to complete (~2-3 minutes)
7. **Copy your backend URL** (e.g., `https://backend-production-xxx.railway.app`)

### Step 4: Deploy Frontend Service

1. In the same project, click "New" → "GitHub Repo"
2. **Configure the frontend service:**

   **Settings → General:**
   - Service Name: `frontend` or `web`
   - Root Directory: `.` (repository root)
   - Watch Paths: `src/**`, `public/**`, `index.html`, `package.json`, `vite.config.ts`

   **Settings → Build:**
   - Builder: Nixpacks (auto-detected)
   - Build Command:
     ```bash
     npm install && npm run build
     ```

   **Settings → Deploy:**
   - Start Command:
     ```bash
     npm run preview -- --host 0.0.0.0 --port $PORT
     ```

   **Variables (Important!):**
   ```env
   VITE_API_URL=https://backend-production-xxx.railway.app
   PORT=3000
   ```
   *(Replace with your actual backend URL from Step 3)*

3. Click "Deploy"
4. Wait for deployment (~1-2 minutes)
5. **Copy your frontend URL**

### Step 5: Update CORS Settings

1. Go back to backend service
2. Update `CORS_ORIGINS` variable with your frontend URL:
   ```env
   CORS_ORIGINS=https://frontend-production-xxx.railway.app
   ```
3. Backend will auto-redeploy

### Step 6: Test Everything

1. Visit your frontend URL
2. Open browser console (F12)
3. Click "Choose Challenge"
4. If you see challenges, it works! 🎉

---

## 🐛 Troubleshooting Build Failures

### Issue 1: "Cannot find .csproj file"

**Problem:** Railway is looking in wrong directory

**Solution:**
```bash
# In Railway Settings → Root Directory, set:
backend/SystemDesignSimulator.Api
```

### Issue 2: "npm not found" (Backend service)

**Problem:** Railway detected it as Node.js project instead of .NET

**Solution:**
1. Go to Settings → Build
2. Add custom Nixpacks configuration:
   ```toml
   [phases.setup]
   providers = ["dotnet"]
   ```

### Issue 3: ".NET SDK not found"

**Problem:** Wrong .NET version

**Solution:**
Add to your backend `SystemDesignSimulator.Api.csproj`:
```xml
<PropertyGroup>
  <TargetFramework>net8.0</TargetFramework>
</PropertyGroup>
```

### Issue 4: "Database connection failed"

**Problem:** Connection string format

**Solution:**
Check that `DATABASE_URL` variable is set:
```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Railway auto-fills this variable reference.

### Issue 5: Frontend builds but shows blank page

**Problem:** Environment variable not set

**Solution:**
```env
VITE_API_URL=https://your-backend.railway.app
```

Make sure it starts with `VITE_` (required by Vite)

### Issue 6: CORS errors in browser

**Problem:** Backend doesn't allow frontend origin

**Solution:**
Update backend CORS_ORIGINS to include frontend URL:
```env
CORS_ORIGINS=https://your-frontend.railway.app,http://localhost:5173
```

### Issue 7: "Port already in use"

**Problem:** Not using Railway's PORT variable

**Solution:**
Make sure start command uses `$PORT`:
```bash
dotnet run --urls http://0.0.0.0:$PORT
```

### Issue 8: Build takes too long / times out

**Problem:** Installing too many dependencies

**Solution:**
For frontend, use cached builds:
1. Go to Settings → Build
2. Enable "Use Cache"

---

## 📋 Quick Reference

### Backend Service Configuration

**Root Directory:**
```
backend/SystemDesignSimulator.Api
```

**Build Command:**
```bash
dotnet restore && dotnet publish -c Release -o out
```

**Start Command:**
```bash
dotnet out/SystemDesignSimulator.Api.dll --urls http://0.0.0.0:$PORT
```

**Environment Variables:**
```env
ASPNETCORE_ENVIRONMENT=Production
DATABASE_URL=${{Postgres.DATABASE_URL}}
CORS_ORIGINS=https://frontend-production-xxx.railway.app
```

### Frontend Service Configuration

**Root Directory:**
```
.
```
*(Leave as repository root)*

**Build Command:**
```bash
npm install && npm run build
```

**Start Command:**
```bash
npm run preview -- --host 0.0.0.0 --port $PORT
```

**Environment Variables:**
```env
VITE_API_URL=https://backend-production-xxx.railway.app
```

---

## 🔍 Check Build Logs

To see what's failing:

1. Go to your service in Railway
2. Click "Deployments" tab
3. Click the failed deployment
4. View logs to see exact error

**Common error patterns:**

- `Error: Cannot find module` → Missing dependencies
- `dotnet: command not found` → Wrong builder detected
- `ENOENT: no such file` → Wrong root directory
- `Port 5000 is already in use` → Not using $PORT variable
- `Connection refused` → Database not accessible

---

## 💡 Alternative: Nixpacks Configuration File

If Railway auto-detection fails, create `nixpacks.toml` in each root:

### Backend: `backend/nixpacks.toml`
```toml
[phases.setup]
nixPkgs = ['dotnet-sdk-8']

[phases.install]
cmds = ['dotnet restore']

[phases.build]
cmds = ['dotnet publish -c Release -o out']

[start]
cmd = 'dotnet out/SystemDesignSimulator.Api.dll --urls http://0.0.0.0:$PORT'
```

### Frontend: `nixpacks.toml` (root)
```toml
[phases.setup]
nixPkgs = ['nodejs-20_x']

[phases.install]
cmds = ['npm install']

[phases.build]
cmds = ['npm run build']

[start]
cmd = 'npm run preview -- --host 0.0.0.0 --port $PORT'
```

---

## 🎯 Pro Tips

### Tip 1: Use Railway CLI for Debugging
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Link to your project
railway link

# View logs
railway logs

# Run commands in Railway environment
railway run npm run build
```

### Tip 2: Set Up Preview Environments
```yaml
# railway.toml in root
[environments.production]
[environments.staging]
```

Deploy staging from `develop` branch, production from `main`.

### Tip 3: Use Shared Variables
Create variables that both services can reference:
```env
API_URL=${{backend.RAILWAY_PUBLIC_DOMAIN}}
```

### Tip 4: Health Checks
Railway automatically health checks your services on the root path.
Make sure `/` or `/health` returns 200 OK.

### Tip 5: Resource Limits
On free tier:
- $5 credit = ~500 hours compute
- Monitor usage in Railway dashboard
- Use "Sleep on idle" to save credits

---

## 📊 Cost Estimate (Railway Only)

| Resource | Usage | Cost |
|----------|-------|------|
| Frontend | ~100 hours/month | ~$1 |
| Backend | ~200 hours/month | ~$2 |
| PostgreSQL | ~150 hours/month | ~$1.50 |
| **Total** | | **~$4.50/month** |

Free tier: **$5 credit/month** → Runs free! 🎉

---

## 🆘 Still Having Issues?

1. **Check Railway Status Page**: [status.railway.app](https://status.railway.app)
2. **Railway Discord**: [discord.gg/railway](https://discord.gg/railway)
3. **View Build Logs**: Railway Dashboard → Service → Deployments → Click failed deployment
4. **Check GitHub Actions**: Make sure CI passes before deploying

---

## ✅ Success Checklist

After deployment, verify:

- [ ] Backend URL accessible: `https://your-backend.railway.app/health`
- [ ] Frontend URL accessible: `https://your-frontend.railway.app`
- [ ] API health check returns 200: `/api/health`
- [ ] Frontend can fetch challenges (check Network tab)
- [ ] No CORS errors in browser console
- [ ] Database connection working (check backend logs)
- [ ] Challenge selector shows 4 challenges
- [ ] Can place components and create connections

---

## 🚀 You're All Set!

Both frontend and backend running on Railway with:
- ✅ Automatic HTTPS
- ✅ Auto-scaling
- ✅ Zero-downtime deploys
- ✅ Automatic backups (database)
- ✅ Health monitoring

**Next:** Add your Railway URL to the README! 🎉
