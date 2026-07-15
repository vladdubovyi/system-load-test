import { defineConfig } from 'vite';

const repoName = 'system-load-test';
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const previewBase = process.env.VITE_BASE;

export default defineConfig({
  // Use absolute "/" for Railway and most hosts so /sandbox/* routes still load /assets/*
  // GitHub Pages sets GITHUB_PAGES=true; PR previews can set VITE_BASE explicitly.
  base: previewBase ?? (isGitHubPages ? `/${repoName}/` : '/'),
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: Number(process.env.PORT) || 4173,
    strictPort: true,
    allowedHosts: true,
  },
});
