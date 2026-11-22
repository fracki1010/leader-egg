import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts: Plus Jakarta Sans (brand family — weights 400/600/700/800)
import '@fontsource/plus-jakarta-sans/400.css'
import '@fontsource/plus-jakarta-sans/600.css'
import '@fontsource/plus-jakarta-sans/700.css'
import '@fontsource/plus-jakarta-sans/800.css'
// Leaflet map tiles/markers base styles (MapView)
import 'leaflet/dist/leaflet.css'
import './index.css'
import App from './App'
import { startOfflineSync } from './lib/offline-sync.ts'
import { queryClient } from './lib/query-client.ts'
import { installChunkReloadHandler } from './lib/chunk-reload.ts'
import { QueryClientProvider } from '@tanstack/react-query'

// Recover from stale lazy-route chunks after a new deploy (a tab holding an old
// index.html would otherwise fail to fetch the previous hashed chunk).
installChunkReloadHandler()

// Flush queued offline writes as soon as the browser comes back online, then
// refresh every cached query so freshly synced state is read back.
startOfflineSync({
  onReplayed: () => {
    void queryClient.invalidateQueries()
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
