import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { providerInfoSchema } from '../src/lib/ipc'

const sent: SidecarMessage[] = []

interface FakeProvider {
  id: string
  name: string
  configured: boolean
}

function fakeRuntime(providers: FakeProvider[], credentialIds: string[]) {
  return {
    getAvailable: async () => [],
    listCredentials: async () =>
      credentialIds.map((providerId) => ({ providerId, type: 'api_key' as const })),
    getModels: () => [],
    getProviders: () =>
      providers.map(({ id, name }) => ({ id, name, auth: { apiKey: { login: true } } })),
    getProviderAuthStatus: (id: string) => ({
      configured: providers.find((provider) => provider.id === id)?.configured ?? false,
    }),
  }
}

let runtime = fakeRuntime([], [])

vi.mock('../electron/pi/sidecarContext', () => ({
  clearResourceLoaderCache: vi.fn(),
  getAgentDir: vi.fn(),
  getModelRuntime: async () => runtime,
  getState: vi.fn(),
  invalidateModelRuntime: vi.fn(),
  outputLine: vi.fn(),
  providerAuthBridge: {},
  send: (message: SidecarMessage) => sent.push(message),
}))
// The trust commands read the workspace from whichever runtime is serving; no durable session here.
vi.mock('../electron/pi/durableHost', () => ({
  durableSessions: { cwd: () => undefined },
}))

const { handleGetProvidersCommand } = await import('../electron/pi/providerCommands')

/** Run the handler and validate its payload exactly as the IPC handler does. */
async function loadProviders() {
  sent.length = 0
  await handleGetProvidersCommand({ type: 'get_providers', requestId: 'req-1' })
  const message = sent[0]
  if (message?.type !== 'providers_result') throw new Error('expected providers_result')
  return providerInfoSchema.array().parse(message.providers)
}

const azure = { id: 'azure', name: 'Azure', configured: false }
const anthropic = { id: 'anthropic', name: 'Anthropic', configured: true }

describe('handleGetProvidersCommand legacy Azure credential', () => {
  beforeEach(() => {
    sent.length = 0
  })

  it('flags azure when only a credential under the legacy id is stored', async () => {
    runtime = fakeRuntime([azure, anthropic], ['anthropic', 'azure-openai-responses'])
    const providers = await loadProviders()
    expect(providers.find((p) => p.id === 'azure')?.legacyCredentialId).toBe(
      'azure-openai-responses'
    )
    expect(providers.find((p) => p.id === 'anthropic')?.legacyCredentialId).toBeUndefined()
  })

  it('omits the field when no legacy credential is stored', async () => {
    runtime = fakeRuntime([azure, anthropic], ['anthropic'])
    const providers = await loadProviders()
    expect(providers.find((p) => p.id === 'azure')?.legacyCredentialId).toBeUndefined()
  })

  it('omits the field once azure itself is connected', async () => {
    runtime = fakeRuntime(
      [{ ...azure, configured: true }, anthropic],
      ['azure', 'azure-openai-responses']
    )
    const providers = await loadProviders()
    expect(providers.find((p) => p.id === 'azure')?.legacyCredentialId).toBeUndefined()
  })

  it('does not invent a provider entry for the legacy id', async () => {
    runtime = fakeRuntime([azure], ['azure-openai-responses'])
    const providers = await loadProviders()
    expect(providers.map((p) => p.id)).toEqual(['azure'])
  })
})
