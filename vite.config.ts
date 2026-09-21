import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        /**
         * Splits the dependencies into chunks that change at different rates.
         *
         * One chunk meant the browser parsed every library before the first
         * paint and re-downloaded all of them whenever a single line of app
         * code changed. Split, they are fetched in parallel, parsed as
         * separate units, and a deploy that touches only `src/` leaves every
         * vendor chunk in the HTTP cache.
         *
         * The groupings follow what a screen needs together, not what npm
         * happens to name: `engine.io-client` is socket.io's transport and
         * `@firebase/*` is what `firebase` re-exports, so neither may fall
         * through to the generic bucket and be split away from its own entry
         * point.
         */
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined
          if (/[\\/]node_modules[\\/](firebase|@firebase)[\\/]/.test(id)) return 'firebase'
          if (/[\\/]node_modules[\\/](chart\.js|react-chartjs-2)[\\/]/.test(id)) return 'charts'
          if (/[\\/]node_modules[\\/](socket\.io-client|engine\.io-client|engine\.io-parser|socket\.io-parser)[\\/]/.test(id))
            return 'socket'
          if (/[\\/]node_modules[\\/](react-hook-form|@hookform|zod)[\\/]/.test(id)) return 'forms'
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id))
            return 'react'
          return 'vendor'
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
  test: { environment: 'jsdom', setupFiles: ['./src/__tests__/setup.ts'], globals: true },
})
