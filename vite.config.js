import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Mounts the same API router used by the Vercel function, so `npm run dev` and
// `npm run preview` serve frontend + /api together (needs DATABASE_URL in .env).
// Mirrors the headers in vercel.json so `npm run preview` behaves like production (CSP problems show up locally).
const PREVIEW_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; font-src 'self'; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  'X-Content-Type-Options': "nosniff",
  'X-Frame-Options': "DENY",
  'Referrer-Policy': "strict-origin-when-cross-origin",
  'Permissions-Policy': "geolocation=(self), microphone=(self), camera=()"
}

function localApi() {
  const mount = async server => {
    const { loadEnv } = await import('./server/env.js')
    loadEnv()
    const { handle } = await import('./server/router.js')
    server.middlewares.use('/api', (req, res) => { handle(req, res) })
  }
  return {
    name: 'local-api',
    configureServer: mount,
    configurePreviewServer: async server => {
      server.middlewares.use((req, res, next) => { for (const [k, v] of Object.entries(PREVIEW_HEADERS)) res.setHeader(k, v); next() })
      await mount(server)
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    localApi(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: { navigateFallbackDenylist: [/^\/api\//] },
      manifest: {
        name: 'Madurai Bus',
        short_name: 'MadBus',
        description: 'Madurai district bus information and journey planner',
        theme_color: '#1D9E75',
        background_color: '#060f1a',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ]
})
