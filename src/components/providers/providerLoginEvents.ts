import type { Setter } from 'solid-js'
import type { ProviderLoginEvent } from '../../lib/ipc'
import type { LoginPhase } from './providerHelpers'

interface ProviderLoginEventContext {
  event: ProviderLoginEvent
  setLoginPhase: Setter<LoginPhase>
  setPromptInput: Setter<string>
  focusPromptInput: () => void
  onConnected: () => void
  loadProviders: () => void
}

export function handleProviderLoginEvent(context: ProviderLoginEventContext) {
  const { event } = context

  switch (event.type) {
    case 'progress':
      context.setLoginPhase((prev) =>
        prev.phase === 'connecting' || prev.phase === 'prompting'
          ? { ...prev, message: event.message }
          : prev
      )
      break
    case 'auth':
      context.setLoginPhase((prev) =>
        prev.phase === 'connecting' || prev.phase === 'prompting'
          ? {
              phase: 'connecting',
              providerId: prev.providerId,
              message: 'Open the URL below and enter the code to continue',
              authUrl: event.url,
              authInstructions: event.instructions,
            }
          : prev
      )
      break
    case 'prompt':
      context.setPromptInput('')
      context.setLoginPhase((prev) =>
        prev.phase === 'connecting' || prev.phase === 'prompting'
          ? {
              phase: 'prompting',
              providerId: prev.providerId,
              message: event.message,
              placeholder: event.placeholder,
              allowEmpty: event.allowEmpty,
            }
          : prev
      )
      setTimeout(context.focusPromptInput, 50)
      break
    case 'select':
      context.setLoginPhase((prev) =>
        prev.phase === 'connecting'
          ? {
              phase: 'selecting',
              providerId: prev.providerId,
              message: event.message,
              options: event.options,
            }
          : prev
      )
      break
    case 'success':
      context.setLoginPhase({ phase: 'idle' })
      context.onConnected()
      context.loadProviders()
      break
    case 'error':
      context.setLoginPhase((prev) =>
        prev.phase === 'idle'
          ? prev
          : { phase: 'error', providerId: prev.providerId, message: event.message }
      )
      break
  }
}
