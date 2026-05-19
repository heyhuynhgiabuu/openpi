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
  DeleteSessionsResult,
  DiagnosticsBundle,
  FffFileResult,
  FffGrepMatch,
  FileContent,
  FileContentHit,
  FileTreeResult,
  GitBranchInfo,
  GitChangedFile,
  GitCheckoutBranchResult,
  GitCreateBranchResult,
  GitFileDiff,
  GitHistoryResult,
  GitRefsResult,
  GitStashActionResult,
  GitStatusResult,
  GitSyncAction,
  GitSyncResult,
  ListDirectoryResult,
  ModelInfo,
  OpenSession,
  OutputLine,
  PackageOperationRequest,
  PackageOperationResult,
  PathProtectionResult,
  PickWorkspaceResult,
  PiSettings,
  PiUpdateCheckResult,
  PiUpdateInstallResult,
  PlanUpdate,
  PromptTemplate,
  ProviderInfo,
  ProviderLoginEvent,
  PtyData,
  PtyExit,
  RemoteSessionUpdate,
  SessionError,
  SessionEvent,
  SessionHistoryPage,
  SessionListItem,
  SessionListOptions,
  SessionReady,
  SessionStats,
  SessionTreeResponse,
  SetModel,
  SettingsResult,
  SkillItem,
  ThemeColors,
  ThemeTokens,
  WorkbenchContextPayload,
  WorkspaceInfo,
  WorkspaceSummaryInfo,
  WorkspaceTrustResult,
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
  prompt: (text: string, contextPrefix?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_PROMPT, { text, contextPrefix }),

  steer: (text: string, contextPrefix?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_STEER, { text, contextPrefix }),

  followUp: (text: string, contextPrefix?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_FOLLOW_UP, { text, contextPrefix }),

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

  getSessionTree: (path: string): Promise<SessionTreeResponse> =>
    ipcRenderer.invoke(IPC.GET_SESSION_TREE, { path }),

  openSession: (payload: OpenSession): Promise<void> =>
    ipcRenderer.invoke(IPC.OPEN_SESSION, payload),

  newSession: (cwd?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.NEW_SESSION, cwd ? { cwd } : {}),

  getGitBranch: (cwd: string): Promise<GitBranchInfo> =>
    ipcRenderer.invoke(IPC.GET_GIT_BRANCH, { cwd }),

  getWorkspaceSummary: (cwd: string): Promise<WorkspaceSummaryInfo> =>
    ipcRenderer.invoke(IPC.GET_WORKSPACE_SUMMARY, { cwd }),

  setWorkspaceTrust: (cwd: string, trusted: boolean): Promise<WorkspaceTrustResult> =>
    ipcRenderer.invoke(IPC.SET_WORKSPACE_TRUST, { cwd, trusted }),

  checkPathProtection: (
    targetPath: string,
    workspacePath?: string | null
  ): Promise<PathProtectionResult> =>
    ipcRenderer.invoke(IPC.CHECK_PATH_PROTECTION, { path: targetPath, workspacePath }),

  getDiagnosticsBundle: (): Promise<DiagnosticsBundle> =>
    ipcRenderer.invoke(IPC.GET_DIAGNOSTICS_BUNDLE),

  // ── Customizations ────────────────────────────────────────────────────────
  getCustomizations: (): Promise<CustomizationsInventory> =>
    ipcRenderer.invoke(IPC.GET_CUSTOMIZATIONS),
  setExtensionEnabled: (id: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_EXTENSION_ENABLED, { id, enabled }),
  getFirstRun: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_FIRST_RUN),

  installPackage: (payload: PackageOperationRequest): Promise<PackageOperationResult> =>
    ipcRenderer.invoke(IPC.INSTALL_PACKAGE, payload),

  removePackage: (payload: PackageOperationRequest): Promise<PackageOperationResult> =>
    ipcRenderer.invoke(IPC.REMOVE_PACKAGE, payload),

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
  getOutputBuffer: (): Promise<OutputLine[]> => ipcRenderer.invoke(IPC.GET_OUTPUT_BUFFER),

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
    install: (): Promise<void> => ipcRenderer.invoke(IPC.APP_UPDATE_INSTALL),
    onStatus: (cb: (status: AppUpdateStatus) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, status: AppUpdateStatus) => cb(status)
      ipcRenderer.on(IPC.APP_UPDATE_STATUS, handler)
      return () => ipcRenderer.removeListener(IPC.APP_UPDATE_STATUS, handler)
    },
  },
  // ── Workbench context bridge ─────────────────────────────────────────────
  workbenchContext: {
    update: (payload: {
      visibleFile: string | null
      visibleFileAbs: string | null
      terminalOutput: string | null
    }): void => ipcRenderer.send(IPC.WORKBENCH_CONTEXT_UPDATE, payload),
    get: (): Promise<WorkbenchContextPayload> => ipcRenderer.invoke(IPC.WORKBENCH_CONTEXT_GET),
    onChange: (cb: (context: WorkbenchContextPayload) => void): (() => void) => {
      const handler = (_e: Electron.IpcRendererEvent, context: WorkbenchContextPayload) =>
        cb(context)
      ipcRenderer.on('openpi:workbench-context-changed', handler)
      return () => ipcRenderer.removeListener('openpi:workbench-context-changed', handler)
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
    commit: (
      paths: string[],
      message: string,
      push = false,
      options: { amend?: boolean; signoff?: boolean } = {}
    ): Promise<void> => ipcRenderer.invoke(IPC.GIT_COMMIT, { paths, message, push, ...options }),
    discard: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IPC.GIT_DISCARD, { path: filePath }),
    sync: (action: GitSyncAction): Promise<GitSyncResult | null> =>
      ipcRenderer.invoke(IPC.GIT_SYNC, { action }),
    getRefs: (): Promise<GitRefsResult | null> => ipcRenderer.invoke(IPC.GIT_REFS),
    getHistory: (query = '', limit = 100): Promise<GitHistoryResult | null> =>
      ipcRenderer.invoke(IPC.GIT_HISTORY, { query, limit }),
    getCommitDiff: (hash: string, path?: string): Promise<GitFileDiff | null> =>
      ipcRenderer.invoke(IPC.GIT_COMMIT_DIFF, { hash, path }),
    checkoutBranch: (branch: string): Promise<GitCheckoutBranchResult | null> =>
      ipcRenderer.invoke(IPC.GIT_CHECKOUT_BRANCH, { branch }),
    createBranch: (name: string): Promise<GitCreateBranchResult | null> =>
      ipcRenderer.invoke(IPC.GIT_CREATE_BRANCH, { name }),
    stashApply: (index: number): Promise<GitStashActionResult | null> =>
      ipcRenderer.invoke(IPC.GIT_STASH_APPLY, { index }),
    stashPop: (index: number): Promise<GitStashActionResult | null> =>
      ipcRenderer.invoke(IPC.GIT_STASH_POP, { index }),
    stashDrop: (index: number): Promise<GitStashActionResult | null> =>
      ipcRenderer.invoke(IPC.GIT_STASH_DROP, { index }),
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
    generateCommitMessage: (): Promise<{ message: string } | null> =>
      ipcRenderer.invoke(IPC.GIT_GENERATE_COMMIT_MSG),
    onAgentChangedFiles: (cb: (payload: { count: number; files: GitChangedFile[] }) => void) => {
      const handler = (
        _: Electron.IpcRendererEvent,
        payload: { count: number; files: GitChangedFile[] }
      ) => cb(payload)
      ipcRenderer.on(IPC.AGENT_CHANGED_FILES, handler)
      return () => ipcRenderer.removeListener(IPC.AGENT_CHANGED_FILES, handler)
    },
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
  writeFile: (relPath: string, content: string): Promise<void> =>
    ipcRenderer.invoke(IPC.WRITE_FILE, { path: relPath, content }),
  deleteFile: (relPath: string): Promise<{ trashed: boolean }> =>
    ipcRenderer.invoke(IPC.DELETE_FILE, { path: relPath }),
  formatFile: (relPath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FORMAT_FILE, { path: relPath }),
  listPromptTemplates: (): Promise<PromptTemplate[]> =>
    ipcRenderer.invoke(IPC.LIST_PROMPT_TEMPLATES),

  getGitRemoteUrl: (): Promise<string | null> => ipcRenderer.invoke(IPC.GIT_REMOTE_URL),

  // fff-powered file search and content grep
  fff: {
    fileSearch: (
      query: string,
      pageSize: number | undefined,
      cwd: string
    ): Promise<FffFileResult[]> =>
      ipcRenderer.invoke(IPC.FFF_FILE_SEARCH, { query, pageSize, cwd }),
    grep: (
      query: string,
      opts?: {
        mode?: 'plain' | 'regex' | 'fuzzy'
        smartCase?: boolean
        maxMatchesPerFile?: number
        timeBudgetMs?: number
        cwd: string
      }
    ): Promise<FffGrepMatch[]> => ipcRenderer.invoke(IPC.FFF_GREP, { query, ...opts }),
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

  deleteSessions: (paths: string[]): Promise<DeleteSessionsResult> =>
    ipcRenderer.invoke(IPC.DELETE_SESSIONS, { paths }),

  listSkills: (): Promise<SkillItem[]> => ipcRenderer.invoke(IPC.LIST_SKILLS),

  readSkillFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.READ_SKILL_FILE, { path: filePath }),
  listDirectory: (relPath: string): Promise<ListDirectoryResult> =>
    ipcRenderer.invoke(IPC.LIST_DIRECTORY, { path: relPath }),

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
  sendPrompt: (text: string): Promise<void> => ipcRenderer.invoke(IPC.SEND_PROMPT, { text }),

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

  onRemoteSessionStatus: (
    cb: (payload: {
      app: string
      status: string
      pid: number
      workspace?: string
      sessionFile?: string | null
    }) => void
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: {
        app: string
        status: string
        pid: number
        workspace?: string
        sessionFile?: string | null
      }
    ) => cb(payload)
    ipcRenderer.on(IPC.REMOTE_SESSION_STATUS, handler)
    return () => ipcRenderer.removeListener(IPC.REMOTE_SESSION_STATUS, handler)
  },

  onRemoteSessionUpdate: (cb: (payload: RemoteSessionUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: RemoteSessionUpdate) => cb(payload)
    ipcRenderer.on(IPC.REMOTE_SESSION_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.REMOTE_SESSION_UPDATE, handler)
  },

  onGoalUpdate: (cb: (payload: import('../src/lib/ipc').GoalUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: import('../src/lib/ipc').GoalUpdate) =>
      cb(payload)
    ipcRenderer.on(IPC.GOAL_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.GOAL_UPDATE, handler)
  },

  onPlanUpdate: (cb: (payload: PlanUpdate) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: PlanUpdate) => cb(payload)
    ipcRenderer.on(IPC.PLAN_UPDATE, handler)
    return () => ipcRenderer.removeListener(IPC.PLAN_UPDATE, handler)
  },
} as const

contextBridge.exposeInMainWorld('openpi', api)

export type OpenPiAPI = typeof api
