import { defineConfig } from 'vitest/config';

export default defineConfig({
  // `app-version.ts` reads this Vite-inlined build id at module load. Tests do
  // not run the production `define`, so provide a stable stub.
  define: {
    __BUILD_ID__: JSON.stringify('test-build'),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    // Heavy pages (e.g. NewOrderPage) can exceed the 5s default when the whole
    // suite runs in parallel; this only widens the ceiling, it does not change
    // what any test asserts.
    testTimeout: 15000,
  },
});
