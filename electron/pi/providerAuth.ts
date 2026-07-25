import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import type { ProviderLoginEvent } from '../../src/lib/ipc'

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
