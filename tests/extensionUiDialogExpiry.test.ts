import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useExtensionUiDialog } from '../src/hooks/useExtensionUiDialog'
import type { ExtensionUiRequest } from '../src/lib/extensionUiTypes'
import type { SessionEvent } from '../src/lib/ipc'

function stubBridge() {
  let onRequest: ((request: ExtensionUiRequest) => void) | undefined
  let onEvent: ((event: SessionEvent) => void) | undefined
  vi.stubGlobal('openpi', {
    onExtensionUiRequest: (cb: (request: ExtensionUiRequest) => void) => {
      onRequest = cb
      return () => {}
    },
    onSessionEvent: (cb: (event: SessionEvent) => void) => {
      onEvent = cb
      return () => {}
    },
    resolveExtensionUi: vi.fn(),
  })
  return {
    request: (request: ExtensionUiRequest) => onRequest?.(request),
    event: (event: SessionEvent) => onEvent?.(event),
  }
}

async function setup() {
  const bridge = stubBridge()
  const root = createRoot((dispose) => ({ dialog: useExtensionUiDialog(), dispose }))
  // onMount subscribes after the root's first pass.
  await Promise.resolve()
  return { bridge, root }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('extension ui dialog lifecycle', () => {
  it('shows a request and clears it when its prompt ends', async () => {
    const { bridge, root } = await setup()

    bridge.request({ id: 'a', method: 'confirm', title: 'Allow?' })
    expect(root.dialog.request()?.id).toBe('a')

    bridge.event({ type: 'ui_prompt_end', id: 'a', kind: 'confirm', title: 'Allow?' })

    expect(root.dialog.request()).toBeNull()
    root.dispose()
  })

  it('keeps a dialog whose prompt is still pending', async () => {
    const { bridge, root } = await setup()

    bridge.request({ id: 'a', method: 'confirm', title: 'Allow?' })
    bridge.event({ type: 'ui_prompt_end', id: 'other', kind: 'confirm', title: 'Other?' })

    expect(root.dialog.request()?.id).toBe('a')
    root.dispose()
  })

  it('ignores session events that are not prompt events', async () => {
    const { bridge, root } = await setup()

    bridge.request({ id: 'a', method: 'confirm', title: 'Allow?' })
    bridge.event({ type: 'turn_end', turnIndex: 1, message: {}, toolResults: [] })

    expect(root.dialog.request()?.id).toBe('a')
    root.dispose()
  })
})
