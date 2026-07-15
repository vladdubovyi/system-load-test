# Deployment Guide - System Design Simulator

## 🎯 Overview

This guide covers automated deployment pipelines for the System Design Simulator, including frontend, backend, and database with **free hosting options**.

---

## 🏆 Recommended Setup (Best Free Option)

### Option 1: Railway + Vercel (Recommended)
**Cost**: Free for both  
**Complexity**: Easy  
**Performance**: Excellent

| Component | Platform | Features |
|-----------|----------|----------|
| Frontend | Vercel | Auto-deploy, CDN, preview deployments |
| Backend + DB | Railway | .NET + PostgreSQL, auto-deploy, managed DB |

**Why this combo?**
- ✅ Vercel is the best platform for Vite/React apps
- ✅ Railway has excellent .NET support + managed PostgreSQL
- ✅ Both auto-deploy from GitHub
- ✅ Free tiers are very generous
- ✅ Minimal configuration required

---

## 📋 Deployment Options Comparison

### Frontend Options

| Platform | Free Tier | Auto Deploy | Custom Domain | Notes |
|----------|-----------|-------------|---------------|-------|
| **Vercel** | ✅ Unlimited | ✅ Yes | ✅ Yes | Best for Vite, 100GB bandwidth |
| **Netlify** | ✅ 300 build min/mo | ✅ Yes | ✅ Yes | Similar to Vercel |
| **Cloudflare Pages** | ✅ Unlimited | ✅ Yes | ✅ Yes | Fast global CDN |
| **GitHub Pages** | ✅ Yes | ⚠️ Manual setup | ✅ Yes | Limited features |

### Backend + Database Options

| Platform | Free Tier | .NET Support | PostgreSQL | Auto Deploy | Notes |
|----------|-----------|--------------|------------|-------------|-------|
| **Railway** | ✅ $5 credit/mo | ✅ Excellent | ✅ Included | ✅ Yes | Best for .NET |
| **Render** | ✅ 750 hrs/mo | ✅ Good | ✅ Included | ✅ Yes | All-in-one |
| **Fly.io** | ✅ 3 VMs free | ✅ Excellent | ✅ Included | ✅ Yes | Global edge |
| **Azure** | ✅ $200 credit | ✅ Best | ✅ Included | ✅ Yes | Microsoft stack |

---

## 🚀 Setup Instructions

## Option 1: Railway + Vercel (Recommended)

### Step 1: Deploy Backend to Railway

1. **Create Railway Account**
   ```bash
   # Visit https://railway.app
   # Sign in with GitHub
   ```

2. **Create New Project**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository
   - Railway will auto-detect the .NET project

3. **Configure Backend Service**
   ```bash
   # Railway will automatically:
   # - Detect the .csproj file
   # - Build using .NET 8
   # - Set up the service
   ```

4. **Add PostgreSQL Database**
   - In your Railway project, click "New"
   - Select "Database" → "PostgreSQL"
   - Railway will provision and configure it automatically

5. **Configure Environment Variables**
   - Go to your backend service → "Variables"
   - Add:
     ```
     ASPNETCORE_ENVIRONMENT=Production
     DATABASE_URL=${{Postgres.DATABASE_URL}}
     CORS_ORIGINS=https://your-app.vercel.app
     ```

6. **Update Connection String**
   - Railway provides `DATABASE_URL` in format: `postgresql://user:pass@host:port/db`
   - Update `Program.cs` to read from environment variable

7. **Deploy**
   - Railway automatically deploys on push to main branch
   - Get your backend URL from Railway dashboard

### Step 2: Deploy Frontend to Vercel

1. **Create Vercel Account**
   ```bash
   # Visit https://vercel.com
   # Sign in with GitHub
   ```

2. **Import Project**
   - Click "Add New" → "Project"
   - Select your GitHub repository
   - Vercel auto-detects Vite configuration

3. **Configure Build Settings**
   - Framework Preset: Vite
   - Root Directory: `./` (or leave empty)
   - Build Command: `npm run build`
   - Output Directory: `dist`

4. **Set Environment Variables**
   - Go to Project Settings → Environment Variables
   - Add:
     ```
     VITE_API_URL=https://your-backend.railway.app
     ```

5. **Deploy**
   - Click "Deploy"
   - Vercel will build and deploy automatically
   - Get your frontend URL

6. **Update CORS**
   - Go back to Railway backend settings
   - Update `CORS_ORIGINS` with your Vercel URL

### Step 3: Set Up Automated Deployments

Both platforms automatically deploy on git push!

```bash
# Any push to main branch triggers deployments
git push origin main

# Vercel: Deploys frontend automatically
# Railway: Deploys backend + runs migrations automatically
```

---

## Option 2: Render (All-in-One)

Deploy everything on Render for simplicity.

### Step 1: Create Render Account
```bash
# Visit https://render.com
# Sign in with GitHub
```

### Step 2: Deploy PostgreSQL
1. Click "New" → "PostgreSQL"
2. Name: `systemdesignsim-db`
3. Database Name: `systemdesignsim`
4. Region: Choose closest to users
5. Click "Create Database"
6. Copy the "Internal Database URL"

### Step 3: Deploy Backend
1. Click "New" → "Web Service"
2. Connect GitHub repository
3. Configure:
   - Name: `systemdesignsim-api`
   - Runtime: Docker or .NET
   - Build Command: `dotnet publish -c Release -o out`
   - Start Command: `dotnet out/SystemDesignSimulator.Api.dll`
   - Instance Type: Free

4. Environment Variables:
   ```
   ASPNETCORE_ENVIRONMENT=Production
   DATABASE_URL=[paste internal database URL]
   CORS_ORIGINS=https://your-app.onrender.com
   ```

5. Click "Create Web Service"

### Step 4: Deploy Frontend
1. Click "New" → "Static Site"
2. Connect GitHub repository
3. Configure:
   - Name: `systemdesignsim`
   - Build Command: `npm run build`
   - Publish Directory: `dist`

4. Environment Variables:
   ```
   VITE_API_URL=https://systemdesignsim-api.onrender.com
   ```

5. Click "Create Static Site"

---

## Option 3: Azure (Microsoft Stack)

Perfect for .NET applications with Azure credits.

### Step 1: Create Azure Account
```bash
# Visit https://azure.microsoft.com/free
# Get $200 free credit
```

### Step 2: Deploy via GitHub Actions

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Azure

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup .NET
        uses: actions/setup-dotnet@v3
        with:
          dotnet-version: '8.0.x'
      
      - name: Build
        run: |
          cd backend/SystemDesignSimulator.Api
          dotnet publish -c Release -o ./publish
      
      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v2
        with:
          app-name: systemdesignsim-api
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: backend/SystemDesignSimulator.Api/publish

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup Node
        uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Build
        run: |
          npm install
          npm run build
        env:
          VITE_API_URL: ${{ secrets.VITE_API_URL }}
      
      - name: Deploy to Azure Static Web Apps
        uses: Azure/static-web-apps-deploy@v1
        with:
          azure_static_web_apps_api_token: ${{ secrets.AZURE_STATIC_WEB_APPS_API_TOKEN }}
          repo_token: ${{ secrets.GITHUB_TOKEN }}
          action: "upload"
          app_location: "/"
          api_location: ""
          output_location: "dist"
```

---

## 🔧 Backend Configuration Updates

Update `Program.cs` to read Railway/Render connection string:

```csharp
// Read connection string from environment
var connectionString = Environment.GetEnvironmentVariable("DATABASE_URL");

if (!string.IsNullOrEmpty(connectionString))
{
    // Railway/Render format: postgresql://user:pass@host:port/db
    // Convert to Npgsql format
    var databaseUri = new Uri(connectionString);
    var userInfo = databaseUri.UserInfo.Split(':');
    
    connectionString = $"Host={databaseUri.Host};" +
                      $"Port={databaseUri.Port};" +
                      $"Database={databaseUri.LocalPath.Substring(1)};" +
                      $"Username={userInfo[0]};" +
                      $"Password={userInfo[1]};" +
                      $"SSL Mode=Require;" +
                      $"Trust Server Certificate=true";
}
else
{
    // Fallback to appsettings.json
    connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
}

builder.Services.AddDbContext<ApplicationDbContext>(options =>
    options.UseNpgsql(connectionString));
```

---

## 🔒 Security & Environment Variables

### Required Environment Variables

#### Frontend (Vercel/Netlify/Render)
```env
VITE_API_URL=https://your-backend-url.com
```

#### Backend (Railway/Render/Azure)
```env
ASPNETCORE_ENVIRONMENT=Production
DATABASE_URL=postgresql://user:pass@host:port/db
CORS_ORIGINS=https://your-frontend-url.com
JWT_SECRET=your-secret-key-here
```

### Setting Secrets in GitHub Actions

```bash
# Go to repository → Settings → Secrets and variables → Actions
# Add secrets:
gh secret set AZURE_WEBAPP_PUBLISH_PROFILE
gh secret set AZURE_STATIC_WEB_APPS_API_TOKEN
gh secret set VITE_API_URL
```

---

## 📊 Cost Analysis

### Free Tier Limits

| Platform | Bandwidth | Build Minutes | Compute | Database |
|----------|-----------|---------------|---------|----------|
| **Vercel** | 100GB/mo | Unlimited | Unlimited | N/A |
| **Railway** | $5 credit (~500hrs) | Unlimited | N/A | 1GB storage |
| **Render** | 100GB/mo | 750hrs/mo | 750hrs/mo | 1GB storage |
| **Azure** | $200 credit (1mo) | 1800min/mo | Various | 250GB |

**Estimated Monthly Usage (MVP)**:
- Frontend: ~10-20GB bandwidth
- Backend: ~100-200 compute hours
- Database: ~500MB storage

**Verdict**: Railway + Vercel stays free indefinitely for MVP scale! 🎉

---

## 🚦 Deployment Pipeline Flow

```
Developer pushes to GitHub
         │
         ├─── Frontend Branch
         │    │
         │    ├─→ Vercel detects push
         │    ├─→ Runs: npm install
         │    ├─→ Runs: npm run build
         │    ├─→ Deploys to CDN
         │    └─→ ✅ Live in ~2 minutes
         │
         └─── Backend Branch
              │
              ├─→ Railway detects push
              ├─→ Runs: dotnet restore
              ├─→ Runs: dotnet publish
              ├─→ Runs: dotnet ef database update
              ├─→ Starts service
              └─→ ✅ Live in ~3-5 minutes
```

---

## 🔍 Monitoring & Logs

### Railway
- Dashboard → Service → Logs (real-time)
- Metrics: CPU, Memory, Network
- Database: Query performance, connections

### Vercel
- Dashboard → Project → Deployments → Logs
- Analytics: Page views, performance
- Web Vitals monitoring

### Render
- Dashboard → Service → Logs
- Metrics available on paid plans

---

## 🐛 Troubleshooting

### Common Issues

**1. CORS Errors**
```csharp
// In Program.cs, ensure:
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowFrontend",
        policy =>
        {
            var origins = Environment.GetEnvironmentVariable("CORS_ORIGINS")
                ?? "http://localhost:5173";
            policy.WithOrigins(origins.Split(','))
                  .AllowAnyMethod()
                  .AllowAnyHeader();
        });
});

app.UseCors("AllowFrontend");
```

**2. Database Connection Fails**
- Check `DATABASE_URL` format
- Verify SSL mode is set correctly
- Check firewall rules (Railway/Render handle this)

**3. Migrations Don't Run**
```csharp
// Add to Program.cs before app.Run():
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<ApplicationDbContext>();
    db.Database.Migrate();
}
```

**4. Environment Variables Not Loading**
- Redeploy after adding new variables
- Check variable names match exactly
- For Vite, must start with `VITE_`

---

## 📚 Additional Resources

### Documentation
- [Railway Docs](https://docs.railway.app/)
- [Vercel Docs](https://vercel.com/docs)
- [Render Docs](https://render.com/docs)
- [Azure Docs](https://docs.microsoft.com/azure/)

### Tutorials
- [Deploy .NET to Railway](https://railway.app/template/dotnet)
- [Deploy Vite to Vercel](https://vercel.com/guides/vite)
- [PostgreSQL on Railway](https://docs.railway.app/databases/postgresql)

---

## 🎯 Quick Start Checklist

- [ ] Create Railway account
- [ ] Create Vercel account
- [ ] Connect GitHub to both platforms
- [ ] Deploy PostgreSQL on Railway
- [ ] Deploy backend to Railway
- [ ] Set backend environment variables
- [ ] Deploy frontend to Vercel
- [ ] Set frontend environment variables
- [ ] Update CORS settings
- [ ] Test deployment
- [ ] Set up custom domain (optional)

---

## 🚀 Next Steps

1. **Custom Domains**
   - Vercel: Free SSL certificates
   - Railway: Custom domains on Pro plan

2. **Monitoring**
   - Add Sentry for error tracking
   - Add Google Analytics
   - Set up uptime monitoring (UptimeRobot)

3. **Performance**
   - Enable Vercel Edge Functions
   - Configure Railway autoscaling
   - Add Redis caching

4. **Security**
   - Enable rate limiting
   - Add API authentication
   - Set up security headers

---

**Total Setup Time**: ~30 minutes  
**Monthly Cost**: $0 (free tier)  
**Maintenance**: Minimal (automatic updates)

Let's deploy! 🚀
