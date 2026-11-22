import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
/** Unique id for this build — written to dist/version.json and inlined in the bundle. */
const buildId = `${Date.now().toString(36)}`;

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [
    react(),
    {
      // A tiny, never-cached file the app polls to know whether a newer build
      // was published. It does not depend on the service worker state, so the
      // "new version" prompt also works when the SW is stuck on an old cache.
      name: 'build-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'version.json',
          source: JSON.stringify({ buildId, builtAt: new Date().toISOString() }),
        });
      },
    },
    VitePWA({
      // `autoUpdate` + skipWaiting/clientsClaim: a new worker never stays stuck
      // waiting (which would leave an old client unable to ever update). The
      // "nueva versión" prompt is driven by version.json, not by the SW state.
      registerType: 'autoUpdate',
      workbox: {
        // Apply a new worker immediately; the UI decides when to reload.
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // SPA offline fallback: serve the precached app shell (index.html) for
        // any failed navigation so the app opens offline with the banner + cached data.
        navigateFallback: 'index.html',
        navigateFallbackAllowlist: [/^\/.*$/],
        navigateFallbackDenylist: [/^\/api\//, /\.(?:png|jpg|jpeg|svg|gif|webp|ico|woff2?|json)$/],
        runtimeCaching: [
          {
            // Route API — NetworkFirst (serve cache offline).
            //
            // The cache key is scoped PER TENANT. A service worker cannot read
            // the page's localStorage (`auth-storage`), so the tenant id is
            // derived from the bearer JWT that `src/api/client.ts` attaches to
            // every routes request (the token payload carries `tenantId`). The
            // resulting namespace mirrors `src/lib/offline-namespace.ts`
            // (`tenant_<id>` for a real tenant, `legacy` otherwise), so tenant B
            // can never be served tenant A's cached routes offline.
            urlPattern: /\/api\/v1\/routes/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'routes-api',
              expiration: { maxEntries: 5, maxAgeSeconds: 86400 },
              networkTimeoutSeconds: 5,
              // Workbox serialises plugin functions into the generated service
              // worker, so this callback must stay self-contained (no imports
              // or outer references) — it runs in the SW global scope.
              plugins: [
                {
                  cacheKeyWillBeUsed: async ({ request }) => {
                    let namespace = 'legacy';
                    const authorization = request.headers.get('Authorization') || '';
                    if (authorization.indexOf('Bearer ') === 0) {
                      const segment = authorization.slice(7).split('.')[1];
                      if (segment) {
                        const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
                        const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
                        const payload = JSON.parse(atob(padded));
                        if (payload && typeof payload.tenantId === 'string' && payload.tenantId) {
                          namespace = 'tenant_' + payload.tenantId;
                        }
                      }
                    }
                    const url = new URL(request.url);
                    url.searchParams.set('__tenant', namespace);
                    return url.toString();
                  }
                }
              ]
            }
          },
          {
            // Other APIs — NetworkOnly (no offline fallback)
            urlPattern: /\/api\/(?!v1\/routes)/,
            handler: 'NetworkOnly',
          },
          {
            // Static assets — CacheFirst
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|woff2?)$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'static-assets',
              expiration: { maxEntries: 60, maxAgeSeconds: 30 * 24 * 60 * 60 },
            }
          }
        ]
      },
      manifest: false // we provide our own manifest.json
    })
  ],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})
