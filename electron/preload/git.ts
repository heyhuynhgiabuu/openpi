import { ipcRenderer } from 'electron'
import type {
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
} from '../../src/lib/ipc'
import { IPC } from '../../src/lib/ipc'

export const gitApi = {
  getGitBranch: (cwd: string): Promise<GitBranchInfo> =>
    ipcRenderer.invoke(IPC.GET_GIT_BRANCH, { cwd }),
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
    getFileTree: (cwd: string): Promise<FileTreeResult | null> =>
      ipcRenderer.invoke(IPC.GIT_FILE_TREE, cwd),
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
  renameFile: (relPath: string, newName: string): Promise<string> =>
    ipcRenderer.invoke(IPC.RENAME_FILE, { path: relPath, newName }),
  copyFile: (relPath: string, target?: string): Promise<string> =>
    ipcRenderer.invoke(IPC.COPY_FILE, { path: relPath, target }),
  formatFile: (relPath: string): Promise<string> =>
    ipcRenderer.invoke(IPC.FORMAT_FILE, { path: relPath }),
  getGitRemoteUrl: (): Promise<string | null> => ipcRenderer.invoke(IPC.GIT_REMOTE_URL),

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
} as const
