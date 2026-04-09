import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vite build for the Tauri desktop shell.
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'TAURI_'],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        'tray-popup': path.resolve(__dirname, 'tray-popup.html')
      }
    }
  }
})
