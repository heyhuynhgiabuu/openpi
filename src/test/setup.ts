/**
 * Vitest global setup.
 *
 * Provides a minimal in-memory localStorage stub because the jsdom version
 * bundled with this vitest environment does not wire Storage.clear(), causing
 * tests that call localStorage.clear() to throw TypeError.
 *
 * Note: @testing-library/jest-dom is an *optional* peer dep of
 * vite-plugin-solid and is NOT in package-lock.json, so importing it here
 * would break `npm ci` on CI runners.  Add it explicitly to devDependencies
 * before importing it.
 */

const store: Record<string, string> = {}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v
    },
    removeItem: (k: string) => {
      delete store[k]
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k]
    },
    get length() {
      return Object.keys(store).length
    },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } satisfies Storage,
})
