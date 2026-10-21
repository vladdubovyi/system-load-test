# GitHub Pages setup (BreakIT frontend)

Hosting is free on GitHub Pages. Production and PR previews both publish to the `gh-pages` branch.

## One-time enable

1. Open **Settings → Pages**:  
   https://github.com/vladdubovyi/system-load-test/settings/pages

2. Under **Build and deployment → Source**, choose **Deploy from a branch**.

3. Set **Branch** to `gh-pages` and folder to **`/ (root)`**, then save.

4. Re-run workflows (or push to `main` / update a PR):
   - [Deploy to GitHub Pages](https://github.com/vladdubovyi/system-load-test/actions/workflows/deploy.yml) — production at `/`
   - [PR Preview](https://github.com/vladdubovyi/system-load-test/actions/workflows/pr-preview.yml) — previews at `/previews/pr/<number>/`

5. Live URLs:
   - **Production:** https://vladdubovyi.github.io/system-load-test/
   - **PR preview:** https://vladdubovyi.github.io/system-load-test/previews/pr/<number>/

## Why PR previews 404 with "GitHub Actions" source

If Pages source is **GitHub Actions**, only the production deployment artifact is served. PR previews are written to the `gh-pages` branch under `previews/pr/<number>/`, which is ignored until you switch the source to the `gh-pages` branch.

## Local development

```bash
cp .env.example .env.development
npm install
npm run dev
```
