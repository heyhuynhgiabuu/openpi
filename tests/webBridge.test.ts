import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '../src/lib/ipc/channels'
import { createWebBridge, ensureWebBridge, isWebBridge } from '../src/lib/webBridge'

describe('webBridge web mode', () => {
  beforeEach(() => {
    // clean DOM + window
    document.body.innerHTML = ''
    // clear openpi
    ;(window as unknown as { openpi?: unknown; __openpiIsWeb?: boolean }).openpi = undefined
    ;(window as unknown as { __openpiIsWeb?: boolean }).__openpiIsWeb = undefined
    vi.restoreAllMocks()
  })
  afterEach(() => {
    document.body.innerHTML = ''
    ;(window as unknown as { openpi?: unknown; __openpiIsWeb?: boolean }).openpi = undefined
    ;(window as unknown as { __openpiIsWeb?: boolean }).__openpiIsWeb = undefined
  })

  it('ensureWebBridge injects bridge and marks isWebBridge', () => {
    expect(isWebBridge()).toBe(false)
    ensureWebBridge()
    expect(isWebBridge()).toBe(true)
    const bridge = (window as unknown as { openpi: Record<string, unknown> }).openpi
    expect(bridge).toBeDefined()
    expect(bridge.__isWebBridge).toBe(true)
  })

  it('createWebBridge pickWorkspace with direct path invokes without modal', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          text: async () => JSON.stringify({ cancelled: false, path: '/home/test/proj' }),
        }) as unknown as Response
    )
    vi.stubGlobal('fetch', fetchMock)

    const bridge = createWebBridge('http://localhost:8000') as {
      pickWorkspace: (p?: unknown) => Promise<unknown>
    }
    const result = await bridge.pickWorkspace({ path: '/home/test/proj' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = (fetchMock.mock.calls as unknown[][])[0]![0] as string
    expect(url).toContain(encodeURIComponent(IPC.PICK_WORKSPACE))
    const opts = (fetchMock.mock.calls as unknown[][])[0]![1] as { body: string }
    expect(JSON.parse(opts.body)).toEqual({ path: '/home/test/proj' })
    expect(result).toEqual({ cancelled: false, path: '/home/test/proj' })
  })

  it('pickWorkspace with string path also invokes', async () => {
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          text: async () => JSON.stringify({ cancelled: false, path: '/tmp/a' }),
        }) as unknown as Response
    )
    vi.stubGlobal('fetch', fetchMock)
    const bridge = createWebBridge('http://localhost:8000') as {
      pickWorkspace: (p?: unknown) => Promise<unknown>
    }
    const result = await bridge.pickWorkspace('/tmp/a')
    expect(result).toEqual({ cancelled: false, path: '/tmp/a' })
  })

  it('pickWorkspace without path shows modal with workspaces and validates absolute path', async () => {
    const workspaces = [
      { path: '/home/andrea/Projects/openpi', displayName: 'openpi' },
      { path: '/home/andrea/Projects/foo', displayName: 'foo' },
    ]
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes(encodeURIComponent(IPC.GET_WORKSPACES))) {
        return {
          ok: true,
          text: async () => JSON.stringify(workspaces),
        } as unknown as Response
      }
      if (String(url).includes(encodeURIComponent(IPC.PICK_WORKSPACE))) {
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ cancelled: false, path: '/home/andrea/Projects/openpi' }),
        } as unknown as Response
      }
      return { ok: true, text: async () => '{}' } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const bridge = createWebBridge('http://localhost:8000') as {
      pickWorkspace: () => Promise<unknown>
    }
    const promise = bridge.pickWorkspace()
    // modal should be in DOM after microtask
    await new Promise((r) => setTimeout(r, 20))
    const overlay = document.getElementById('openpi-workspace-picker')
    expect(overlay).not.toBeNull()
    // should list both workspaces
    expect(overlay?.textContent).toContain('openpi')
    expect(overlay?.textContent).toContain('/home/andrea/Projects/foo')
    // click first workspace button
    const _firstBtn = overlay?.querySelector('button') as HTMLButtonElement | null
    // first button is the first workspace? Actually title + hint + list buttons, first workspace button is inside list
    // Find workspace buttons via text content
    const wsButtons = Array.from(overlay?.querySelectorAll('button') ?? []).filter((b) =>
      b.textContent?.includes('/home/andrea/Projects')
    )
    expect(wsButtons.length).toBe(2)
    // click first workspace to select
    wsButtons[0].click()
    // find input and verify it got filled
    const input = overlay?.querySelector('input') as HTMLInputElement | null
    expect(input?.value).toBe('/home/andrea/Projects/openpi')
    // find Open button (last button)
    const allButtons = Array.from(overlay?.querySelectorAll('button') ?? [])
    const openBtn = allButtons.find((b) => b.textContent === 'Open')
    expect(openBtn).toBeDefined()
    openBtn?.click()
    const result = await promise
    expect(result).toEqual({ cancelled: false, path: '/home/andrea/Projects/openpi' })
  })

  it('modal validates absolute path and shows error for relative', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes(encodeURIComponent(IPC.GET_WORKSPACES))) {
        return { ok: true, text: async () => JSON.stringify([]) } as unknown as Response
      }
      return { ok: true, text: async () => '{}' } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)

    const bridge = createWebBridge('http://localhost:8000') as {
      pickWorkspace: () => Promise<unknown>
    }
    const promise = bridge.pickWorkspace()
    await new Promise((r) => setTimeout(r, 20))
    const overlay = document.getElementById('openpi-workspace-picker')
    expect(overlay).not.toBeNull()
    const input = overlay?.querySelector('input') as HTMLInputElement
    const openBtn = Array.from(overlay?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Open'
    ) as HTMLButtonElement
    // enter relative path
    input.value = 'relative/path'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    openBtn.click()
    // should still be open and show error
    await new Promise((r) => setTimeout(r, 10))
    expect(document.getElementById('openpi-workspace-picker')).not.toBeNull()
    expect(overlay?.textContent).toContain('absolute')
    // cancel via Cancel button
    const cancelBtn = Array.from(overlay?.querySelectorAll('button') ?? []).find(
      (b) => b.textContent === 'Cancel'
    ) as HTMLButtonElement
    cancelBtn.click()
    const result = await promise
    expect(result).toEqual({ cancelled: true })
  })

  it('modal cancel returns cancelled', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes(encodeURIComponent(IPC.GET_WORKSPACES))) {
        return { ok: true, text: async () => JSON.stringify([]) } as unknown as Response
      }
      return { ok: true, text: async () => '{}' } as unknown as Response
    })
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
    const bridge = createWebBridge('http://localhost:8000') as {
      pickWorkspace: () => Promise<unknown>
    }
    const promise = bridge.pickWorkspace()
    await new Promise((r) => setTimeout(r, 20))
    const overlay = document.getElementById('openpi-workspace-picker')!
    const cancel = Array.from(overlay.querySelectorAll('button')).find(
      (b) => b.textContent === 'Cancel'
    )!
    cancel.click()
    expect(await promise).toEqual({ cancelled: true })
  })
})
