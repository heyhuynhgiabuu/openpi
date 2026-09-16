import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import solidPlugin from 'vite-plugin-solid'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

/**
 * PWA build — a standalone second entry served by the remote server's shell
 * routes. Fixed asset names (/app.js, /app.css) keep the remote allowlist
 * strict: three literal routes, never request-derived paths.
 */
export default defineConfig({
  root: path.resolve(rootDir, 'pwa'),
  plugins: [solidPlugin()],
  build: {
    outDir: path.resolve(rootDir, 'out/pwa'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'app.js',
        assetFileNames: 'app.css',
        chunkFileNames: 'app.js',
        inlineDynamicImports: true,
      },
    },
  },
})
