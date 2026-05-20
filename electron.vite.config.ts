import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'electron-vite'
import solidPlugin from 'vite-plugin-solid'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: path.resolve(rootDir, 'electron/main.ts'),
          piSidecar: path.resolve(rootDir, 'electron/pi/sidecar.ts'),
        },
        external: [
          '@lydell/node-pty',
          'better-sqlite3',
          '@earendil-works/pi-coding-agent',
          '@ff-labs/fff-node',
          'ffi-rs',
        ],
      },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: {
          index: path.resolve(rootDir, 'electron/preload.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [solidPlugin()],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, 'src'),
        '@icons': path.resolve(rootDir, 'icons'),
        'virtua/solid': path.resolve(rootDir, 'node_modules/virtua/lib/solid/index.js'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: path.resolve(rootDir, 'index.html'),
        },
      },
    },
  },
})
