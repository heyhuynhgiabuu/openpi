import { createSignal } from 'solid-js'

export interface BooleanPrefMeta<Key extends string> {
  key: Key
  storageKey: string
  defaultValue: boolean
}

interface UseBooleanPrefsOptions<Key extends string> {
  metas: readonly BooleanPrefMeta<Key>[]
  defaults: Record<Key, boolean>
  load: () => Promise<Record<Key, boolean>>
  markSaved: (key: Key) => void
  onError: (message: string) => void
  /** Called with the next values after a local change, for broadcasters. */
  onChange?: (values: Record<Key, boolean>) => void
}

/**
 * State, save, and reset for a family of boolean preferences stored one key per
 * value. Every family behaves the same way, so they share this instead of
 * repeating the same load/save/reset trio.
 */
export function useBooleanPrefs<Key extends string>(options: UseBooleanPrefsOptions<Key>) {
  const [values, setValues] = createSignal<Record<Key, boolean>>({ ...options.defaults })

  const save = (key: Key, value: boolean) => {
    const meta = options.metas.find((item) => item.key === key)
    if (!meta) return

    setValues((prev) => {
      const next = { ...prev, [key]: value }
      options.onChange?.(next)
      return next
    })

    void window.openpi
      .setPref(meta.storageKey, String(value))
      .then(() => options.markSaved(key))
      .catch((err) => options.onError(err instanceof Error ? err.message : String(err)))
  }

  const reset = (key: Key) => {
    const meta = options.metas.find((item) => item.key === key)
    if (!meta) return
    save(key, meta.defaultValue)
  }

  return { values, load: () => options.load().then(setValues), save, reset }
}
