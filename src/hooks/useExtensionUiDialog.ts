import { createSignal, onCleanup, onMount } from 'solid-js'
import type { ExtensionUiRequest, ExtensionUiResponse } from '../lib/extensionUiTypes'
import { extensionUiRequestSchema } from '../lib/extensionUiTypes'
import { asUiPromptEvent } from '../lib/sessionEvents'

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
    const unsubRequest = window.openpi.onExtensionUiRequest((raw) => {
      const parsed = extensionUiRequestSchema.safeParse(raw)
      if (!parsed.success) {
        console.warn('[openpi] extension_ui_request parse failed', parsed.error.flatten(), raw)
        return
      }
      setRequest(parsed.data)
    })

    // A prompt can expire (Pi's dialog timeout) or be dismissed from the other
    // side. Without this the dialog would stay up and its answer would be
    // dropped, so the user would think the change went through.
    const unsubEvent = window.openpi.onSessionEvent((event) => {
      const prompt = asUiPromptEvent(event)
      if (prompt?.type !== 'ui_prompt_end') return
      const current = request()
      if (current && current.id === prompt.id) setRequest(null)
    })

    onCleanup(unsubRequest)
    onCleanup(unsubEvent)
  })

  onCleanup(() => {
    const current = request()
    if (current) {
      void window.openpi.resolveExtensionUi({ id: current.id, cancelled: true })
    }
  })

  return { request, respond, dismiss }
}
