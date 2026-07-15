# Railway Build Failure Troubleshooting

## 🔍 Common Build Failures & Solutions

### Problem 1: "Cannot find .csproj file" or "No buildable projects found"

**Symptoms:**
```
Error: Could not find a project file in the current directory
```

**Root Cause:** Railway is looking for .NET project in wrong directory

**Solution:**
1. In Railway dashboard, go to your backend service
2. **Settings → Service Settings → Root Directory**
3. Set to: `backend/SystemDesignSimulator.Api`
4. Redeploy

---

### Problem 2: "Multiple project types detected" or Node.js detected for backend

**Symptoms:**
```
Warning: Found both package.json and .csproj
Nixpacks detected: nodejs
```

**Root Cause:** Railway is building from the repository root instead of the backend subdirectory.

**Solution:**
1. Open the **backend** service → **Settings → Root Directory**
2. Set to: `backend/SystemDesignSimulator.Api`
3. Redeploy

The repo no longer includes a root `railway.json` (it caused this confusion).

---

### Problem 3: Build succeeds but service crashes immediately

**Symptoms:**
```
[FATAL] Application startup exception
```

**Root Cause:** Missing environment variables

**Solution:**
Check your backend service has these variables:
```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
ASPNETCORE_ENVIRONMENT=Production
CORS_ORIGINS=https://your-frontend.railway.app
```

---

### Problem 4: "Database connection failed"

**Symptoms:**
```
Npgsql.NpgsqlException: Connection refused
```

**Root Cause:** Database not accessible or wrong connection string

**Solution:**
1. Make sure PostgreSQL database is in the SAME Railway project
2. Check backend variables:
   ```env
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   ```
   (Note: Use the variable reference, not the actual URL)
3. Make sure services are in same project (private networking)

---

### Problem 5: Frontend build fails with "Vite not found"

**Symptoms:**
```
Error: Cannot find module 'vite'
```

**Root Cause:** Dependencies not installed

**Solution:**
1. Check build command is correct:
   ```bash
   npm install && npm run build
   ```
   NOT just `npm run build`

2. Or use `npm ci` for faster installs:
   ```bash
   npm ci && npm run build
   ```

---

### Problem 6: Build times out

**Symptoms:**
```
Build exceeded time limit of 15 minutes
```

**Root Cause:** Installing too many dependencies or slow network

**Solution:**
1. Enable build cache in Railway settings
2. Use `npm ci` instead of `npm install` (faster)
3. For backend: Make sure Nixpacks uses correct .NET SDK version

---

### Problem 7: "Port already in use"

**Symptoms:**
```
Error: listen EADDRINUSE: address already in use :::5000
```

**Root Cause:** Not using Railway's dynamic PORT variable

**Solution:**
Check your start command uses `$PORT`:

**Backend:**
```bash
dotnet SystemDesignSimulator.Api.dll --urls http://0.0.0.0:$PORT
```

**Frontend:**
```bash
npm run preview -- --host 0.0.0.0 --port $PORT
```

---

### Problem 8: CORS errors after deployment

**Symptoms:**
```
Access to fetch at 'https://backend.railway.app' from origin 'https://frontend.railway.app' 
has been blocked by CORS policy
```

**Root Cause:** Backend doesn't allow frontend origin

**Solution:**
1. Go to backend service → Variables
2. Update `CORS_ORIGINS`:
   ```env
   CORS_ORIGINS=https://frontend-production-xxxx.railway.app
   ```
   (Replace with your actual frontend URL)
3. Backend will auto-redeploy

---

## 📋 Step-by-Step Debugging

### Step 1: Identify which service is failing
- Backend (API)?
- Frontend (Web)?
- Database?

### Step 2: Check the build logs
1. Go to Railway dashboard
2. Click the failing service
3. Click "Deployments" tab
4. Click the failed deployment
5. Read the error messages

### Step 3: Common error keywords to look for

| Error Keyword | Likely Issue |
|---------------|--------------|
| `dotnet: command not found` | Wrong builder, needs Nixpacks config |
| `Cannot find module` | Missing dependencies, check package.json |
| `ENOENT: no such file` | Wrong root directory |
| `Connection refused` | Database not accessible |
| `Port already in use` | Not using $PORT variable |
| `.csproj not found` | Wrong root directory for backend |
| `npm not found` | Wrong builder for frontend |

---

## 🔧 Railway Service Settings Checklist

### Backend Service ✅

**General:**
- [x] Service name: `backend` or `api`
- [x] Root directory: `backend/SystemDesignSimulator.Api`
- [x] Watch paths: `backend/**`

**Build:**
- [x] Builder: Nixpacks
- [x] Build command: `dotnet restore && dotnet publish -c Release -o out`

**Deploy:**
- [x] Start command: `dotnet out/SystemDesignSimulator.Api.dll --urls http://0.0.0.0:$PORT`

**Variables:**
- [x] `ASPNETCORE_ENVIRONMENT=Production`
- [x] `DATABASE_URL=${{Postgres.DATABASE_URL}}`
- [x] `CORS_ORIGINS=<frontend-url>`

### Frontend Service ✅

**General:**
- [x] Service name: `frontend` or `web`
- [x] Root directory: `.` (repository root)
- [x] Watch paths: `src/**`, `public/**`, `package.json`

**Build:**
- [x] Builder: Nixpacks
- [x] Build command: `npm ci && npm run build`

**Deploy:**
- [x] Start command: `npm run preview -- --host 0.0.0.0 --port $PORT`

**Variables:**
- [x] `VITE_API_URL=<backend-url>`

---

## 🚨 Emergency Fixes

### If nothing works, try this:

1. **Delete ALL services** in Railway project
2. **Keep only the PostgreSQL database**
3. **Start fresh with separate services:**

#### Backend First:
```bash
# In Railway:
New → GitHub Repo → system-load-test
Root Directory: backend/SystemDesignSimulator.Api
Variables:
  DATABASE_URL=${{Postgres.DATABASE_URL}}
  ASPNETCORE_ENVIRONMENT=Production
```

#### Frontend Second:
```bash
# In Railway:
New → GitHub Repo → system-load-test
Root Directory: . (leave empty)
Variables:
  VITE_API_URL=https://<backend-url-from-step-1>
```

---

## 📞 Get Help

1. **Check build logs first** - 90% of issues are visible in logs
2. **Railway Discord**: [discord.gg/railway](https://discord.gg/railway)
3. **GitHub Issues**: Open an issue with your build logs
4. **Railway Status**: Check [status.railway.app](https://status.railway.app)

---

## ✅ Success Indicators

Your deployment is successful when:
- ✅ Build completes without errors
- ✅ Service shows "Active" status (green)
- ✅ Health checks pass
- ✅ Backend responds to `/health` endpoint
- ✅ Frontend loads without errors
- ✅ No CORS errors in browser console

---

**Pro Tip:** Always deploy backend FIRST, then frontend. Frontend needs the backend URL!
