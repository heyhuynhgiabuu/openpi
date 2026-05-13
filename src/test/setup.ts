// SolidJS testing setup
import '@testing-library/jest-dom/vitest'

// jsdom's Storage sometimes lacks `clear` in the version used by this
// vitest environment. Provide a minimal in-memory stub so keybinding
// tests can call localStorage.clear() without TypeError.
const store: Record<string, string> = {}
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => { store[k] = v },
    removeItem: (k: string) => { delete store[k] },
    clear: () => { for (const k of Object.keys(store)) delete store[k] },
    get length() { return Object.keys(store).length },
    key: (i: number) => Object.keys(store)[i] ?? null,
  } satisfies Storage,
})
