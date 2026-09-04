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
import { TextDecoder, TextEncoder } from 'node:util'

// The jsdom environment swaps realm intrinsics onto globalThis: Uint8Array no
// longer matches the class that Node's TextEncoder/TextDecoder close over.
// esbuild >= 0.28 (pulled in by @earendil-works/chord via pi-coding-agent
// 0.85.0) asserts `new TextEncoder().encode("") instanceof Uint8Array` at
// module init and refuses to load on that mismatch. Wrap the Node encoders so
// they hand back arrays constructed from the *global* realm, restoring the
// invariant esbuild checks. setupFiles always run before test collection.
const GlobalUint8Array = globalThis.Uint8Array
const nodeEncoder = new TextEncoder()
const nodeDecoder = new TextDecoder()

class RealmSafeTextEncoder {
  encoding(): string {
    return 'utf-8'
  }

  encode(input = ''): Uint8Array {
    const bytes = nodeEncoder.encode(input)
    const out = new GlobalUint8Array(bytes.length)
    out.set(bytes)
    return out
  }

  encodeInto(source: string, destination: Uint8Array): { read: number; written: number } {
    return nodeEncoder.encodeInto(source, destination)
  }
}

class RealmSafeTextDecoder {
  get encoding(): string {
    return 'utf-8'
  }

  decode(input?: ArrayBuffer | ArrayBufferView | null): string {
    return nodeDecoder.decode(input as unknown as Parameters<typeof nodeDecoder.decode>[0])
  }
}

Object.defineProperty(globalThis, 'TextEncoder', {
  configurable: true,
  value: RealmSafeTextEncoder as unknown as typeof TextEncoder,
})
Object.defineProperty(globalThis, 'TextDecoder', {
  configurable: true,
  value: RealmSafeTextDecoder as unknown as typeof TextDecoder,
})

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
