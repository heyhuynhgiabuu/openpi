import { afterEach, describe, expect, it, vi } from 'vitest'

const { browserWindowMock, fakeWindow, navigationHandlers, popupHandler } = vi.hoisted(() => {
  const navigationHandlers = new Map<
    string,
    (event: { preventDefault: () => void }, url: string) => void
  >()
  const popupHandler: { current?: (details: { url: string }) => { action: string } } = {}
  const webContents = {
    on: vi.fn(
      (event: string, handler: (event: { preventDefault: () => void }, url: string) => void) => {
        navigationHandlers.set(event, handler)
      }
    ),
    once: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: string }) => {
      popupHandler.current = handler
    }),
  }
  const fakeWindow = {
    webContents,
    loadURL: vi.fn(),
    loadFile: vi.fn(),
    maximize: vi.fn(),
    setFullScreen: vi.fn(),
    on: vi.fn(),
  }
  return {
    browserWindowMock: vi.fn(() => fakeWindow),
    fakeWindow,
    navigationHandlers,
    popupHandler,
  }
})

vi.mock('electron', () => ({
  BrowserWindow: browserWindowMock,
  Menu: {
    buildFromTemplate: vi.fn(() => ({})),
    setApplicationMenu: vi.fn(),
  },
}))

vi.mock('../electron/services/shellEnv', () => ({ appIconPath: () => '/icon.png' }))
vi.mock('../electron/services/windowState', () => ({
  attachWindowStateSaver: vi.fn(),
  loadWindowState: vi.fn(() => ({ width: 1280, height: 820 })),
}))

import { createMainWindow } from '../electron/services/windowHost'

describe('main window navigation policy', () => {
  const previousRendererUrl = process.env.ELECTRON_RENDERER_URL

  afterEach(() => {
    navigationHandlers.clear()
    popupHandler.current = undefined
    vi.clearAllMocks()
    if (previousRendererUrl === undefined) delete process.env.ELECTRON_RENDERER_URL
    else process.env.ELECTRON_RENDERER_URL = previousRendererUrl
  })

  it('denies popups and navigation away from the configured renderer URL', () => {
    process.env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173/'
    createMainWindow({
      currentDir: '/app/main',
      getPtyHost: vi.fn(),
      getSessionIndex: () => null,
      ensurePiSidecarStarted: vi.fn(),
      showDeferredWorkspace: vi.fn(),
      refreshSessionIndex: vi.fn(),
      onClosed: vi.fn(),
    })

    expect(popupHandler.current?.({ url: 'https://attacker.example' })).toEqual({ action: 'deny' })
    const navigate = navigationHandlers.get('will-navigate')
    if (!navigate) throw new Error('Expected will-navigate handler')
    const externalEvent = { preventDefault: vi.fn() }
    navigate(externalEvent, 'https://attacker.example')
    expect(externalEvent.preventDefault).toHaveBeenCalledOnce()

    const appEvent = { preventDefault: vi.fn() }
    navigate(appEvent, 'http://127.0.0.1:5173/settings')
    expect(appEvent.preventDefault).not.toHaveBeenCalled()
    expect(fakeWindow.loadURL).toHaveBeenCalledWith('http://127.0.0.1:5173/')
  })
})
