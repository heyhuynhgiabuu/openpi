import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TunnelStatus } from '../electron/ipc/tunnel'
import { TunnelSection } from '../src/components/customizations/TunnelSection'

const gen = () => ({
  getStatus: vi.fn(),
  getUrl: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
  generateQr: vi.fn(),
})

function mockOpenpi() {
  const api = { ...gen(), openExternal: vi.fn() }
  // @ts-expect-error partial bridge for the tunnel surface under test
  window.openpi = api
  return api
}

function status(overrides: Partial<TunnelStatus>): TunnelStatus {
  return { state: 'off', ...overrides }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TunnelSection', () => {
  it('renders the not-installed guidance when zrok is missing', async () => {
    const api = mockOpenpi()
    api.getStatus.mockResolvedValue(status({ installed: false }))
    const { findByText } = render(() => <TunnelSection onError={() => {}} />)
    expect(await findByText(/zrok is not installed/i)).toBeTruthy()
  })

  it('renders an enrollment token field when not enrolled', async () => {
    const api = mockOpenpi()
    api.getStatus.mockResolvedValue(status({ installed: true, enrolled: false }))
    const { findByPlaceholderText } = render(() => <TunnelSection onError={() => {}} />)
    expect(await findByPlaceholderText(/zrok token/i)).toBeTruthy()
  })

  it('renders a Connect action when installed, enrolled, and off', async () => {
    const api = mockOpenpi()
    api.getStatus.mockResolvedValue(status({ installed: true, enrolled: true }))
    const { findByText, findByRole } = render(() => <TunnelSection onError={() => {}} />)
    expect(await findByText(/tunnel is disconnected/i)).toBeTruthy()
    expect(await findByRole('button', { name: /connect/i })).toBeTruthy()
  })

  it('renders the live URL and QR once connected', async () => {
    const api = mockOpenpi()
    const url = 'https://pidashabc123.shares.zrok.io'
    api.getStatus.mockResolvedValue(
      status({ installed: true, enrolled: true, state: 'running', url })
    )
    api.generateQr.mockResolvedValue('data:image/png;base64,AAAA')
    const { findByText, findByAltText } = render(() => <TunnelSection onError={() => {}} />)
    expect(await findByText(/tunnel is live/i)).toBeTruthy()
    const img = (await findByAltText(/tunnel qr code/i)) as HTMLImageElement
    expect(img.src).toBe('data:image/png;base64,AAAA')
  })

  it('renders basic-auth credentials with a Copy creds action once connected', async () => {
    const api = mockOpenpi()
    api.getStatus.mockResolvedValue(
      status({
        installed: true,
        enrolled: true,
        state: 'running',
        url: 'https://pidashabc123.shares.zrok.io',
        authUser: 'dashboard',
        authPass: 'aB3xY9zQ0pW1kL2mN',
      })
    )
    api.generateQr.mockResolvedValue('data:image/png;base64,AAAA')
    const { findByText, findByRole } = render(() => <TunnelSection onError={() => {}} />)
    expect(await findByText(/dashboard:aB3xY9zQ0pW1kL2mN/i)).toBeTruthy()
    expect(await findByRole('button', { name: /copy creds/i })).toBeTruthy()
  })
})
