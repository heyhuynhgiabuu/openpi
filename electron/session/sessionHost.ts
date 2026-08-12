import type { BrowserWindow } from 'electron'
import { IPC, type OutputLine, type SessionReady } from '../../src/lib/ipc'
import { removeWorktree } from '../git/worktree'
import type { SidecarMessage } from '../pi/sidecar'
import { PiSidecarHost } from '../pi/sidecarHost'
import { emitSessionError } from '../services/notificationHost'
import type { SessionIndexStore } from './sessionIndex'
import { threadCwdRegistry } from './threadCwd'
// ─── Types ─────────────────────────────────────────────────────────────────────

export type SessionState = {
  cwd: string
  sessionFile: string | null
  sessionId: string | null
}

export type StartSessionOptions = {
  sessionFile?: string
  /** Entry ID to fork from. When set, opens the session positioned at this entry. */
  forkEntryId?: string
  /** Git worktree path (when session is in worktree mode). */
  worktreePath?: string
  /** Original repository root (when worktreePath is set, root is the repo, not worktree). */
  rootCwd?: string
}

// ─── Module state ──────────────────────────────────────────────────────────────

let _state: SessionState | null = null
let _deferredWorkspace: string | null = null
let _refreshInFlight: Promise<void> | null = null
let _piSidecarHost: PiSidecarHost | null = null
let _replacementGeneration = 0

// ─── External references (set by main.ts) ──────────────────────────────────────

let _mainWindow: BrowserWindow | null = null
let _sessionIndex: SessionIndexStore | null = null

export function setSessionHostMainWindow(win: BrowserWindow | null): void {
  _mainWindow = win
}

export function setSessionHostSessionIndex(si: SessionIndexStore | null): void {
  _sessionIndex = si
}

function sendToMainWindow(channel: string, ...args: unknown[]): void {
  if (!_mainWindow || _mainWindow.isDestroyed()) return
  _mainWindow.webContents.send(channel, ...args)
}

// ─── Callbacks (bridge to main.ts lazy imports) ────────────────────────────────

let _onOutputLine: ((line: OutputLine) => void) | null = null
let _onRestartGitMonitoring: ((cwd: string) => void) | null = null
let _onStopGitMonitoring: (() => void) | null = null
let _onMaybeCheckPiUpdate: (() => void) | null = null
let _onSidecarMessage: ((msg: SidecarMessage) => void) | null = null

export function setOnOutputLine(fn: (line: OutputLine) => void): void {
  _onOutputLine = fn
}

export function setOnRestartGitMonitoring(fn: (cwd: string) => void): void {
  _onRestartGitMonitoring = fn
}

export function setOnStopGitMonitoring(fn: () => void): void {
  _onStopGitMonitoring = fn
}

export function setOnMaybeCheckPiUpdate(fn: () => void): void {
  _onMaybeCheckPiUpdate = fn
}

export function setOnSidecarMessage(fn: (msg: SidecarMessage) => void): void {
  _onSidecarMessage = fn
}

// ─── Getters for main.ts ───────────────────────────────────────────────────────

export function getSessionState(): SessionState | null {
  return _state
}

export function getDeferredWorkspace(): string | null {
  return _deferredWorkspace
}

export function getPiSidecarHost(): PiSidecarHost | null {
  return _piSidecarHost
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

export function createRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

// ─── Pi sidecar lifecycle ──────────────────────────────────────────────────────

export function requirePiSidecar(): PiSidecarHost {
  return ensurePiSidecarStarted()
}

export function ensurePiSidecarStarted(): PiSidecarHost {
  if (!_piSidecarHost) {
    _piSidecarHost = new PiSidecarHost({
      onMessage: (msg) => _onSidecarMessage?.(msg),
      onCrash: () => emitSessionError('Pi sidecar crashed repeatedly.', 'pi_sidecar_crashed'),
    })
    _piSidecarHost.start()
  }
  return _piSidecarHost
}

// ─── State mutation helpers (called from main.ts handleSidecarMessage) ─────────

export function applySessionValues(ready: SessionReady): void {
  _state = {
    cwd: ready.cwd,
    sessionFile: ready.sessionFile,
    sessionId: ready.sessionId,
  }
  _deferredWorkspace = null
  if (ready.sessionId) {
    threadCwdRegistry.register(ready.sessionId, { root: ready.cwd })
    threadCwdRegistry.setActive(ready.sessionId)
  }
  sendToMainWindow(IPC.SESSION_READY, ready)
  _onRestartGitMonitoring?.(ready.cwd)
}

export function suspendSessionValues(): void {
  if (_state?.sessionId) threadCwdRegistry.unregister(_state.sessionId)
  _state = null
  _deferredWorkspace = null
  threadCwdRegistry.clearActive()
  _onStopGitMonitoring?.()
}

export function restoreSessionValues(state: SessionState): void {
  _state = state
  if (state.sessionId) {
    threadCwdRegistry.register(state.sessionId, { root: state.cwd })
    threadCwdRegistry.setActive(state.sessionId)
  }
  _onRestartGitMonitoring?.(state.cwd)
}

export function clearSessionState(): void {
  if (_state?.sessionId) {
    const cwd = threadCwdRegistry.get(_state.sessionId)
    if (cwd?.worktreePath) {
      // Fire-and-forget worktree cleanup.
      removeWorktree(cwd.root, cwd.worktreePath).catch(() => {
        /* cleanup best-effort */
      })
    }
    threadCwdRegistry.unregister(_state.sessionId)
  }
  _state = null
  _deferredWorkspace = null
  threadCwdRegistry.clearActive()
}

export function applySessionReady(ready: SessionReady, _cwd: string): void {
  applySessionValues(ready)
}

export function resolveActiveCwd(): string {
  return _state?.cwd ?? _deferredWorkspace ?? ''
}

// ─── Session lifecycle ─────────────────────────────────────────────────────────

export function normalizeSessionReady(payload: SessionReady): SessionReady {
  return {
    ...payload,
    sessionName: payload.sessionFile
      ? (_sessionIndex?.getSessionTitle(payload.sessionFile) ?? payload.sessionName ?? null)
      : (payload.sessionName ?? null),
  }
}

export async function startSession(cwd: string, options: StartSessionOptions = {}): Promise<void> {
  const generation = ++_replacementGeneration
  const previous = _state
  _deferredWorkspace = null
  const workspacePath = _sessionIndex?.upsertWorkspace(cwd) ?? cwd

  suspendSessionValues()

  const requestId = createRequestId()
  let response: Extract<SidecarMessage, { type: 'session_ready' }>
  try {
    response = await ensurePiSidecarStarted().request<
      Extract<SidecarMessage, { type: 'session_ready' }>
    >({
      type: 'start_session',
      requestId,
      cwd: workspacePath,
      workspaceTrusted: _sessionIndex?.isWorkspaceTrusted(workspacePath) ?? false,
      sessionFile: options.sessionFile,
      forkEntryId: options.forkEntryId,
    })
  } catch (error) {
    if (generation === _replacementGeneration && previous) restoreSessionValues(previous)
    throw error
  }

  if (generation !== _replacementGeneration) return
  const ready = normalizeSessionReady(response.payload as SessionReady)
  applySessionValues(ready)

  // Worktree mode: correct registry entry to reflect root repo + worktree path.
  if (options.worktreePath && options.rootCwd && ready.sessionId) {
    threadCwdRegistry.update(ready.sessionId, {
      root: options.rootCwd,
      worktreePath: options.worktreePath,
    })
  }

  _onMaybeCheckPiUpdate?.()
  try {
    await refreshSessionIndex()
  } catch (error) {
    if (generation === _replacementGeneration && previous) restoreSessionValues(previous)
    throw error
  }
}

export async function ensureActiveSession(): Promise<SessionState | null> {
  if (_state) return _state
  if (!_deferredWorkspace) return null
  await startSession(_deferredWorkspace)
  return _state
}

export function activeWorkspacePath(): string | null {
  return _state?.cwd ?? _deferredWorkspace ?? null
}

export function showDeferredWorkspace(cwd: string): void {
  const workspacePath = _sessionIndex?.upsertWorkspace(cwd) ?? cwd
  _deferredWorkspace = workspacePath
  const ready: SessionReady = {
    cwd: workspacePath,
    sessionFile: null,
    sessionId: null,
    sessionName: null,
    model: null,
    thinkingLevel: null,
  }
  sendToMainWindow(IPC.SESSION_READY, ready)
  void refreshSessionIndex()
  _onMaybeCheckPiUpdate?.()
}

export async function refreshSessionIndex(): Promise<void> {
  if (!_sessionIndex) return
  if (_refreshInFlight) return _refreshInFlight

  _refreshInFlight = (async () => {
    try {
      const workspacePath = activeWorkspacePath()
      if (!workspacePath) {
        sendToMainWindow(IPC.SESSION_INDEX_UPDATED)
        return
      }
      await _sessionIndex?.refreshSessions(_state?.sessionFile ?? null, workspacePath)
      sendToMainWindow(IPC.SESSION_INDEX_UPDATED)
    } catch (err) {
      emitSessionError(
        err instanceof Error ? err.message : String(err),
        'session_index_refresh_failed'
      )
    } finally {
      _refreshInFlight = null
    }
  })()

  return _refreshInFlight
}

// ─── Registration in registerHandlers ──────────────────────────────────────────
// This is called from main.ts and returns an object of handlers rather than
// having main.ts import each one individually.
//
// For now main.ts continues using the individual function exports above.
// If this module grows further, consider switching to a handler-bundle pattern.
