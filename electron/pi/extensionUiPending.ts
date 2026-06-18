import type { ExtensionUiResponse } from '../../src/lib/extensionUiTypes'

type Pending = {
  resolve: (response: ExtensionUiResponse) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
}

const pending = new Map<string, Pending>()

export function registerExtensionUiPending(
  id: string,
  timeoutMs: number,
  resolve: (response: ExtensionUiResponse) => void,
  reject: (err: Error) => void
): void {
  const existing = pending.get(id)
  if (existing) {
    clearTimeout(existing.timeout)
    pending.delete(id)
  }

  const timeout = setTimeout(() => {
    pending.delete(id)
    resolve({ id, cancelled: true })
  }, timeoutMs)

  pending.set(id, { resolve, reject, timeout })
}

export function fulfillExtensionUiPending(response: ExtensionUiResponse): boolean {
  const entry = pending.get(response.id)
  if (!entry) return false
  clearTimeout(entry.timeout)
  pending.delete(response.id)
  entry.resolve(response)
  return true
}

export function rejectAllExtensionUiPending(reason: string): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timeout)
    entry.reject(new Error(reason))
    pending.delete(id)
  }
}
