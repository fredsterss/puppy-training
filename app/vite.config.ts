import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['puppy-icon.svg'],
      manifest: {
        name: 'Puppy Companion',
        short_name: 'Puppy',
        description: 'Offline puppy training, progress, and care tracking.',
        theme_color: '#244238',
        background_color: '#f7f3ea',
        display: 'standalone',
        start_url: './',
        icons: [
          {
            src: 'puppy-icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 20 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,svg,json}']
      }
    })
  ]
})
