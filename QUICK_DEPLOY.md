# 🚀 Quick Deploy Guide

Get your System Design Simulator live in 15 minutes!

## Option 1: Railway only (Recommended) ⚡

Uses [Railway Config as Code](https://docs.railway.com/config-as-code). See [RAILWAY_SETUP_GUIDE.md](./RAILWAY_SETUP_GUIDE.md) for details.

### Step 1: Project + database (2 min)

1. Sign up at [railway.app](https://railway.app) with GitHub
2. New Project → Deploy from GitHub repo → `system-load-test`
3. New → Database → PostgreSQL

### Step 2: Backend service (5 min)

1. New → GitHub Repo → same repository (second service)
2. Service **Settings** → Config-as-code file:

   ```
   /backend/railway.toml
   ```

3. Variables:

   ```env
   ASPNETCORE_ENVIRONMENT=Production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   CORS_ORIGINS=https://<frontend-url>   # update after step 3
   ```

4. Deploy → copy the backend public URL
5. Test: `https://<backend-url>/api/health`

### Step 3: Frontend service (5 min)

1. New → GitHub Repo → same repository (third service)
2. Service **Settings** → Config-as-code file:

   ```
   /railway.toml
   ```

3. Variables:

   ```env
   VITE_API_URL=https://<backend-url>
   ```

4. Deploy → copy the frontend public URL

### Step 4: Finish CORS + test (2 min)

1. Backend → Variables → set `CORS_ORIGINS` to the frontend URL
2. Visit the frontend URL → Choose Challenge → verify API loads

✅ **Done! Frontend, backend, and DB all on Railway.**

---

## Option 2: Railway backend + Vercel frontend

### Step 1: Deploy Backend to Railway (5 min)

1. Sign up at [railway.app](https://railway.app) with GitHub
2. New Project → Deploy from GitHub repo
3. New → Database → PostgreSQL
4. New → GitHub Repo → same repository (backend service)
5. Service Settings → Config-as-code file: `/backend/railway.toml`
6. Variables:

   ```env
   ASPNETCORE_ENVIRONMENT=Production
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   CORS_ORIGINS=https://your-app.vercel.app
   ```

7. Deploy and copy the backend URL

### Step 2: Deploy Frontend to Vercel (5 min)

1. Sign up at [vercel.com](https://vercel.com) with GitHub
2. Add New → Project → import this repository (Vite auto-detected)
3. Set environment variable:

   ```env
   VITE_API_URL=https://your-backend.railway.app
   ```

4. Deploy and copy the Vercel URL

### Step 3: Update CORS (2 min)

1. Railway backend → Variables → update `CORS_ORIGINS` to your Vercel URL
2. Redeploy backend

### Step 4: Test (2 min)

1. Visit your Vercel URL
2. Click "Choose Challenge"
3. Select a challenge and start building

✅ **Done!**

---

## Option 3: All-in-One Render Deploy (10 min)

### One-Click Deploy

1. **Click this button:**
   
   [![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/vladdubovyi/system-load-test)

2. **Fill in the form:**
   ```
   - Name your services
   - Select region
   - Click "Apply"
   ```

3. **Wait for deployment:**
   ```
   - Render deploys all services automatically
   - Database → Backend → Frontend
   - Takes about 5-10 minutes
   ```

4. **Get your URL:**
   ```
   - Check the frontend service
   - Copy the URL
   - Visit and test!
   ```

✅ **Done! Everything deployed!**

---

## Option 3: Manual GitHub Actions Setup

### Prerequisites
- GitHub account
- Railway account
- Vercel account

### Step 1: Set up Railway
1. Create Railway project
2. Add PostgreSQL database
3. Get Railway token from [Account Settings](https://railway.app/account/tokens)

### Step 2: Set up Vercel
1. Create Vercel project
2. Get Vercel token from [Account Settings](https://vercel.com/account/tokens)
3. Get Project ID from Vercel project settings
4. Get Org ID from Vercel team settings

### Step 3: Add GitHub Secrets
```bash
# Go to: Repository → Settings → Secrets → Actions

Add these secrets:
- RAILWAY_TOKEN
- VERCEL_TOKEN
- VERCEL_ORG_ID
- VERCEL_PROJECT_ID
- VITE_API_URL (your Railway backend URL)
```

### Step 4: Push to GitHub
```bash
git push origin main

# GitHub Actions will automatically:
# 1. Build and test
# 2. Deploy backend to Railway
# 3. Deploy frontend to Vercel
```

✅ **Done! Auto-deploy is active!**

---

## Verification Checklist

After deployment, verify:

- [ ] Frontend loads at your Vercel URL
- [ ] Backend health check: `https://your-backend.railway.app/health`
- [ ] Challenge selector shows 4 challenges
- [ ] Can place components on canvas
- [ ] Can create connections
- [ ] Simulation runs successfully
- [ ] No CORS errors in browser console

---

## URLs to Save

Write down these URLs:

```
Frontend: https://__________________.vercel.app
Backend:  https://__________________.railway.app
Database: [Railway dashboard only]
```

---

## Costs

### Free Tier Limits
- **Vercel**: 100GB bandwidth/month (enough for 10K+ users)
- **Railway**: $5 credit/month (~500 hours compute)
- **Database**: 1GB storage (enough for 1000s of challenges)

**Estimated monthly cost**: $0 for MVP scale! 🎉

---

## Auto-Deploy is Active!

Every `git push` to `main` branch will automatically:
1. ✅ Run tests
2. ✅ Build frontend and backend
3. ✅ Deploy to production
4. ✅ Run database migrations
5. ✅ Clear caches

**No manual deployment needed!** 🚀

---

## Custom Domain (Optional)

### Add custom domain to Vercel:
1. Go to Vercel project → Settings → Domains
2. Add your domain (e.g., systemdesignsim.com)
3. Update DNS records as instructed
4. Vercel auto-provisions SSL certificate

### Add custom domain to Railway:
1. Upgrade to Pro plan ($5/month)
2. Go to service → Settings → Domains
3. Add your domain
4. Update DNS records

---

## Monitoring

### Check deployment status:
- **GitHub Actions**: Repository → Actions tab
- **Railway**: [Dashboard](https://railway.app/dashboard)
- **Vercel**: [Dashboard](https://vercel.com/dashboard)

### View logs:
- **Railway**: Service → Logs tab
- **Vercel**: Project → Deployments → View logs

---

## Rollback

If something breaks:

### Vercel:
1. Go to project → Deployments
2. Find last working deployment
3. Click "..." → "Promote to Production"

### Railway:
1. Go to service → Deployments
2. Find last working deployment
3. Click "Rollback"

---

## Getting Help

### Check logs:
```bash
# Railway logs
railway logs --service backend

# Vercel logs
vercel logs [deployment-url]
```

### Common issues:
- **CORS errors**: Update CORS_ORIGINS in Railway
- **Database connection fails**: Check DATABASE_URL is set
- **Frontend can't reach backend**: Check VITE_API_URL
- **Build fails**: Check GitHub Actions logs

### Support:
- Railway: [Discord](https://discord.gg/railway)
- Vercel: [Discord](https://discord.gg/vercel)
- GitHub Actions: [Community](https://github.community)

---

## Next Steps

After deployment:

1. **Test thoroughly**
   - Try all 4 challenges
   - Test all features
   - Check on mobile

2. **Share with users**
   - Get feedback
   - Monitor usage
   - Track errors

3. **Set up monitoring**
   - Add Sentry for error tracking
   - Add Google Analytics
   - Set up uptime monitoring

4. **Optimize**
   - Enable Vercel Edge Functions
   - Add Redis caching
   - Optimize images

---

**Congratulations! Your System Design Simulator is live! 🎉**

Share your URL: ________________________
