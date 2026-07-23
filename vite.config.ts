import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      external: ['butterchurn', 'butterchurn-presets'],
    },
  },
  optimizeDeps: {
    exclude: ['butterchurn', 'butterchurn-presets'],
  },
})
