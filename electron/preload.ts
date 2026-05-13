import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppInfo,
  AppUpdateStatus,
  ArchivedSessionItem,
  ArchiveSessionsResult,
  BashExecutionResult,
  CustomizationsInventory,
  CustomProvider,
  CustomProviderInfo,
  FffFileResult,
  FffGrepMatch,
  FileContent,
  FileContentHit,
  FileTreeResult,
  GitBranchInfo,
  GitFileDiff,
  GitStatusResult,
  ModelInfo,
  OpenSession,
  OutputLine,
  PickWorkspaceResult,
  PiSettings,
  PiUpdateCheckResult,
  PiUpdateInstallResult,
  PromptTemplate,
  ProviderInfo,
  ProviderLoginEvent,
  PtyData,
  PtyExit,
  SessionError,
  SessionEvent,
  SessionHistoryPage,
  SessionListItem,
  SessionListOptions,
  SessionReady,
  SessionStats,
  SetModel,
  SettingsResult,
  SkillItem,
  ThemeColors,
  ThemeTokens,
  WorkspaceInfo,
  WorkspaceSummaryInfo,
} from '../src/lib/ipc'
import { IPC } from '../src/lib/ipc'

/**
 * Narrow, typed preload bridge.
 * Renderer accesses ONLY what is explicitly exposed here.
 * No Node built-ins, no raw ipcRenderer, no electron imports in renderer.
 */
const api = {
  // ── App metadata ─────────────────────────────────────────────────────────
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.GET_APP_INFO),

  // ── Workspace ────────────────────────────────────────────────────────────
  pickWorkspace: (): Promise<PickWorkspaceResult> => ipcRenderer.invoke(IPC.PICK_WORKSPACE),

  // ── Session commands ─────────────────────────────────────────────────────
  prompt: (text: string): Promise<void> => ipcRenderer.invoke(IPC.SESSION_PROMPT, { text }),

  steer: (text: string): Promise<void> => ipcRenderer.invoke(IPC.SESSION_STEER, { text }),

  followUp: (text: string): Promise<void> => ipcRenderer.invoke(IPC.SESSION_FOLLOW_UP, { text }),

  bash: (command: string, excludeFromContext = false): Promise<BashExecutionResult> =>
    ipcRenderer.invoke(IPC.SESSION_BASH, { command, excludeFromContext }),

  abort: (): Promise<void> => ipcRenderer.invoke(IPC.SESSION_ABORT),

  // ── Models ───────────────────────────────────────────────────────────────
  getModels: (): Promise<ModelInfo[]> => ipcRenderer.invoke(IPC.GET_MODELS),

  setModel: (payload: SetModel): Promise<void> => ipcRenderer.invoke(IPC.SET_MODEL, payload),

  setThinking: (level: string): Promise<void> => ipcRenderer.invoke(IPC.SET_THINKING, { level }),

  getSessionStats: (): Promise<SessionStats> => ipcRenderer.invoke(IPC.GET_SESSION_STATS),

  // ── Workspace + session index ─────────────────────────────────────────────
  getWorkspaces: (): Promise<WorkspaceInfo[]> => ipcRenderer.invoke(IPC.GET_WORKSPACES),

  getSessions: (options?: SessionListOptions): Promise<SessionListItem[]> =>
    ipcRenderer.invoke(IPC.GET_SESSIONS, options),

  getSessionMessages: (
    path: string,
    options?: { limit?: number; beforeEntryId?: string }
  ): Promise<SessionHistoryPage> =>
    ipcRenderer.invoke(IPC.GET_SESSION_MESSAGES, { path, ...options }),

  openSession: (payload: OpenSession): Promise<void> =>
    ipcRenderer.invoke(IPC.OPEN_SESSION, payload),

  newSession: (cwd?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NEW_SESSION, cwd ? { cwd } : {}),

  getGitBranch: (cwd: string): Promise<GitBranchInfo> =>
    ipcRenderer.invoke(IPC.GET_GIT_BRANCH, { cwd }),

  getWorkspaceSummary: (cwd: string): Promise<WorkspaceSummaryInfo> =>
    ipcRenderer.invoke(IPC.GET_WORKSPACE_SUMMARY, { cwd }),

  // ── Customizations ────────────────────────────────────────────────────────
  getCustomizations: (): Promise<CustomizationsInventory> =>
    ipcRenderer.invoke(IPC.GET_CUSTOMIZATIONS),

  // ── Session name ─────────────────────────────────────────────────────
  setSessionName: (name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_SESSION_NAME, { name }),

  // ── Fork session ──────────────────────────────────────────────────────
  forkSession: (entryId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FORK_SESSION, { entryId }),

  // ── PTY terminal ──────────────────────────────────────────────────────
  pty: {
    create: (cwd: string, cols: number, rows: number): Promise<string> =>
      ipcRenderer.invoke(IPC.PTY_CREATE, { cwd, cols, rows }),
    write: (id: string, data: string): void => ipcRenderer.send(IPC.PTY_WRITE, { id, data }),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.PTY_RESIZE, { id, cols, rows }),
    close: (id: string): void => ipcRenderer.send(IPC.PTY_CLOSE, { id }),
    onData: (cb: (payload: PtyData) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: PtyData) => cb(payload)
      ipcRenderer.on(IPC.PTY_DATA, handler)
      return () => ipcRenderer.removeListener(IPC.PTY_DATA, handler)
    },
    onExit: (cb: (payload: PtyExit) => void) => {
      const handler = (_: Electron.IpcRendererEvent, payload: PtyExit) => cb(payload)
      ipcRenderer.on(IPC.PTY_EXIT, handler)
      return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler)
    },
  },

  // ── Output log event ────────────────────────────────────────────
  onOutputAppend: (cb: (line: OutputLine) => void) => {
    const handler = (_: Electron.IpcRendererEvent, line: OutputLine) => cb(line)
    ipcRenderer.on(IPC.OUTPUT_APPEND, handler)
    return () => ipcRenderer.removeListener(IPC.OUTPUT_APPEND, handler)
  },

  // ── Preferences ────────────────────────────────────────────────────
  getPref: (key: string): Promise<string | null> => ipcRenderer.invoke(IPC.GET_PREF, { key }),
  setPref: (key: string, value: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_PREF, { key, value }),
  playSoundEffect: (sound: string): Promise<void> =>
    ipcRenderer.invoke(IPC.PLAY_SOUND_EFFECT, { sound }),
  checkPiUpdate: (): Promise<PiUpdateCheckResult> => ipcRenderer.invoke(IPC.CHECK_PI_UPDATE),
  installPiUpdate: (): Promise<PiUpdateInstallResult> => ipcRenderer.invoke(IPC.INSTALL_PI_UPDATE),

  // ── App self-update ──────────────────────────────────────────────────────
  appUpdate: {
    check: (): Promise<AppUpdateStatus> => ipcRenderer.invoke(IPC.APP_UPDATE_CHECK),
    openRelease: (url: string): Promise<void> =>
      ipcRenderer.invoke(IPC.APP_UPDATE_OPEN_RELEASE, { url }),
    onStatus: (cb: (status: AppUpdateStatus) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: AppUpdateStatus) => cb(status)
      ipcRenderer.on(IPC.APP_UPDATE_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.APP_UPDATE_STATUS, handler)
    },
  },
  getChangelog: (): Promise<string | null> => ipcRenderer.invoke(IPC.GET_CHANGELOG),

  // ── Git source control ────────────────────────────────────────────────────
  notifyGitPanelMounted: (): void => ipcRenderer.send(IPC.GIT_PANEL_MOUNTED),

  git: {
    getStatus: (): Promise<GitStatusResult | null> => ipcRenderer.invoke(IPC.GIT_STATUS),
    getDiff: (filePath: string): Promise<GitFileDiff | null> =>
      ipcRenderer.invoke(IPC.GIT_DIFF, { path: filePath }),
    stage: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_STAGE, { path: filePath }),
    unstage: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_UNSTAGE, { path: filePath }),
    commit: (paths: string[], message: string, push = false): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_COMMIT, { paths, message, push }),
    discard: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_DISCARD, { path: filePath }),
    onStatusChanged: (cb: (status: GitStatusResult) => void) => {
      const handler = (_: Electron.IpcRendererEvent, s: GitStatusResult) => cb(s)
      ipcRenderer.on(IPC.GIT_STATUS_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.GIT_STATUS_CHANGED, handler)
    },
    onFileTreeChanged: (cb: () => void) => {
      const handler = () => cb()
      ipcRenderer.on(IPC.FILE_TREE_CHANGED, handler)
      return () => ipcRenderer.removeListener(IPC.FILE_TREE_CHANGED, handler)
    },
    getFileTree: (): Promise<FileTreeResult | null> => ipcRenderer.invoke(IPC.GIT_FILE_TREE),
  },

  searchFileContents: (
    query: string,
    matchCase: boolean,
    wholeWord: boolean,
    useRegex: boolean
  ): Promise<FileContentHit[]> =>
    ipcRenderer.invoke(IPC.SEARCH_FILE_CONTENTS, { query, matchCase, wholeWord, useRegex }),

  readFile: (relPath: string): Promise<FileContent | null> =>
    ipcRenderer.invoke(IPC.READ_FILE, { path: relPath }),
  listPromptTemplates: (): Promise<PromptTemplate[]> =>
    ipcRenderer.invoke(IPC.LIST_PROMPT_TEMPLATES),

  // fff-powered file search and content grep
  fff: {
    fileSearch: (query: string, pageSize?: number, cwd?: string | null): Promise<FffFileResult[]> =>
      ipcRenderer.invoke(IPC.FFF_FILE_SEARCH, { query, pageSize, cwd: cwd ?? undefined }),
    grep: (
      query: string,
      opts?: {
        mode?: 'plain' | 'regex' | 'fuzzy'
        smartCase?: boolean
        maxMatchesPerFile?: number
        timeBudgetMs?: number
        cwd?: string | null
      }
    ): Promise<FffGrepMatch[]> =>
      ipcRenderer.invoke(IPC.FFF_GREP, { query, ...opts, cwd: opts?.cwd ?? undefined }),
  },

  // ── Settings ──────────────────────────────────────────────────────
  getSettings: (): Promise<SettingsResult> => ipcRenderer.invoke(IPC.GET_SETTINGS),
  saveSettings: (scope: 'global' | 'project', settings: PiSettings): Promise<void> =>
    ipcRenderer.invoke(IPC.SAVE_SETTINGS, { scope, settings }),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.OPEN_EXTERNAL, url),
  readThemeColors: (absolutePath: string): Promise<ThemeColors | null> =>
    ipcRenderer.invoke(IPC.READ_THEME_COLORS, absolutePath),
  readThemeTokens: (absolutePath: string): Promise<ThemeTokens | null> =>
    ipcRenderer.invoke(IPC.READ_THEME_TOKENS, absolutePath),

  archiveSessions: (paths: string[]): Promise<ArchiveSessionsResult> =>
    ipcRenderer.invoke(IPC.ARCHIVE_SESSIONS, { paths }),

  listArchivedSessions: (): Promise<ArchivedSessionItem[]> =>
    ipcRenderer.invoke(IPC.LIST_ARCHIVED_SESSIONS),

  unarchiveSessions: (paths: string[]): Promise<void> =>
    ipcRenderer.invoke(IPC.UNARCHIVE_SESSIONS, { paths }),

  listSkills: (): Promise<SkillItem[]> => ipcRenderer.invoke(IPC.LIST_SKILLS),

  readSkillFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.READ_SKILL_FILE, { path: filePath }),

  // ── Provider management ──────────────────────────────────────────────
  getProviders: (): Promise<ProviderInfo[]> => ipcRenderer.invoke(IPC.GET_PROVIDERS),
  setProviderKey: (provider: string, apiKey: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_PROVIDER_KEY, { provider, apiKey }),
  removeProviderKey: (provider: string): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE_PROVIDER_KEY, { provider }),
  loginProvider: (providerId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.LOGIN_PROVIDER, { providerId }),
  logoutProvider: (providerId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.LOGOUT_PROVIDER, { providerId }),
  resolveProviderPrompt: (providerId: string, value: string): Promise<void> =>
    ipcRenderer.invoke(IPC.RESOLVE_PROVIDER_PROMPT, { providerId, value }),
  onProviderLoginEvent: (cb: (event: ProviderLoginEvent) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: ProviderLoginEvent) => cb(event)
    ipcRenderer.on(IPC.PROVIDER_LOGIN_EVENT, handler)
    return () => {
      ipcRenderer.removeListener(IPC.PROVIDER_LOGIN_EVENT, handler)
    }
  },

  // ── Custom provider management (models.json) ──────────────────────
  getCustomProviders: (): Promise<CustomProviderInfo[]> =>
    ipcRenderer.invoke(IPC.GET_CUSTOM_PROVIDERS),
  addCustomProvider: (provider: CustomProvider): Promise<void> =>
    ipcRenderer.invoke(IPC.ADD_CUSTOM_PROVIDER, provider),
  removeCustomProvider: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE_CUSTOM_PROVIDER, { id }),

  // ── Events (main → renderer) ──────────────────────────────────────────────
  onSessionReady: (cb: (payload: SessionReady) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: SessionReady) => cb(payload)
    ipcRenderer.on(IPC.SESSION_READY, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_READY, handler)
  },

  onSessionEvent: (cb: (event: SessionEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: SessionEvent) => cb(event)
    ipcRenderer.on(IPC.SESSION_EVENT, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_EVENT, handler)
  },

  onSessionError: (cb: (error: SessionError) => void) => {
    const handler = (_: Electron.IpcRendererEvent, error: SessionError) => cb(error)
    ipcRenderer.on(IPC.SESSION_ERROR, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_ERROR, handler)
  },

  onSessionIndexUpdated: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on(IPC.SESSION_INDEX_UPDATED, handler)
    return () => ipcRenderer.removeListener(IPC.SESSION_INDEX_UPDATED, handler)
  },
} as const

contextBridge.exposeInMainWorld('openpi', api)

export type OpenPiAPI = typeof api
