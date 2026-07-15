# GitHub Secrets Setup Guide

This guide shows you how to set up the required secrets for automated deployments.

## Required Secrets

### For Railway Deployment

1. **RAILWAY_TOKEN**
   - Go to [Railway Dashboard](https://railway.app/account/tokens)
   - Click "Create New Token"
   - Name it: "GitHub Actions Deploy"
   - Copy the token
   - Add to GitHub: Repository → Settings → Secrets → Actions → New secret
   - Name: `RAILWAY_TOKEN`
   - Value: [paste your token]

### For Vercel Deployment

1. **VERCEL_TOKEN**
   - Go to [Vercel Account Settings](https://vercel.com/account/tokens)
   - Click "Create Token"
   - Name it: "GitHub Actions"
   - Copy the token
   - Add to GitHub as `VERCEL_TOKEN`

2. **VERCEL_ORG_ID**
   - Go to [Vercel Team Settings](https://vercel.com/teams)
   - Copy your Team/User ID
   - Add to GitHub as `VERCEL_ORG_ID`

3. **VERCEL_PROJECT_ID**
   - Go to your Vercel project → Settings → General
   - Copy the Project ID
   - Add to GitHub as `VERCEL_PROJECT_ID`

4. **VITE_API_URL**
   - Your Railway backend URL
   - Format: `https://your-app.railway.app`
   - Add to GitHub as `VITE_API_URL`

### For Azure Deployment (Optional)

1. **AZURE_WEBAPP_PUBLISH_PROFILE**
   - In Azure Portal, go to your App Service
   - Click "Get publish profile"
   - Copy the entire XML content
   - Add to GitHub as `AZURE_WEBAPP_PUBLISH_PROFILE`

2. **AZURE_STATIC_WEB_APPS_API_TOKEN**
   - In Azure Portal, go to your Static Web App
   - Settings → Configuration → Deployment tokens
   - Copy the token
   - Add to GitHub as `AZURE_STATIC_WEB_APPS_API_TOKEN`

## Quick Setup Commands

### Using GitHub CLI
```bash
# Install GitHub CLI if not already installed
# macOS: brew install gh
# Windows: winget install GitHub.cli

# Login
gh auth login

# Set Railway token
gh secret set RAILWAY_TOKEN

# Set Vercel secrets
gh secret set VERCEL_TOKEN
gh secret set VERCEL_ORG_ID
gh secret set VERCEL_PROJECT_ID
gh secret set VITE_API_URL

# Verify secrets are set
gh secret list
```

### Manual Setup
1. Go to your repository on GitHub
2. Click "Settings" → "Secrets and variables" → "Actions"
3. Click "New repository secret"
4. Enter name and value
5. Click "Add secret"

## Environment-Specific Variables

### Development (.env.development)
```env
VITE_API_URL=http://localhost:5063
```

### Production (Set in Vercel)
```env
VITE_API_URL=https://your-backend.railway.app
```

### Backend (Set in Railway)
```env
ASPNETCORE_ENVIRONMENT=Production
DATABASE_URL=${{Postgres.DATABASE_URL}}
CORS_ORIGINS=https://your-frontend.vercel.app
```

## Verification

After setting up secrets, verify by:

1. **Triggering a workflow**
   ```bash
   git commit --allow-empty -m "Test deployment"
   git push origin main
   ```

2. **Check workflow status**
   - Go to repository → Actions
   - Click on the running workflow
   - Check for errors

3. **Verify deployment**
   - Frontend: Visit your Vercel URL
   - Backend: Visit `https://your-backend.railway.app/health`
   - Database: Check Railway dashboard

## Troubleshooting

### "Secret not found" error
- Make sure secret name matches exactly (case-sensitive)
- Check secret is set at repository level, not organization level

### "Unauthorized" error
- Token may be expired
- Regenerate token and update secret

### Workflow not triggering
- Check the workflow file paths in `on.push.paths`
- Ensure you're pushing to the correct branch

## Security Best Practices

1. **Never commit secrets to git**
   - Always use environment variables
   - Add `.env` to `.gitignore`

2. **Rotate tokens regularly**
   - Update tokens every 3-6 months
   - Delete unused tokens

3. **Use least privilege**
   - Give tokens only the permissions they need
   - Use separate tokens for different services

4. **Monitor usage**
   - Check deployment logs regularly
   - Set up alerts for failed deployments

## Need Help?

- [GitHub Actions Secrets Docs](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Railway Docs](https://docs.railway.app/deploy/deployments)
- [Vercel Docs](https://vercel.com/docs/concepts/git)
