import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './packages/bridge-worker/wrangler.test.jsonc' },
    }),
  ],
  test: {
    include: ['packages/*/src/**/*.worker.test.ts'],
  },
});
