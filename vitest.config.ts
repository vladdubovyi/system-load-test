import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // Playwright specs live in e2e/ and are run with `npm run test:e2e`.
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  })
);
