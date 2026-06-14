/**
 * windowState — persist and restore Electron BrowserWindow bounds.
 *
 * Stores the last-known window position and size to
 * `app.getPath('userData')/window-state.json`. On startup, the main
 * process reads the file (if present) and applies the saved bounds
 * to the new window. On resize/move, the state is written
 * asynchronously (debounced 500ms) to avoid hammering disk.
 *
 * The state is intentionally limited to what the user controls
 * directly (position, size, fullscreen, maximized). Display
 * changes (monitor unplug, resolution change) are handled by
 * clamping to the available displays on restore.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app, type BrowserWindow, screen } from 'electron'

interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  isMaximized?: boolean
  isFullScreen?: boolean
}

const DEFAULTS: WindowState = {
  width: 1280,
  height: 820,
}

const DEBOUNCE_MS = 500

function statePath(): string {
  return path.join(app.getPath('userData'), 'window-state.json')
}

function clampToDisplay(state: WindowState): WindowState {
  if (state.x === undefined || state.y === undefined) return state
  const display = screen.getDisplayNearestPoint({ x: state.x, y: state.y })
  const work = display.workArea
  const width = Math.min(state.width, work.width)
  const height = Math.min(state.height, work.height)
  // Keep the title bar inside the work area; otherwise center the window.
  const x =
    state.x + state.width > work.x + work.width
      ? work.x + Math.max(0, (work.width - width) / 2)
      : state.x
  const y = state.y < work.y ? work.y : state.y
  return { ...state, x, y, width, height }
}

export function loadWindowState(): WindowState {
  try {
    const raw = require('node:fs').readFileSync(statePath(), 'utf8') as string
    const parsed = JSON.parse(raw) as Partial<WindowState>
    return clampToDisplay({ ...DEFAULTS, ...parsed })
  } catch {
    return DEFAULTS
  }
}

export function attachWindowStateSaver(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null
  const save = async () => {
    try {
      const isMaximized = win.isMaximized()
      const isFullScreen = win.isFullScreen()
      const bounds = isMaximized || isFullScreen ? win.getNormalBounds() : win.getBounds()
      const state: WindowState = {
        ...bounds,
        isMaximized,
        isFullScreen,
      }
      await fs.writeFile(statePath(), JSON.stringify(state, null, 2), 'utf8')
    } catch (err) {
      console.warn('openpi: failed to save window state:', (err as Error).message)
    }
  }
  const schedule = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(save, DEBOUNCE_MS)
  }
  win.on('resize', schedule)
  win.on('move', schedule)
  win.on('maximize', schedule)
  win.on('unmaximize', schedule)
  win.on('enter-full-screen', schedule)
  win.on('leave-full-screen', schedule)
  win.on('close', () => {
    if (timer) clearTimeout(timer)
    void save()
  })
  // macOS hides unhide on dock click; still useful to persist.
  win.on('show', schedule)
}
