import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['daphne-icon-192.png', 'daphne-icon-512.png', 'apple-touch-icon.png'],
      manifest: {
        name: 'Puppy Companion',
        short_name: 'Puppy',
        description: 'Offline puppy training, progress, and care tracking.',
        theme_color: '#244238',
        background_color: '#f7f3ea',
        display: 'standalone',
        start_url: undefined,
        icons: [
          {
            src: 'daphne-icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any'
          },
          {
            src: 'daphne-icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,png,json}']
      }
    })
  ]
})
