import { defineConfig } from 'vite';

const repoName = 'system-load-test';
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const previewBase = process.env.VITE_BASE;

export default defineConfig({
  base: previewBase ?? (isGitHubPages ? `/${repoName}/` : './'),
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
});
