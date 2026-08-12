import type { AuthEvent, AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai'
import type { ProviderLoginEvent } from '../../src/lib/ipc'

interface CredentialSynchronizationFailure extends Error {
  name: 'CredentialSynchronizationError'
  providerId: string
  operation: string
}

function isCredentialSynchronizationFailure(
  error: unknown
): error is CredentialSynchronizationFailure {
  if (!(error instanceof Error) || error.name !== 'CredentialSynchronizationError') return false
  const candidate = error as Error & { providerId?: unknown; operation?: unknown }
  return typeof candidate.providerId === 'string' && typeof candidate.operation === 'string'
}

export function providerLoginFailureEvent(error: unknown): ProviderLoginEvent {
  if (isCredentialSynchronizationFailure(error)) {
    return {
      type: 'error',
      message: `Credentials were saved for ${error.providerId}, but provider state could not be refreshed. Restart OpenPi or refresh providers; do not sign in again.`,
    }
  }
  return { type: 'error', message: error instanceof Error ? error.message : String(error) }
}

type PromptLoginEvent =
  | Extract<ProviderLoginEvent, { type: 'prompt' }>
  | Extract<ProviderLoginEvent, { type: 'select' }>

export function toProviderLoginEvent(event: AuthEvent): ProviderLoginEvent {
  switch (event.type) {
    case 'auth_url':
      return { type: 'auth', url: event.url, instructions: event.instructions }
    case 'device_code':
      return event
    case 'progress':
      return event
    case 'info': {
      const link = event.links?.[0]
      return link
        ? { type: 'auth', url: link.url, instructions: event.message }
        : { type: 'progress', message: event.message }
    }
    default: {
      const _exhaustive: never = event
      throw new Error(`Unsupported provider authentication event: ${String(_exhaustive)}`)
    }
  }
}

export function toProviderPromptEvent(prompt: AuthPrompt): PromptLoginEvent {
  if (prompt.type === 'select') {
    return {
      type: 'select',
      message: prompt.message,
      options: prompt.options.map(({ id, label }) => ({ id, label })),
    }
  }
  return {
    type: 'prompt',
    message: prompt.message,
    placeholder: prompt.placeholder,
    allowEmpty: prompt.type !== 'secret',
  }
}

interface PendingProviderPrompt {
  resolve: (value: string) => void
  cancel: (reason?: unknown) => void
}

export class ProviderAuthBridge {
  private readonly pendingByProvider = new Map<string, PendingProviderPrompt>()

  constructor(private readonly send: (requestId: string, event: ProviderLoginEvent) => void) {}

  createInteraction(requestId: string, providerId: string): AuthInteraction {
    return {
      notify: (event) => this.send(requestId, toProviderLoginEvent(event)),
      prompt: (prompt) => this.requestInput(requestId, providerId, prompt),
    }
  }

  resolve(providerId: string, value: string): boolean {
    const pending = this.pendingByProvider.get(providerId)
    if (!pending) return false
    pending.resolve(value)
    return true
  }

  private requestInput(requestId: string, providerId: string, prompt: AuthPrompt): Promise<string> {
    this.send(requestId, toProviderPromptEvent(prompt))
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        prompt.signal?.removeEventListener('abort', onAbort)
        if (this.pendingByProvider.get(providerId) === pending) {
          this.pendingByProvider.delete(providerId)
        }
      }
      const pending: PendingProviderPrompt = {
        resolve: (value) => {
          cleanup()
          resolve(value)
        },
        cancel: (reason) => {
          cleanup()
          reject(
            reason instanceof Error
              ? reason
              : new Error('Provider authentication prompt cancelled.')
          )
        },
      }
      const onAbort = () => pending.cancel(prompt.signal?.reason)

      this.pendingByProvider
        .get(providerId)
        ?.cancel(new Error('Provider authentication prompt replaced.'))
      this.pendingByProvider.set(providerId, pending)
      if (prompt.signal?.aborted) onAbort()
      else prompt.signal?.addEventListener('abort', onAbort, { once: true })
    })
  }
}

interface ApiKeyPromptState {
  keyUsed: boolean
}

export function answerApiKeyPrompt(options: {
  prompt: AuthPrompt
  apiKey: string
  providerName: string
  state: ApiKeyPromptState
  env?: NodeJS.ProcessEnv
}): string {
  const { prompt, apiKey, providerName, state, env = process.env } = options
  if (prompt.type === 'select') {
    const apiKeyOption = prompt.options.find((option) =>
      /api.?key|bearer.?token/iu.test(`${option.id} ${option.label}`)
    )
    if (apiKeyOption) return apiKeyOption.id
  } else if (prompt.type === 'secret' && !state.keyUsed) {
    state.keyUsed = true
    return apiKey
  } else if (prompt.type === 'text') {
    if (/account id/iu.test(prompt.message) && env.CLOUDFLARE_ACCOUNT_ID) {
      return env.CLOUDFLARE_ACCOUNT_ID
    }
    if (/gateway id/iu.test(prompt.message) && env.CLOUDFLARE_GATEWAY_ID) {
      return env.CLOUDFLARE_GATEWAY_ID
    }
  }
  throw new Error(`${providerName} requires additional interactive setup.`)
}
