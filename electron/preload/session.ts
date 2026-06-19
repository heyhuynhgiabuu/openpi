import { ipcRenderer } from 'electron'
import type {
  AppInfo,
  BashExecutionResult,
  CustomizationsInventory,
  DiagnosticsBundle,
  ModelInfo,
  OpenSession,
  PackageOperationRequest,
  PackageOperationResult,
  PathProtectionResult,
  PickWorkspaceResult,
  SessionHistoryPage,
  SessionInfo,
  SessionListItem,
  SessionListOptions,
  SessionStats,
  SessionTreeResponse,
  SetModel,
  UsageSummary,
  UsageSummaryRequest,
  WorkspaceInfo,
  WorkspaceSummaryInfo,
  WorkspaceTrustResult,
} from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'

export const sessionApi = {
  getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC.GET_APP_INFO),
  pickWorkspace: (): Promise<PickWorkspaceResult> => ipcRenderer.invoke(IPC.PICK_WORKSPACE),

  prompt: (text: string, contextPrefix?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_PROMPT, { text, contextPrefix }),
  steer: (text: string, contextPrefix?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_STEER, { text, contextPrefix }),
  followUp: (text: string, contextPrefix?: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SESSION_FOLLOW_UP, { text, contextPrefix }),
  bash: (command: string, excludeFromContext = false): Promise<BashExecutionResult> =>
    ipcRenderer.invoke(IPC.SESSION_BASH, { command, excludeFromContext }),
  abort: (): Promise<void> => ipcRenderer.invoke(IPC.SESSION_ABORT),

  getModels: (): Promise<ModelInfo[]> => ipcRenderer.invoke(IPC.GET_MODELS),
  setModel: (payload: SetModel): Promise<void> => ipcRenderer.invoke(IPC.SET_MODEL, payload),
  setThinking: (level: string): Promise<void> => ipcRenderer.invoke(IPC.SET_THINKING, { level }),
  getSessionStats: (): Promise<SessionStats> => ipcRenderer.invoke(IPC.GET_SESSION_STATS),
  getUsageSummary: (request?: UsageSummaryRequest): Promise<UsageSummary> =>
    ipcRenderer.invoke(IPC.GET_USAGE_SUMMARY, request),

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

  getCustomizations: (): Promise<CustomizationsInventory> =>
    ipcRenderer.invoke(IPC.GET_CUSTOMIZATIONS),
  setExtensionEnabled: (id: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_EXTENSION_ENABLED, { id, enabled }),
  getFirstRun: (): Promise<boolean> => ipcRenderer.invoke(IPC.GET_FIRST_RUN),
  installPackage: (payload: PackageOperationRequest): Promise<PackageOperationResult> =>
    ipcRenderer.invoke(IPC.INSTALL_PACKAGE, payload),
  removePackage: (payload: PackageOperationRequest): Promise<PackageOperationResult> =>
    ipcRenderer.invoke(IPC.REMOVE_PACKAGE, payload),

  setSessionName: (name: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SET_SESSION_NAME, { name }),
  forkSession: (entryId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.FORK_SESSION, { entryId }),

  compactSession: (payload: { customInstructions?: string } = {}): Promise<void> =>
    ipcRenderer.invoke(IPC.COMPACT_SESSION, payload),
  reloadSession: (): Promise<void> => ipcRenderer.invoke(IPC.RELOAD_SESSION),
  getSessionInfo: (): Promise<SessionInfo | null> => ipcRenderer.invoke(IPC.GET_SESSION_INFO),
  copyLastAssistantText: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.COPY_LAST_ASSISTANT_TEXT),
} as const
