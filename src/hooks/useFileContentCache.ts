import { createSignal } from 'solid-js'

export interface FileContentCache {
  fileContentFor: (path: string) => string | null
  ensureFileContent: (path: string) => Promise<string | null>
}

export function useFileContentCache(): FileContentCache {
  const cache = new Map<string, string | null>()
  const inflight = new Map<string, Promise<string | null>>()
  const [tick, setTick] = createSignal(0)

  const ensureFileContent = async (path: string): Promise<string | null> => {
    if (cache.has(path)) return cache.get(path) ?? null
    const existing = inflight.get(path)
    if (existing) return existing
    const promise = (async () => {
      try {
        const result = await window.openpi.readFile(path)
        const value =
          typeof result === 'string'
            ? result
            : typeof result?.content === 'string'
              ? result.content
              : null
        cache.set(path, value)
        setTick((n) => n + 1)
        return value
      } catch {
        cache.set(path, null)
        return null
      } finally {
        inflight.delete(path)
      }
    })()
    inflight.set(path, promise)
    return promise
  }

  const fileContentFor = (path: string) => {
    tick()
    return cache.get(path) ?? null
  }

  return { fileContentFor, ensureFileContent }
}
