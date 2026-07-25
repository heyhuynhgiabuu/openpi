import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { answerApiKeyPrompt, toProviderPromptEvent } from '../electron/pi/providerAuth'
import {
  type LoginPhase,
  SUBSCRIPTION_PROVIDERS,
} from '../src/components/providers/providerHelpers'
import { handleProviderLoginEvent } from '../src/components/providers/providerLoginEvents'

describe('Pi 0.82 provider integration', () => {
  it('surfaces new OAuth-capable providers', () => {
    const ids = SUBSCRIPTION_PROVIDERS.map((provider) => provider.id)

    expect(ids).toContain('openrouter')
    expect(ids).toContain('kimi-coding')
    expect(ids).toContain('xai')
  })

  it('allows blank text prompts but still requires secret prompts', () => {
    expect(
      toProviderPromptEvent({
        type: 'text',
        message: 'GitHub Enterprise URL/domain (blank for github.com)',
      })
    ).toMatchObject({ type: 'prompt', allowEmpty: true })
    expect(toProviderPromptEvent({ type: 'secret', message: 'Enter API key' })).toMatchObject({
      type: 'prompt',
      allowEmpty: false,
    })
  })

  it('preserves key-plus-environment setup for Cloudflare providers', () => {
    const state = { keyUsed: false }
    const common = {
      apiKey: 'test-key',
      providerName: 'Cloudflare AI Gateway',
      state,
      env: {
        CLOUDFLARE_ACCOUNT_ID: 'account-id',
        CLOUDFLARE_GATEWAY_ID: 'gateway-id',
      },
    }

    expect(
      answerApiKeyPrompt({
        ...common,
        prompt: { type: 'secret', message: 'Enter Cloudflare API key' },
      })
    ).toBe('test-key')
    expect(
      answerApiKeyPrompt({
        ...common,
        prompt: { type: 'text', message: 'Enter Cloudflare account ID' },
      })
    ).toBe('account-id')
    expect(
      answerApiKeyPrompt({
        ...common,
        prompt: { type: 'text', message: 'Enter Cloudflare AI Gateway ID' },
      })
    ).toBe('gateway-id')
  })

  it('accepts browser auth events after a login-method selection', () => {
    const [phase, setPhase] = createSignal<LoginPhase>({
      phase: 'selecting',
      providerId: 'openai-codex',
      message: 'Select OpenAI Codex login method',
      options: [{ id: 'browser', label: 'Browser login' }],
    })
    const [, setPromptInput] = createSignal('')

    handleProviderLoginEvent({
      event: { type: 'auth', url: 'https://example.com/oauth' },
      setLoginPhase: setPhase,
      setPromptInput,
      focusPromptInput: vi.fn(),
      onConnected: vi.fn(),
      loadProviders: vi.fn(),
    })

    expect(phase()).toMatchObject({
      phase: 'connecting',
      providerId: 'openai-codex',
      authUrl: 'https://example.com/oauth',
    })
  })

  it('renders device authorization events as a browser flow', () => {
    const [phase, setPhase] = createSignal<LoginPhase>({
      phase: 'connecting',
      providerId: 'kimi-coding',
      message: 'Starting',
    })
    const [promptInput, setPromptInput] = createSignal('')

    handleProviderLoginEvent({
      event: {
        type: 'device_code',
        verificationUri: 'https://example.com/device',
        userCode: 'ABCD-1234',
      },
      setLoginPhase: setPhase,
      setPromptInput,
      focusPromptInput: vi.fn(),
      onConnected: vi.fn(),
      loadProviders: vi.fn(),
    })

    expect(phase()).toEqual({
      phase: 'connecting',
      providerId: 'kimi-coding',
      message: 'Complete sign-in in your browser',
      authUrl: 'https://example.com/device',
      authInstructions: 'Enter code: ABCD-1234',
    })
    expect(promptInput()).toBe('')
  })
})
