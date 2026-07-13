# One-time setup: enable GitHub Pages

GitHub Pages is **free and runs 24/7**, but it must be turned on once per repository.

## Steps

1. Open **Settings → Pages**:  
   https://github.com/vladdubovyi/system-load-test/settings/pages

2. Under **Build and deployment → Source**, choose **GitHub Actions**.

3. Re-run the deploy workflow (or push any commit to `main`):  
   https://github.com/vladdubovyi/system-load-test/actions/workflows/deploy.yml

4. After the workflow succeeds, the game will be live at:  
   **https://vladdubovyi.github.io/system-load-test/**

## Why the old link stopped working

The previous link used a **Cloudflare quick tunnel** from the cloud agent VM. That tunnel only lives while the agent session is running — it is not permanent hosting.

## Local development

```bash
npm install
npm run dev
```
