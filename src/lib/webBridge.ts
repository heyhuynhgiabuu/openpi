import { IPC } from './ipc/channels'
import { createEventBus } from './webBridgeEvents'

async function invoke(base: string, channel: string, payload?: unknown): Promise<unknown> {
  const res = await fetch(`${base}/api/ipc/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? '{}' : JSON.stringify(payload),
    credentials: 'include',
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const msg = text || `ipc ${channel} failed ${res.status}`
    console.error(`[webBridge] ${channel} -> ${res.status}: ${msg.slice(0, 300)}`)
    throw new Error(msg)
  }
  const t = await res.text()
  return t ? JSON.parse(t) : null
}

export function isWebBridge(): boolean {
  if (typeof window === 'undefined') return false
  const w = window as unknown as { openpi?: unknown; __openpiIsWeb?: boolean }
  return (
    Boolean(w.__openpiIsWeb) ||
    Boolean((w.openpi as unknown as Record<string, unknown>)?.__isWebBridge)
  )
}

function showWorkspacePickerModal(
  workspaces: Array<{ path: string; displayName?: string }>,
  _base: string
): Promise<string | null> {
  return new Promise((resolve) => {
    const existing = document.getElementById('openpi-workspace-picker')
    if (existing) existing.remove()
    const overlay = document.createElement('div')
    overlay.id = 'openpi-workspace-picker'
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);backdrop-filter:blur(2px)'
    const card = document.createElement('div')
    card.style.cssText =
      'min-width:420px;max-width:560px;width:90%;max-height:80vh;overflow:auto;background:var(--bg-surface, #1e1e2e);border:1px solid var(--border, #333);border-radius:12px;padding:20px;box-shadow:0 20px 60px rgba(0,0,0,0.4);color:var(--text, #eee);font-family:inherit'
    const title = document.createElement('h2')
    title.textContent = 'Open workspace'
    title.style.cssText = 'margin:0 0 8px;font-size:16px;font-weight:600'
    const hint = document.createElement('p')
    hint.textContent = workspaces.length
      ? 'Select a known project or enter an absolute path on the host.'
      : 'Enter an absolute path on the host (e.g. /home/andrea/Projects/openpi).'
    hint.style.cssText = 'margin:0 0 12px;font-size:13px;opacity:0.8'
    const list = document.createElement('div')
    list.style.cssText =
      'display:flex;flex-direction:column;gap:6px;margin-bottom:12px;max-height:180px;overflow:auto'
    let selectedPath: string | null = null
    const input = document.createElement('input')
    input.type = 'text'
    input.placeholder = '/home/andrea/Projects/openpi'
    input.autocomplete = 'off'
    input.spellcheck = false
    input.style.cssText =
      'width:100%;padding:8px 10px;border:1px solid var(--border, #444);border-radius:8px;background:var(--bg-input, #111);color:inherit;font-size:13px;outline:none;margin-bottom:8px'
    const errorEl = document.createElement('div')
    errorEl.style.cssText = 'min-height:16px;font-size:12px;color:#f87171;margin-bottom:8px'
    const setError = (msg: string) => {
      errorEl.textContent = msg
    }
    if (workspaces.length) {
      for (const ws of workspaces) {
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = `${ws.displayName || ws.path} — ${ws.path}`
        btn.style.cssText =
          'text-align:left;padding:8px 10px;border:1px solid var(--border, #333);border-radius:8px;background:var(--bg-hover, #2a2a3a);color:inherit;cursor:pointer;font-size:13px'
        btn.onclick = () => {
          selectedPath = ws.path
          input.value = ws.path
          setError('')
          for (const c of list.children)
            (c as HTMLElement).style.borderColor = 'var(--border, #333)'
          btn.style.borderColor = 'var(--accent, #7aa2f7)'
        }
        list.appendChild(btn)
      }
    }
    const actions = document.createElement('div')
    actions.style.cssText = 'display:flex;gap:8px;justify-content:flex-end'
    const cancelBtn = document.createElement('button')
    cancelBtn.type = 'button'
    cancelBtn.textContent = 'Cancel'
    cancelBtn.style.cssText =
      'padding:8px 14px;border:1px solid var(--border, #333);border-radius:8px;background:transparent;color:inherit;cursor:pointer;font-size:13px'
    const openBtn = document.createElement('button')
    openBtn.type = 'button'
    openBtn.textContent = 'Open'
    openBtn.style.cssText =
      'padding:8px 14px;border:none;border-radius:8px;background:var(--accent, #7aa2f7);color:#000;cursor:pointer;font-weight:600;font-size:13px'
    const cleanup = () => overlay.remove()
    cancelBtn.onclick = () => {
      cleanup()
      resolve(null)
    }
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        cleanup()
        resolve(null)
      }
    }
    const doOpen = () => {
      const raw = (selectedPath || input.value || '').trim()
      if (!raw) {
        setError('Enter a path or select a project.')
        return
      }
      if (!raw.startsWith('/')) {
        setError('Path must be absolute (start with /).')
        return
      }
      cleanup()
      resolve(raw)
    }
    openBtn.onclick = doOpen
    input.onkeydown = (e) => {
      if (e.key === 'Enter') doOpen()
      if (e.key === 'Escape') {
        cleanup()
        resolve(null)
      }
    }
    actions.append(cancelBtn, openBtn)
    card.append(title, hint)
    if (workspaces.length) card.append(list)
    card.append(input, errorEl, actions)
    overlay.appendChild(card)
    document.body.appendChild(overlay)
    setTimeout(() => input.focus(), 30)
  })
}

export function createWebBridge(baseUrl = window.location.origin): unknown {
  const base = baseUrl.replace(/\/$/, '')
  const inv = (ch: string) => (payload?: unknown) => invoke(base, ch, payload)
  const snd =
    (ch: string) =>
    (payload?: unknown): void => {
      void invoke(base, ch, payload).catch(() => undefined)
    }
  const bus = createEventBus(base)
  const on =
    (ch: string) =>
    (cb: (p: unknown) => void): (() => void) =>
      bus.on(ch, cb)

  const bridge = {
    __isWebBridge: true as const,
    getAppInfo: () => inv(IPC.GET_APP_INFO)() as Promise<unknown>,
    pickWorkspace: async (payload?: unknown) => {
      const maybePath =
        payload &&
        typeof payload === 'object' &&
        payload !== null &&
        'path' in (payload as Record<string, unknown>)
          ? String((payload as Record<string, unknown>).path ?? '').trim()
          : ''
      if (maybePath) {
        return invoke(base, IPC.PICK_WORKSPACE, { path: maybePath })
      }
      if (payload && typeof payload === 'string' && payload.trim()) {
        return invoke(base, IPC.PICK_WORKSPACE, { path: payload.trim() })
      }
      let wss: Array<{ path: string; displayName?: string }> = []
      try {
        const raw = (await invoke(base, IPC.GET_WORKSPACES)) as Array<{
          path: string
          displayName?: string
        }>
        if (Array.isArray(raw)) wss = raw
      } catch {
        // ignore
      }
      const picked = await showWorkspacePickerModal(wss, base)
      if (!picked) return { cancelled: true }
      try {
        const result = await invoke(base, IPC.PICK_WORKSPACE, { path: picked })
        return result
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        const retry = await new Promise<string | null>((res) => {
          const el = document.createElement('div')
          el.style.cssText =
            'position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.5)'
          el.innerHTML = `<div style="background:#1e1e2e;border:1px solid #333;border-radius:10px;padding:18px;max-width:480px;color:#eee;font-size:13px"><div style="font-weight:600;margin-bottom:8px">Failed to open workspace</div><div style="opacity:0.85;word-break:break-all;margin-bottom:12px">${msg.replace(/</g, '&lt;')}</div><div style="display:flex;gap:8px;justify-content:flex-end"><button id="op-retry" style="padding:6px 12px;border:1px solid #444;border-radius:6px;background:#2a2a3a;color:#eee;cursor:pointer">Retry</button><button id="op-cancel" style="padding:6px 12px;border:none;border-radius:6px;background:#7aa2f7;cursor:pointer">Close</button></div></div>`
          document.body.appendChild(el)
          el.querySelector('#op-cancel')?.addEventListener('click', () => {
            el.remove()
            res(null)
          })
          el.querySelector('#op-retry')?.addEventListener('click', () => {
            el.remove()
            res(picked)
          })
          el.addEventListener('click', (e) => {
            if (e.target === el) {
              el.remove()
              res(null)
            }
          })
        })
        if (retry) return invoke(base, IPC.PICK_WORKSPACE, { path: retry })
        return { cancelled: true, error: msg }
      }
    },
    prompt: (text: string, contextPrefix?: string) =>
      inv(IPC.SESSION_PROMPT)({ text, contextPrefix }) as Promise<void>,
    steer: (text: string, contextPrefix?: string) =>
      inv(IPC.SESSION_STEER)({ text, contextPrefix }) as Promise<void>,
    followUp: (text: string, contextPrefix?: string) =>
      inv(IPC.SESSION_FOLLOW_UP)({ text, contextPrefix }) as Promise<void>,
    bash: (command: string, excludeFromContext = false) =>
      inv(IPC.SESSION_BASH)({ command, excludeFromContext }) as Promise<unknown>,
    abort: () => inv(IPC.SESSION_ABORT)() as Promise<void>,
    getModels: () => inv(IPC.GET_MODELS)() as Promise<unknown>,
    setModel: (p: unknown) => inv(IPC.SET_MODEL)(p) as Promise<void>,
    setThinking: (level: string) => inv(IPC.SET_THINKING)({ level }) as Promise<void>,
    getSessionStats: () => inv(IPC.GET_SESSION_STATS)() as Promise<unknown>,
    getUsageSummary: (req?: unknown) => inv(IPC.GET_USAGE_SUMMARY)(req) as Promise<unknown>,
    getWorkspaces: () => inv(IPC.GET_WORKSPACES)() as Promise<unknown>,
    getSessions: (opts?: unknown) => inv(IPC.GET_SESSIONS)(opts) as Promise<unknown>,
    getSessionMessages: (pathArg: string, opts?: { limit?: number; beforeEntryId?: string }) =>
      inv(IPC.GET_SESSION_MESSAGES)({ path: pathArg, ...opts }) as Promise<unknown>,
    getSessionTree: (pathArg: string) =>
      inv(IPC.GET_SESSION_TREE)({ path: pathArg }) as Promise<unknown>,
    openSession: (p: unknown) => inv(IPC.OPEN_SESSION)(p) as Promise<void>,
    resolveSubSessionPath: (p: unknown) => inv(IPC.RESOLVE_SUB_SESSION_PATH)(p) as Promise<unknown>,
    resolveMostRecentSubSessionPath: (p: unknown) =>
      inv(IPC.RESOLVE_MOST_RECENT_SUB_SESSION_PATH)(p) as Promise<unknown>,
    readTaskSessionHistory: (p: unknown) =>
      inv(IPC.READ_TASK_SESSION_HISTORY)(p) as Promise<unknown>,
    newSession: (cwd?: string, mode?: string, baseBranch?: string) =>
      inv(IPC.NEW_SESSION)({ cwd, mode, baseBranch }) as Promise<void>,
    getWorkspaceSummary: (cwd: string) =>
      inv(IPC.GET_WORKSPACE_SUMMARY)({ cwd }) as Promise<unknown>,
    setWorkspaceTrust: (cwd: string, trusted: boolean) =>
      inv(IPC.SET_WORKSPACE_TRUST)({ cwd, trusted }) as Promise<unknown>,
    checkPathProtection: (targetPath: string, workspacePath?: string | null) =>
      inv(IPC.CHECK_PATH_PROTECTION)({ path: targetPath, workspacePath }) as Promise<unknown>,
    getDiagnosticsBundle: () => inv(IPC.GET_DIAGNOSTICS_BUNDLE)() as Promise<unknown>,
    getCustomizations: () => inv(IPC.GET_CUSTOMIZATIONS)() as Promise<unknown>,
    setExtensionEnabled: (id: string, enabled: boolean) =>
      inv(IPC.SET_EXTENSION_ENABLED)({ id, enabled }) as Promise<void>,
    getFirstRun: () => inv(IPC.GET_FIRST_RUN)() as Promise<unknown>,
    installPackage: (p: unknown) => inv(IPC.INSTALL_PACKAGE)(p) as Promise<unknown>,
    removePackage: (p: unknown) => inv(IPC.REMOVE_PACKAGE)(p) as Promise<unknown>,
    setSessionName: (name: string) => inv(IPC.SET_SESSION_NAME)({ name }) as Promise<void>,
    forkSession: (entryId: string) => inv(IPC.FORK_SESSION)({ entryId }) as Promise<void>,
    compactSession: (p: unknown = {}) => inv(IPC.COMPACT_SESSION)(p) as Promise<void>,
    reloadSession: () => inv(IPC.RELOAD_SESSION)() as Promise<void>,
    getSessionInfo: () => inv(IPC.GET_SESSION_INFO)() as Promise<unknown>,
    copyLastAssistantText: () => inv(IPC.COPY_LAST_ASSISTANT_TEXT)() as Promise<unknown>,
    pty: {
      create: (cwd: string, cols: number, rows: number) =>
        inv(IPC.PTY_CREATE)({ cwd, cols, rows }) as Promise<string>,
      write: (id: string, data: string) => snd(IPC.PTY_WRITE)({ id, data }),
      resize: (id: string, cols: number, rows: number) => snd(IPC.PTY_RESIZE)({ id, cols, rows }),
      close: (id: string) => snd(IPC.PTY_CLOSE)({ id }),
      onData: on(IPC.PTY_DATA),
      onExit: on(IPC.PTY_EXIT),
    },
    onOutputAppend: on(IPC.OUTPUT_APPEND),
    getOutputBuffer: () => inv(IPC.GET_OUTPUT_BUFFER)() as Promise<unknown>,
    getPref: (key: string) => inv(IPC.GET_PREF)({ key }) as Promise<unknown>,
    setPref: (key: string, value: string) => inv(IPC.SET_PREF)({ key, value }) as Promise<void>,
    playSoundEffect: (sound: string) => inv(IPC.PLAY_SOUND_EFFECT)({ sound }) as Promise<void>,
    checkPiUpdate: () => inv(IPC.CHECK_PI_UPDATE)() as Promise<unknown>,
    installPiUpdate: (latestVersion: string) =>
      inv(IPC.INSTALL_PI_UPDATE)({ latestVersion }) as Promise<unknown>,
    getDefaultProjectTrust: () => inv(IPC.GET_DEFAULT_PROJECT_TRUST)() as Promise<unknown>,
    setDefaultProjectTrust: (v: string) => inv(IPC.SET_DEFAULT_PROJECT_TRUST)(v) as Promise<void>,
    appUpdate: {
      check: () => inv(IPC.APP_UPDATE_CHECK)() as Promise<unknown>,
      openRelease: (url: string) => inv(IPC.APP_UPDATE_OPEN_RELEASE)({ url }) as Promise<void>,
      install: () => inv(IPC.APP_UPDATE_INSTALL)() as Promise<void>,
      onStatus: on(IPC.APP_UPDATE_STATUS),
    },
    workbenchContext: {
      update: (p: unknown) => snd(IPC.WORKBENCH_CONTEXT_UPDATE)(p),
      get: () => inv(IPC.WORKBENCH_CONTEXT_GET)() as Promise<unknown>,
      onChange: on('openpi:workbench-context-changed'),
    },
    getChangelog: () => inv(IPC.GET_CHANGELOG)() as Promise<unknown>,
    getGitBranch: (cwd: string) => inv(IPC.GET_GIT_BRANCH)({ cwd }) as Promise<unknown>,
    notifyGitPanelMounted: () => snd(IPC.GIT_PANEL_MOUNTED)({}),
    git: {
      getStatus: (cwd?: string) => inv(IPC.GIT_STATUS)(cwd) as Promise<unknown>,
      getDiff: (filePath: string, cwd?: string, options?: unknown) =>
        inv(IPC.GIT_DIFF)({ path: filePath, cwd, ...(options as object) }) as Promise<unknown>,
      stage: (filePath: string) => inv(IPC.GIT_STAGE)({ path: filePath }) as Promise<void>,
      unstage: (filePath: string) => inv(IPC.GIT_UNSTAGE)({ path: filePath }) as Promise<void>,
      commit: (paths: string[], message: string, push = false, options: unknown = {}) =>
        inv(IPC.GIT_COMMIT)({ paths, message, push, ...(options as object) }) as Promise<void>,
      discard: (filePath: string) => inv(IPC.GIT_DISCARD)({ path: filePath }) as Promise<void>,
      sync: (action: unknown) => inv(IPC.GIT_SYNC)({ action }) as Promise<unknown>,
      getRefs: () => inv(IPC.GIT_REFS)() as Promise<unknown>,
      getHistory: (query = '', limit = 100) =>
        inv(IPC.GIT_HISTORY)({ query, limit }) as Promise<unknown>,
      getCommitDiff: (hash: string, pathArg?: string, cwd?: string) =>
        inv(IPC.GIT_COMMIT_DIFF)(
          cwd ? { hash, path: pathArg, cwd } : { hash, path: pathArg }
        ) as Promise<unknown>,
      checkoutBranch: (branch: string) =>
        inv(IPC.GIT_CHECKOUT_BRANCH)({ branch }) as Promise<unknown>,
      createBranch: (name: string) => inv(IPC.GIT_CREATE_BRANCH)({ name }) as Promise<unknown>,
      stashApply: (index: number) => inv(IPC.GIT_STASH_APPLY)({ index }) as Promise<unknown>,
      stashPop: (index: number) => inv(IPC.GIT_STASH_POP)({ index }) as Promise<unknown>,
      stashDrop: (index: number) => inv(IPC.GIT_STASH_DROP)({ index }) as Promise<unknown>,
      onStatusChanged: on(IPC.GIT_STATUS_CHANGED),
      onFileTreeChanged: on(IPC.FILE_TREE_CHANGED),
      getFileTree: (cwd: string) => inv(IPC.GIT_FILE_TREE)(cwd) as Promise<unknown>,
      generateCommitMessage: () => inv(IPC.GIT_GENERATE_COMMIT_MSG)() as Promise<unknown>,
      onAgentChangedFiles: on(IPC.AGENT_CHANGED_FILES),
      getGitStagedDiff: (cwd?: string) =>
        inv(IPC.GIT_STAGED_DIFF)(cwd ? { cwd } : {}) as Promise<unknown>,
      getGitBranchDiff: (baseBranch?: string, cwd?: string) =>
        inv(IPC.GIT_BRANCH_DIFF)({ baseBranch, cwd }) as Promise<unknown>,
      getGitBranchBase: (cwd?: string) =>
        inv(IPC.GIT_BRANCH_BASE)(cwd ? { cwd } : {}) as Promise<unknown>,
      stageHunk: (p: unknown) => inv(IPC.GIT_STAGE_HUNK)(p) as Promise<unknown>,
      unstageHunk: (p: unknown) => inv(IPC.GIT_UNSTAGE_HUNK)(p) as Promise<unknown>,
      revertHunk: (p: unknown) => inv(IPC.GIT_REVERT_HUNK)(p) as Promise<unknown>,
    },
    agentReview: {
      list: () => inv(IPC.AGENT_REVIEW_LIST)() as Promise<unknown>,
      keep: (id: string) => inv(IPC.AGENT_REVIEW_KEEP)({ id }) as Promise<unknown>,
      revert: (id: string) => inv(IPC.AGENT_REVIEW_REVERT)({ id }) as Promise<unknown>,
      revertAll: () => inv(IPC.AGENT_REVIEW_REVERT_ALL)() as Promise<unknown>,
      clear: () => inv(IPC.AGENT_REVIEW_CLEAR)() as Promise<unknown>,
      onChanged: on(IPC.AGENT_REVIEW_CHANGED),
    },
    searchFileContents: (
      query: string,
      matchCase: boolean,
      wholeWord: boolean,
      useRegex: boolean
    ) =>
      inv(IPC.SEARCH_FILE_CONTENTS)({ query, matchCase, wholeWord, useRegex }) as Promise<unknown>,
    readFile: (relPath: string, cwd?: string) =>
      inv(IPC.READ_FILE)(cwd ? { path: relPath, cwd } : { path: relPath }) as Promise<unknown>,
    writeFile: (relPath: string, content: string, cwd?: string) =>
      inv(IPC.WRITE_FILE)(
        cwd ? { path: relPath, content, cwd } : { path: relPath, content }
      ) as Promise<void>,
    deleteFile: (relPath: string, cwd?: string) =>
      inv(IPC.DELETE_FILE)(cwd ? { path: relPath, cwd } : { path: relPath }) as Promise<unknown>,
    renameFile: (relPath: string, newName: string, cwd?: string) =>
      inv(IPC.RENAME_FILE)(
        cwd ? { path: relPath, newName, cwd } : { path: relPath, newName }
      ) as Promise<unknown>,
    copyFile: (relPath: string, target?: string, cwd?: string) =>
      inv(IPC.COPY_FILE)(
        cwd ? { path: relPath, target, cwd } : { path: relPath, target }
      ) as Promise<unknown>,
    formatFile: (relPath: string, cwd?: string) =>
      inv(IPC.FORMAT_FILE)(cwd ? { path: relPath, cwd } : { path: relPath }) as Promise<unknown>,
    getGitRemoteUrl: () => inv(IPC.GIT_REMOTE_URL)() as Promise<unknown>,
    fff: {
      fileSearch: (query: string, pageSize: number | undefined, cwd: string) =>
        inv(IPC.FFF_FILE_SEARCH)({ query, pageSize, cwd }) as Promise<unknown>,
      grep: (query: string, opts?: unknown) =>
        inv(IPC.FFF_GREP)({ query, ...(opts as object) }) as Promise<unknown>,
    },
    listPromptTemplates: () => inv(IPC.LIST_PROMPT_TEMPLATES)() as Promise<unknown>,
    listSlashCommands: () => inv(IPC.LIST_SLASH_COMMANDS)() as Promise<unknown>,
    getSettings: () => inv(IPC.GET_SETTINGS)() as Promise<unknown>,
    saveSettings: (scope: string, settings: unknown) =>
      inv(IPC.SAVE_SETTINGS)({ scope, settings }) as Promise<void>,
    openExternal: (url: string) => inv(IPC.OPEN_EXTERNAL)(url) as Promise<void>,
    readThemeColors: (absPath: string) => inv(IPC.READ_THEME_COLORS)(absPath) as Promise<unknown>,
    readThemeTokens: (absPath: string) => inv(IPC.READ_THEME_TOKENS)(absPath) as Promise<unknown>,
    archiveSessions: (paths: string[]) => inv(IPC.ARCHIVE_SESSIONS)({ paths }) as Promise<unknown>,
    listArchivedSessions: () => inv(IPC.LIST_ARCHIVED_SESSIONS)() as Promise<unknown>,
    unarchiveSessions: (paths: string[]) =>
      inv(IPC.UNARCHIVE_SESSIONS)({ paths }) as Promise<unknown>,
    deleteSessions: (paths: string[]) => inv(IPC.DELETE_SESSIONS)({ paths }) as Promise<unknown>,
    deleteSession: (filePath: string) =>
      inv(IPC.DELETE_SESSION)({ path: filePath }) as Promise<unknown>,
    listSkills: () => inv(IPC.LIST_SKILLS)() as Promise<unknown>,
    readSkillFile: (filePath: string) =>
      inv(IPC.READ_SKILL_FILE)({ path: filePath }) as Promise<unknown>,
    listDirectory: (relPath: string) =>
      inv(IPC.LIST_DIRECTORY)({ path: relPath }) as Promise<unknown>,
    getProviders: () => inv(IPC.GET_PROVIDERS)() as Promise<unknown>,
    setProviderKey: (provider: string, apiKey: string) =>
      inv(IPC.SET_PROVIDER_KEY)({ provider, apiKey }) as Promise<void>,
    removeProviderKey: (provider: string) =>
      inv(IPC.REMOVE_PROVIDER_KEY)({ provider }) as Promise<void>,
    loginProvider: (providerId: string) => inv(IPC.LOGIN_PROVIDER)({ providerId }) as Promise<void>,
    logoutProvider: (providerId: string) =>
      inv(IPC.LOGOUT_PROVIDER)({ providerId }) as Promise<void>,
    resolveProviderPrompt: (providerId: string, value: string) =>
      inv(IPC.RESOLVE_PROVIDER_PROMPT)({ providerId, value }) as Promise<void>,
    onProviderLoginEvent: on(IPC.PROVIDER_LOGIN_EVENT),
    getCustomProviders: () => inv(IPC.GET_CUSTOM_PROVIDERS)() as Promise<unknown>,
    addCustomProvider: (p: unknown) => inv(IPC.ADD_CUSTOM_PROVIDER)(p) as Promise<void>,
    removeCustomProvider: (id: string) => inv(IPC.REMOVE_CUSTOM_PROVIDER)({ id }) as Promise<void>,
    getStatus: () => inv(IPC.TUNNEL_GET_STATUS)() as Promise<unknown>,
    getUrl: () => inv(IPC.TUNNEL_GET_URL)() as Promise<unknown>,
    enable: (token: string, persistent = false, reservedName?: string) =>
      inv(IPC.TUNNEL_ENABLE)({ token, persistent, reservedName }) as Promise<unknown>,
    disable: () => inv(IPC.TUNNEL_DISABLE)() as Promise<void>,
    generateQr: (url: string) => inv(IPC.TUNNEL_GENERATE_QR)(url) as Promise<string>,
    sendPrompt: (text: string) => inv(IPC.SEND_PROMPT)({ text }) as Promise<void>,
    onSessionReady: on(IPC.SESSION_READY),
    onSessionEvent: on(IPC.SESSION_EVENT),
    onSessionError: on(IPC.SESSION_ERROR),
    onSessionIndexUpdated: on(IPC.SESSION_INDEX_UPDATED),
    onRemoteSessionStatus: on(IPC.REMOTE_SESSION_STATUS),
    onRemoteSessionUpdate: on(IPC.REMOTE_SESSION_UPDATE),
    onArtifactUpdate: on(IPC.ARTIFACT_UPDATE),
    onFileFindShortcut: on(IPC.FILE_FIND_SHORTCUT),
    onExtensionUiRequest: on(IPC.EXTENSION_UI_REQUEST),
    resolveExtensionUi: (response: unknown) =>
      inv(IPC.RESOLVE_EXTENSION_UI)(response) as Promise<void>,
  }
  return bridge as unknown
}

export function ensureWebBridge(): void {
  if (typeof window === 'undefined') return
  const w = window as unknown as { openpi?: unknown; __openpiIsWeb?: boolean }
  if (w.openpi) {
    // If native preload already injected, do not overwrite; but mark web flag if our bridge is not present
    return
  }
  w.__openpiIsWeb = true
  w.openpi = createWebBridge(window.location.origin) as unknown as typeof window.openpi
}
