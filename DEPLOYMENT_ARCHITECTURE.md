# Deployment Architecture

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         USERS / BROWSERS                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                    HTTPS (SSL/TLS)
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────┐                    ┌──────────────────┐
│  Vercel CDN      │                    │  Railway Edge    │
│  (Frontend)      │                    │  (Backend API)   │
├──────────────────┤                    ├──────────────────┤
│ - Vite Build     │                    │ - .NET 8 API     │
│ - Static Files   │────REST/JSON──────▶│ - EF Core        │
│ - Edge Functions │                    │ - Auto-scaling   │
│ - 100+ Regions   │                    │ - Health checks  │
└──────────────────┘                    └────────┬─────────┘
                                                 │
                                          PostgreSQL
                                                 │
                                                 ▼
                                        ┌─────────────────┐
                                        │  Railway DB     │
                                        ├─────────────────┤
                                        │ - PostgreSQL 14 │
                                        │ - Auto-backup   │
                                        │ - 1GB storage   │
                                        │ - Connection    │
                                        │   pooling       │
                                        └─────────────────┘
```

---

## 🔄 CI/CD Pipeline Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     DEVELOPER WORKFLOW                            │
└───────────────────────────┬──────────────────────────────────────┘
                            │
                     git push origin main
                            │
                            ▼
                  ┌──────────────────┐
                  │  GitHub          │
                  │  Repository      │
                  └────────┬─────────┘
                           │
           ┌───────────────┼───────────────┐
           │               │               │
           ▼               ▼               ▼
   ┌───────────┐   ┌────────────┐  ┌────────────┐
   │ CI Tests  │   │  Deploy    │  │  Deploy    │
   │ Workflow  │   │  Backend   │  │  Frontend  │
   └─────┬─────┘   └──────┬─────┘  └──────┬─────┘
         │                │                │
         ▼                ▼                ▼
   ┌───────────┐   ┌────────────┐  ┌────────────┐
   │ ✅ Build  │   │  Railway   │  │  Vercel    │
   │ ✅ Test   │   │  Build     │  │  Build     │
   │ ✅ Lint   │   │  Deploy    │  │  Deploy    │
   └───────────┘   │  Migrate   │  │  CDN       │
                   └──────┬─────┘  └──────┬─────┘
                          │                │
                          ▼                ▼
                   ┌────────────┐  ┌────────────┐
                   │ Backend    │  │ Frontend   │
                   │ Live! ✅   │  │ Live! ✅   │
                   └────────────┘  └────────────┘
```

---

## 📊 Deployment Options Comparison

### Option 1: Railway + Vercel (Recommended)

```
Frontend (Vercel)          Backend + DB (Railway)
┌─────────────────┐       ┌─────────────────┐
│ Vite Build      │◀─────▶│ .NET 8 API      │
│ Global CDN      │ API   │ PostgreSQL DB   │
│ Auto-deploy     │       │ Auto-deploy     │
│ SSL included    │       │ Migrations      │
│ $0/month        │       │ $0/month*       │
└─────────────────┘       └─────────────────┘

Benefits:
✅ Best performance (CDN + edge)
✅ Separate scaling
✅ Easy debugging
✅ Industry standard

Setup: 15 minutes
```

### Option 2: Render (All-in-One)

```
Everything on Render
┌───────────────────────────┐
│ Frontend (Static)         │
│ Backend API (Docker)      │
│ PostgreSQL Database       │
│ All auto-deploy          │
│ All in one platform      │
│ $0/month                 │
└───────────────────────────┘

Benefits:
✅ Single platform
✅ Simpler billing
✅ One-click deploy
✅ Blueprint YAML

Setup: 10 minutes
```

### Option 3: Azure (Enterprise)

```
Frontend (Static)          Backend (App Service)
┌─────────────────┐       ┌─────────────────┐
│ Static Web App  │◀─────▶│ .NET App Service│
│ Global CDN      │ API   │ Azure SQL/Postgres
│ GitHub Actions  │       │ GitHub Actions  │
│ SSL included    │       │ Auto-scale     │
│ $200 credit     │       │ Monitoring     │
└─────────────────┘       └─────────────────┘

Benefits:
✅ Enterprise features
✅ Microsoft ecosystem
✅ Advanced monitoring
✅ Best .NET support

Setup: 20 minutes
```

---

## 🔐 Security Architecture

```
┌────────────────────────────────────────┐
│          Security Layers                │
├────────────────────────────────────────┤
│ Layer 1: Transport (SSL/TLS)          │
│   - Vercel: Auto SSL                   │
│   - Railway: Auto SSL                  │
│   - HTTPS enforced                     │
├────────────────────────────────────────┤
│ Layer 2: CORS                          │
│   - Origin whitelist                   │
│   - Environment-based                  │
│   - No wildcards in prod               │
├────────────────────────────────────────┤
│ Layer 3: Environment Variables         │
│   - Secrets in platform                │
│   - Not in codebase                    │
│   - Encrypted at rest                  │
├────────────────────────────────────────┤
│ Layer 4: Database                      │
│   - SSL connections                    │
│   - Connection pooling                 │
│   - Private networking                 │
├────────────────────────────────────────┤
│ Layer 5: Application                   │
│   - Input validation                   │
│   - SQL injection protection (EF Core) │
│   - Rate limiting (future)             │
└────────────────────────────────────────┘
```

---

## 📈 Scaling Strategy

### Free Tier Capacity

```
Concurrent Users:  ~100
Daily Active:      ~1,000
Monthly Active:    ~5,000
Bandwidth:         100GB/month
Database Size:     1GB
API Requests:      ~1M/month
```

### Auto-Scaling Triggers

```
┌──────────────────────────────────────┐
│ Railway Auto-Scaling                 │
├──────────────────────────────────────┤
│ CPU > 80% for 5 min   → Scale up     │
│ Memory > 90%          → Scale up     │
│ Response time > 1s    → Alert        │
│ Error rate > 5%       → Alert        │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ Vercel Auto-Scaling                  │
├──────────────────────────────────────┤
│ Edge locations:       100+ regions   │
│ Auto CDN:            Worldwide       │
│ Bandwidth:           Unlimited*      │
│ Concurrent:          10,000+         │
└──────────────────────────────────────┘
```

### Growth Path

```
Stage 1: MVP (Current)
├─ Railway Free Tier
├─ Vercel Free Tier
└─ Cost: $0/month
   Capacity: ~1K users

Stage 2: Growth
├─ Railway Pro ($5/month)
├─ Vercel Pro ($20/month)
└─ Cost: $25/month
   Capacity: ~10K users

Stage 3: Scale
├─ Railway Team ($20/month)
├─ Vercel Pro ($20/month)
├─ Redis Cache (add-on)
└─ Cost: $40/month
   Capacity: ~50K users

Stage 4: Enterprise
├─ Azure App Service
├─ Azure SQL
├─ Azure CDN
└─ Cost: $200-500/month
   Capacity: 100K+ users
```

---

## 🌍 Global Distribution

```
Vercel Edge Network
┌─────────────────────────────────────────────┐
│  North America: 40+ locations               │
│  Europe: 30+ locations                      │
│  Asia: 25+ locations                        │
│  South America: 5+ locations                │
│  Australia: 5+ locations                    │
│  Africa: 3+ locations                       │
└─────────────────────────────────────────────┘

Railway Regions (Choose one)
┌─────────────────────────────────────────────┐
│  us-west1 (Oregon)      - Recommended       │
│  us-east1 (Virginia)    - Low latency US    │
│  eu-west1 (Ireland)     - EU users          │
│  ap-southeast1 (Singapore) - Asia users     │
└─────────────────────────────────────────────┘
```

---

## 🔍 Monitoring Setup

```
┌─────────────────────────────────────────────┐
│          Monitoring Dashboard                │
├─────────────────────────────────────────────┤
│                                             │
│  Frontend (Vercel Analytics)                │
│  ├─ Page views                              │
│  ├─ Performance (Web Vitals)                │
│  ├─ Error rate                              │
│  └─ Geographic distribution                 │
│                                             │
│  Backend (Railway Metrics)                  │
│  ├─ CPU usage                               │
│  ├─ Memory usage                            │
│  ├─ Response time                           │
│  └─ Error logs                              │
│                                             │
│  Database (Railway DB)                      │
│  ├─ Connection count                        │
│  ├─ Query performance                       │
│  ├─ Storage usage                           │
│  └─ Backup status                           │
│                                             │
│  CI/CD (GitHub Actions)                     │
│  ├─ Build status                            │
│  ├─ Test results                            │
│  ├─ Deploy time                             │
│  └─ Failure alerts                          │
│                                             │
└─────────────────────────────────────────────┘
```

---

## 🚨 Disaster Recovery

```
Backup Strategy
┌─────────────────────────────────────────────┐
│ Database Backups (Railway)                  │
│ ├─ Automatic daily backups                  │
│ ├─ 7-day retention                          │
│ ├─ Point-in-time recovery                   │
│ └─ One-click restore                        │
│                                             │
│ Code (GitHub)                               │
│ ├─ Full history                             │
│ ├─ Branch protection                        │
│ ├─ Tag releases                             │
│ └─ Instant rollback                         │
│                                             │
│ Deployments                                 │
│ ├─ Vercel: Instant rollback                │
│ ├─ Railway: Deployment history             │
│ └─ Docker: Immutable images                │
└─────────────────────────────────────────────┘

Rollback Procedure
1. Identify issue (monitoring alerts)
2. Check deployment history
3. Click "Rollback" (< 2 minutes)
4. Verify health checks
5. Investigate root cause
```

---

## 📱 Request Flow Example

```
User visits systemdesignsim.vercel.app
         ↓
Vercel Edge (nearest location)
         ↓
Cached? → YES → Serve instantly (< 50ms)
    ↓
    NO
    ↓
Serve static files from origin
         ↓
User clicks "Choose Challenge"
         ↓
API request to railway.app/api/challenges
         ↓
Railway backend processes request
         ↓
Query PostgreSQL database
         ↓
Return JSON response
         ↓
Frontend renders challenge list
         ↓
User selects challenge and starts building!
```

---

## 💡 Pro Tips

### Performance
- ✅ Vercel Edge caches static assets globally
- ✅ Railway auto-scales based on traffic
- ✅ Database connection pooling enabled
- ✅ Gzip compression automatic

### Cost Optimization
- ✅ Free tiers sufficient for MVP
- ✅ Pay only for what you use
- ✅ No upfront costs
- ✅ Can downgrade anytime

### Development Workflow
- ✅ Preview deployments for PRs
- ✅ Production deploys on merge
- ✅ Environment variables per branch
- ✅ Instant rollback if needed

### Monitoring
- ✅ Real-time logs
- ✅ Error tracking built-in
- ✅ Performance metrics
- ✅ Uptime monitoring

---

## 🎯 Quick Reference

### Essential URLs
```
Frontend:  https://[your-project].vercel.app
Backend:   https://[your-project].railway.app
Health:    https://[your-project].railway.app/health
Swagger:   https://[your-project].railway.app/swagger
DB Admin:  Railway Dashboard → Database → Connect
```

### Environment Variables
```
Frontend (Vercel):
VITE_API_URL=https://[your-project].railway.app

Backend (Railway):
ASPNETCORE_ENVIRONMENT=Production
DATABASE_URL=${{Postgres.DATABASE_URL}}
CORS_ORIGINS=https://[your-project].vercel.app
```

### Deploy Commands
```bash
# Manual deploy (if needed)
vercel deploy --prod           # Frontend
railway up --service backend   # Backend

# Check status
vercel ls
railway status

# View logs
vercel logs
railway logs --service backend
```

---

**Total Setup Time**: 15 minutes  
**Monthly Cost**: $0 (free tier)  
**Capacity**: 1,000+ users  
**Reliability**: 99.9% uptime SLA

🚀 **Ready to deploy!**
