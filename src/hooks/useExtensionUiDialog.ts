import { createSignal, onCleanup, onMount } from 'solid-js'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../lib/extensionUiTypes'
import { extensionUiRequestSchema } from '../lib/extensionUiTypes'

export function useExtensionUiDialog() {
  const [request, setRequest] = createSignal<ExtensionUiRequest | null>(null)

  const respond = (partial: Omit<ExtensionUiResponse, 'id'>) => {
    const current = request()
    if (!current) return
    const payload: ExtensionUiResponse = { id: current.id, ...partial }
    void window.openpi.resolveExtensionUi(payload)
    setRequest(null)
  }

  const dismiss = () => respond({ cancelled: true })

  onMount(() => {
    const unsub = window.openpi.onExtensionUiRequest((raw) => {
      const parsed = extensionUiRequestSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn('[openpi] extension_ui_request parse failed', parsed.error.flatten(), raw)
        return
      }
      setRequest(parsed.data)
    })
    onCleanup(unsub)
  })

  onCleanup(() => {
    const current = request()
    if (current) {
      void window.openpi.resolveExtensionUi({ id: current.id, cancelled: true })
    }
  })

  return { request, respond, dismiss }
}
