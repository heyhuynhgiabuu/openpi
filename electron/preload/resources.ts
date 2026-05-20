import { ipcRenderer } from 'electron'
import type {
  ArchivedSessionItem,
  ArchiveSessionsResult,
  CustomProvider,
  CustomProviderInfo,
  DeleteSessionsResult,
  ListDirectoryResult,
  PiSettings,
  PromptTemplate,
  ProviderInfo,
  ProviderLoginEvent,
  SettingsResult,
  SkillItem,
  ThemeColors,
  ThemeTokens,
} from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'

export const resourcesApi = {
  listPromptTemplates: (): Promise<PromptTemplate[]> =>
    ipcRenderer.invoke(IPC.LIST_PROMPT_TEMPLATES),

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

  getCustomProviders: (): Promise<CustomProviderInfo[]> =>
    ipcRenderer.invoke(IPC.GET_CUSTOM_PROVIDERS),
  addCustomProvider: (provider: CustomProvider): Promise<void> =>
    ipcRenderer.invoke(IPC.ADD_CUSTOM_PROVIDER, provider),
  removeCustomProvider: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.REMOVE_CUSTOM_PROVIDER, { id }),
} as const
