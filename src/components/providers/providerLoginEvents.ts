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

function activeProviderId(phase: LoginPhase): string | null {
  switch (phase.phase) {
    case 'connecting':
    case 'prompting':
    case 'selecting':
      return phase.providerId
    case 'idle':
    case 'error':
      return null
    default: {
      const _exhaustive: never = phase
      throw new Error(`Unsupported login phase: ${String(_exhaustive)}`)
    }
  }
}

export function handleProviderLoginEvent(context: ProviderLoginEventContext) {
  const { event } = context

  switch (event.type) {
    case 'progress':
      context.setLoginPhase((prev) =>
        activeProviderId(prev) ? { ...prev, message: event.message } : prev
      )
      break
    case 'auth':
      context.setLoginPhase((prev) => {
        const providerId = activeProviderId(prev)
        return providerId
          ? {
              phase: 'connecting',
              providerId,
              message: 'Complete sign-in in your browser',
              authUrl: event.url,
              authInstructions: event.instructions,
            }
          : prev
      })
      break
    case 'device_code':
      context.setLoginPhase((prev) => {
        const providerId = activeProviderId(prev)
        return providerId
          ? {
              phase: 'connecting',
              providerId,
              message: 'Complete sign-in in your browser',
              authUrl: event.verificationUri,
              authInstructions: `Enter code: ${event.userCode}`,
            }
          : prev
      })
      break
    case 'prompt':
      context.setPromptInput('')
      context.setLoginPhase((prev) => {
        const providerId = activeProviderId(prev)
        return providerId
          ? {
              phase: 'prompting',
              providerId,
              message: event.message,
              placeholder: event.placeholder,
              allowEmpty: event.allowEmpty,
            }
          : prev
      })
      setTimeout(context.focusPromptInput, 50)
      break
    case 'select':
      context.setLoginPhase((prev) => {
        const providerId = activeProviderId(prev)
        return providerId
          ? {
              phase: 'selecting',
              providerId,
              message: event.message,
              options: event.options,
            }
          : prev
      })
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
