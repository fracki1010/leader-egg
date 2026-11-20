import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    forbidOnly: true,
    include: ['src/**/*.test.ts'],
    setupFiles: ['src/__tests__/env-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/seed.ts', 'src/__tests__/env-setup.ts']
    },
    testTimeout: 30_000
  }
});
