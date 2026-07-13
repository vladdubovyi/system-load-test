import { defineConfig } from 'vite';

const repoName = 'system-load-test';
const isGitHubPages = process.env.GITHUB_PAGES === 'true';

export default defineConfig({
  base: isGitHubPages ? `/${repoName}/` : './',
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
});
