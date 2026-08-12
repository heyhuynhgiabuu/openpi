import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { ProviderAuthBridge, providerLoginFailureEvent } from '../electron/pi/providerAuth'
import { routeProviderLoginEvent } from '../electron/pi/providerEvents'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { logoutProvider } from '../src/components/providers/providerActions'
import type { LoginPhase } from '../src/components/providers/providerHelpers'
import { handleProviderLoginEvent } from '../src/components/providers/providerLoginEvents'
import type { ProviderLoginEvent } from '../src/lib/ipc'

function createRendererHarness() {
  const [phase, setPhase] = createSignal<LoginPhase>({
    phase: 'connecting',
    providerId: 'openai-codex',
    message: 'Starting sign-in…',
  })
  const [, setPromptInput] = createSignal('')
  const openExternal = vi.fn(async () => {})
  const onConnected = vi.fn()
  const loadProviders = vi.fn()
  const errors: string[] = []

  const route = (raw: unknown) =>
    routeProviderLoginEvent(raw, {
      openExternal,
      emit: (event) =>
        handleProviderLoginEvent({
          event,
          setLoginPhase: setPhase,
          setPromptInput,
          focusPromptInput: vi.fn(),
          onConnected,
          loadProviders,
        }),
      emitError: (message) => errors.push(message),
    })

  return { phase, route, openExternal, onConnected, loadProviders, errors }
}

describe('provider login failures', () => {
  it('reports committed credentials without asking for a blind retry', () => {
    const error = Object.assign(new Error('local synchronization failed'), {
      name: 'CredentialSynchronizationError',
      providerId: 'openrouter',
      operation: 'login',
    })

    expect(providerLoginFailureEvent(error)).toEqual({
      type: 'error',
      message:
        'Credentials were saved for openrouter, but provider state could not be refreshed. Restart OpenPi or refresh providers; do not sign in again.',
    })
  })

  it('preserves ordinary provider errors', () => {
    expect(providerLoginFailureEvent(new Error('Access denied'))).toEqual({
      type: 'error',
      message: 'Access denied',
    })
  })
})

describe('provider authentication flow', () => {
  it('routes a select-first browser flow from sidecar through main to renderer', async () => {
    const renderer = createRendererHarness()
    const messages: Extract<SidecarMessage, { type: 'provider_login_event' }>[] = []
    const bridge = new ProviderAuthBridge((requestId, event) => {
      const message = { type: 'provider_login_event' as const, requestId, event }
      messages.push(message)
      renderer.route(message.event)
    })
    const interaction = bridge.createInteraction('request-1', 'openai-codex')

    const selection = interaction.prompt({
      type: 'select',
      message: 'Select OpenAI Codex login method',
      options: [{ id: 'browser', label: 'Browser login' }],
    })
    expect(renderer.phase().phase).toBe('selecting')

    expect(bridge.resolve('openai-codex', 'browser')).toBe(true)
    await expect(selection).resolves.toBe('browser')

    interaction.notify({
      type: 'auth_url',
      url: 'https://auth.openai.com/oauth',
      instructions: 'Continue in your browser.',
    })

    expect(messages).toHaveLength(2)
    expect(renderer.phase()).toMatchObject({
      phase: 'connecting',
      providerId: 'openai-codex',
      authUrl: 'https://auth.openai.com/oauth',
    })
    expect(renderer.openExternal).toHaveBeenCalledWith('https://auth.openai.com/oauth')

    renderer.route({ type: 'success' })
    expect(renderer.phase()).toEqual({ phase: 'idle' })
    expect(renderer.onConnected).toHaveBeenCalledOnce()
    expect(renderer.loadProviders).toHaveBeenCalledOnce()
    expect(renderer.errors).toEqual([])
  })

  it('cancels a pending manual-code prompt when its callback wins', async () => {
    const controller = new AbortController()
    const bridge = new ProviderAuthBridge(() => {})
    const interaction = bridge.createInteraction('request-2', 'openrouter')
    const prompt = interaction.prompt({
      type: 'manual_code',
      message: 'Paste the authorization code',
      signal: controller.signal,
    })

    controller.abort(new Error('Browser callback completed'))

    await expect(prompt).rejects.toThrow('Browser callback completed')
    expect(bridge.resolve('openrouter', 'late-code')).toBe(false)
  })

  it('rejects an older prompt when a provider opens a replacement prompt', async () => {
    const bridge = new ProviderAuthBridge(() => {})
    const interaction = bridge.createInteraction('request-3', 'github-copilot')
    const first = interaction.prompt({ type: 'text', message: 'First prompt' })
    const second = interaction.prompt({ type: 'text', message: 'Replacement prompt' })

    await expect(first).rejects.toThrow('replaced')
    expect(bridge.resolve('github-copilot', '')).toBe(true)
    await expect(second).resolves.toBe('')
  })

  it('waits for logout acknowledgement before refreshing provider state', async () => {
    const logout = vi.fn(async () => {})
    Object.defineProperty(window, 'openpi', {
      configurable: true,
      value: { logoutProvider: logout },
    })
    const onConnected = vi.fn()
    const loadProviders = vi.fn(async () => {})

    await logoutProvider('anthropic', onConnected, loadProviders)

    expect(logout).toHaveBeenCalledWith('anthropic')
    expect(onConnected).toHaveBeenCalledOnce()
    expect(loadProviders).toHaveBeenCalledOnce()
  })

  it.each([
    'not a url',
    '//example.com',
    'file:///tmp/credential.html',
  ])('rejects an unsafe authentication URL without throwing: %s', (url) => {
    const emitted: ProviderLoginEvent[] = []
    const errors: string[] = []

    expect(() =>
      routeProviderLoginEvent(
        { type: 'auth', url },
        {
          openExternal: vi.fn(async () => {}),
          emit: (event) => emitted.push(event),
          emitError: (message) => errors.push(message),
        }
      )
    ).not.toThrow()

    expect(emitted).toEqual([])
    expect(errors).toEqual(['Invalid provider authentication event.'])
  })

  it('reports an external-browser launch failure without rejecting globally', async () => {
    const errors: string[] = []

    routeProviderLoginEvent(
      { type: 'auth', url: 'https://example.com/oauth' },
      {
        openExternal: vi.fn(async () => {
          throw new Error('No browser available')
        }),
        emit: vi.fn(),
        emitError: (message) => errors.push(message),
      }
    )
    await Promise.resolve()

    expect(errors).toEqual(['Unable to open the provider authentication URL.'])
  })
})
