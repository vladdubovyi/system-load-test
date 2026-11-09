import { defineConfig } from 'vite';

const repoName = 'system-load-test';
const isGitHubPages = process.env.GITHUB_PAGES === 'true';
const previewBase = process.env.VITE_BASE;

export default defineConfig({
  // Use absolute "/" for Railway and most hosts so /sandbox/* routes still load /assets/*
  // GitHub Pages sets GITHUB_PAGES=true; PR previews can set VITE_BASE explicitly.
  base: previewBase ?? (isGitHubPages ? `/${repoName}/` : '/'),
  // Pre-bundle the SignalR client at startup. Discovering it lazily makes the
  // dev server re-optimise and reload the page on first use, which breaks the
  // first e2e tests that open a room on a cold cache.
  optimizeDeps: {
    include: ['@microsoft/signalr'],
  },
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
