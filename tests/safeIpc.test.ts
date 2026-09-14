/* oxlint-disable anti-slop/no-chained-type-assertions -- Electron's IpcMain and BrowserWindow are not constructible in a unit test, so each fake is a minimal subset that must be asserted through unknown; every assertion carries its own SAFETY comment. */
import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { createAuthorizedIpcMain } from '../electron/ipc/safeIpc'

const MAIN_URL = 'file:///app/index.html'

type InvokeListener = (event: IpcMainInvokeEvent, value?: number) => string | undefined
type EventListener = (event: IpcMainInvokeEvent, payload?: string | number) => void

/** Only the fields `isTrustedRendererEvent` reads, so tests can drive the check. */
function fakeEvent(fields: Record<never, never>): IpcMainInvokeEvent {
  // SAFETY: the trusted-sender check reads sender, senderFrame identity, and senderFrame.url.
  return fields as unknown as IpcMainInvokeEvent
}

function createWindow(windowUrl = MAIN_URL) {
  const mainFrame = { url: MAIN_URL }
  const webContents = { mainFrame, getURL: () => windowUrl }
  // SAFETY: the check under test reads webContents.mainFrame and getURL() only.
  const window = { webContents } as unknown as BrowserWindow
  return { window, webContents, mainFrame }
}

function setup() {
  const handlers = new Map<string, InvokeListener>()
  const events = new Map<string, EventListener>()
  const handle = vi.fn((channel: string, listener: InvokeListener) => {
    handlers.set(channel, listener)
  })
  const handleOnce = vi.fn((channel: string, listener: InvokeListener) => {
    handlers.set(channel, listener)
  })
  const on = vi.fn((channel: string, listener: EventListener) => {
    events.set(channel, listener)
  })
  const once = vi.fn((channel: string, listener: EventListener) => {
    events.set(channel, listener)
  })
  const removeHandler = vi.fn()
  const { window, webContents, mainFrame } = createWindow()
  // SAFETY: the factory proxies these registration methods and reads nothing else off ipcMain.
  const ipcMain = { handle, handleOnce, on, once, removeHandler } as unknown as IpcMain
  const authorized = createAuthorizedIpcMain(ipcMain, () => window)
  return { authorized, handlers, events, handleOnce, once, removeHandler, webContents, mainFrame }
}

describe('createAuthorizedIpcMain', () => {
  it('runs a handler for the trusted renderer and passes its result through', () => {
    const { authorized, handlers, webContents, mainFrame } = setup()
    const listener = vi.fn((_event: IpcMainInvokeEvent, value?: number) => `got ${String(value)}`)
    authorized.handle('demo:read', listener)

    const handler = handlers.get('demo:read')
    expect(handler).toBeDefined()
    expect(handler?.(fakeEvent({ sender: webContents, senderFrame: mainFrame }), 42)).toBe('got 42')
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects a handler call when no window exists', () => {
    const handlers = new Map<string, InvokeListener>()
    const handle = vi.fn((channel: string, listener: InvokeListener) => {
      handlers.set(channel, listener)
    })
    // SAFETY: only handle() is registered here; the factory reads nothing else.
    const authorized = createAuthorizedIpcMain({ handle } as unknown as IpcMain, () => null)
    authorized.handle('demo:read', vi.fn())

    expect(() => handlers.get('demo:read')?.(fakeEvent({}))).toThrow('Unauthorized IPC sender')
  })

  it('rejects a window whose main frame url no longer matches', () => {
    const handlers = new Map<string, InvokeListener>()
    const handle = vi.fn((channel: string, listener: InvokeListener) => {
      handlers.set(channel, listener)
    })
    // SAFETY: only handle() is registered here; the factory reads nothing else.
    const ipcMain = { handle } as unknown as IpcMain
    // The frame object is the window's own main frame, but the window reports another url.
    const { window, webContents, mainFrame } = createWindow('https://evil.example')
    const authorized = createAuthorizedIpcMain(ipcMain, () => window)
    authorized.handle('demo:read', vi.fn())

    expect(() =>
      handlers.get('demo:read')?.(fakeEvent({ sender: webContents, senderFrame: mainFrame }))
    ).toThrow('Unauthorized IPC sender')
  })

  it('rejects another sender, a subframe, and a foreign url', () => {
    const { authorized, handlers, webContents, mainFrame } = setup()
    authorized.handle('demo:read', vi.fn())
    const handler = handlers.get('demo:read')

    expect(() => handler?.(fakeEvent({ sender: { other: true }, senderFrame: mainFrame }))).toThrow(
      'Unauthorized IPC sender'
    )
    expect(() =>
      handler?.(fakeEvent({ sender: webContents, senderFrame: { url: MAIN_URL } }))
    ).toThrow('Unauthorized IPC sender')
    expect(() =>
      handler?.(fakeEvent({ sender: webContents, senderFrame: { url: 'https://evil.example' } }))
    ).toThrow('Unauthorized IPC sender')
  })

  it('drops unauthorized events without throwing', () => {
    const { authorized, events } = setup()
    const listener = vi.fn()
    authorized.on('demo:write', listener)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    events.get('demo:write')?.(fakeEvent({ sender: { other: true }, senderFrame: {} }))

    expect(listener).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Ignored unauthorized event'))
    warn.mockRestore()
  })

  it('forwards events from the trusted renderer', () => {
    const { authorized, events, webContents, mainFrame } = setup()
    const listener = vi.fn()
    authorized.on('demo:write', listener)

    events.get('demo:write')?.(
      fakeEvent({ sender: webContents, senderFrame: mainFrame }),
      'payload'
    )

    expect(listener).toHaveBeenCalledWith(expect.anything(), 'payload')
  })

  it('guards the once-registrations too', () => {
    const { authorized, handlers, events, handleOnce, once, webContents, mainFrame } = setup()
    const handler = vi.fn()
    const listener = vi.fn()
    authorized.handleOnce('demo:once', handler)
    authorized.once('demo:event', listener)

    expect(handleOnce).toHaveBeenCalledTimes(1)
    expect(once).toHaveBeenCalledTimes(1)
    expect(() => handlers.get('demo:once')?.(fakeEvent({}))).toThrow('Unauthorized IPC sender')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    events.get('demo:event')?.(fakeEvent({}))
    expect(listener).not.toHaveBeenCalled()
    warn.mockRestore()

    expect(
      handlers.get('demo:once')?.(fakeEvent({ sender: webContents, senderFrame: mainFrame }))
    ).toBeUndefined()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('forwards other ipcMain methods to the real instance', () => {
    const { authorized, removeHandler } = setup()
    authorized.removeHandler('demo:read')
    expect(removeHandler).toHaveBeenCalledWith('demo:read')
  })
})
