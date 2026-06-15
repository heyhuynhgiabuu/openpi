import path from 'node:path'
import type { IpcMain } from 'electron'
import type {
  FileContentHit,
  FileTreeResult,
  GenerateCommitMessageResult,
  GitCheckoutBranchResult,
  GitCreateBranchResult,
  GitFileDiff,
  GitHistoryResult,
  GitRefsResult,
  GitStashActionResult,
  GitStatusResult,
  GitSyncResult,
} from '../../src/lib/ipc'
import {
  fileTreeResultSchema,
  gitCheckoutBranchResultSchema,
  gitCheckoutBranchSchema,
  gitCommitDiffRequestSchema,
  gitCommitSchema,
  gitCreateBranchResultSchema,
  gitCreateBranchSchema,
  gitDiffRequestSchema,
  gitDiscardSchema,
  gitFileDiffSchema,
  gitHistoryRequestSchema,
  gitHistoryResultSchema,
  gitRefsResultSchema,
  gitStageSchema,
  gitStashActionResultSchema,
  gitStashActionSchema,
  gitSyncResultSchema,
  gitSyncSchema,
  gitUnstageSchema,
  IPC,
  searchFileContentsRequestSchema,
} from '../../src/lib/ipc'
import type * as GitHost from '../git/gitHost'
import type { filterBlockedPaths as filterProtectedPaths } from '../services/protectedPaths'
import { enrichTree } from './gitFileTree'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

interface GitIpcDeps {
  ipcMain: IpcMain
  getCwd: () => string | null
  getDeferredWorkspace: () => string | null
  getGitHost: () => Promise<typeof GitHost>
  restartGitMonitoring: (cwd: string) => Promise<void>
  filterBlockedPaths: typeof filterProtectedPaths
  confirmHighRiskMutation: (options: ConfirmMutationOptions) => Promise<boolean>
  getCommitAgentContext: () => Promise<string | undefined>
}

function requireCwd(deps: GitIpcDeps): string | null {
  return deps.getCwd()
}

export function registerGitIpc(deps: GitIpcDeps): void {
  deps.ipcMain.on(IPC.GIT_PANEL_MOUNTED, () => {
    const cwd = deps.getCwd() ?? deps.getDeferredWorkspace()
    if (!cwd) return
    void deps.restartGitMonitoring(cwd)
  })

  deps.ipcMain.handle(IPC.GIT_STATUS, async (): Promise<GitStatusResult | null> => {
    const cwd = requireCwd(deps)
    if (!cwd) return null
    try {
      const git = await deps.getGitHost()
      return await git.getGitStatus(cwd)
    } catch {
      return null
    }
  })

  deps.ipcMain.handle(IPC.GIT_DIFF, async (_event, raw: unknown): Promise<GitFileDiff | null> => {
    const cwd = requireCwd(deps)
    if (!cwd) return null
    const { path: filePath } = gitDiffRequestSchema.parse(raw)
    const git = await deps.getGitHost()
    return git.getGitFileDiff(cwd, filePath)
  })

  deps.ipcMain.handle(IPC.GIT_STAGE, async (_event, raw: unknown): Promise<void> => {
    const cwd = requireCwd(deps)
    if (!cwd) return
    const { path: filePath } = gitStageSchema.parse(raw)
    const { blocked } = deps.filterBlockedPaths([filePath])
    if (blocked.length > 0) {
      throw new Error(
        `Cannot stage protected path: ${blocked[0]?.violation.reason ?? 'blocked path'}`
      )
    }
    const git = await deps.getGitHost()
    await git.stageFile(cwd, filePath)
  })

  deps.ipcMain.handle(IPC.GIT_UNSTAGE, async (_event, raw: unknown): Promise<void> => {
    const cwd = requireCwd(deps)
    if (!cwd) return
    const { path: filePath } = gitUnstageSchema.parse(raw)
    const git = await deps.getGitHost()
    await git.unstageFile(cwd, filePath)
  })

  deps.ipcMain.handle(IPC.GIT_COMMIT, async (_event, raw: unknown): Promise<void> => {
    const cwd = requireCwd(deps)
    if (!cwd) return
    const { paths, message, push, amend, signoff } = gitCommitSchema.parse(raw)
    const { allowed: safePaths, blocked: blockedPaths } = deps.filterBlockedPaths(paths)
    if (blockedPaths.length > 0) {
      const labels = blockedPaths.map((blockedPath) => path.basename(blockedPath.path)).join(', ')
      throw new Error(`Commit blocked: ${labels} matches a protected path policy.`)
    }
    const git = await deps.getGitHost()
    await git.commitFiles(cwd, safePaths, message, push, { amend, signoff })
  })

  deps.ipcMain.handle(IPC.GIT_DISCARD, async (_event, raw: unknown): Promise<void> => {
    const cwd = requireCwd(deps)
    if (!cwd) return
    const { path: filePath } = gitDiscardSchema.parse(raw)
    const approved = await deps.confirmHighRiskMutation({
      title: 'Discard file changes?',
      message: 'Confirm destructive Git discard',
      detail: `This will discard local changes for:\n\n${filePath}\n\nThis cannot be undone by OpenPi.`,
    })
    if (!approved) return
    const git = await deps.getGitHost()
    await git.discardFile(cwd, filePath)
  })

  deps.ipcMain.handle(IPC.GIT_SYNC, async (_event, raw: unknown): Promise<GitSyncResult | null> => {
    const cwd = requireCwd(deps)
    if (!cwd) return null
    const { action } = gitSyncSchema.parse(raw)
    const git = await deps.getGitHost()
    return gitSyncResultSchema.parse(await git.syncRemote(cwd, action))
  })

  deps.ipcMain.handle(IPC.GIT_REFS, async (): Promise<GitRefsResult | null> => {
    const cwd = requireCwd(deps)
    if (!cwd) return null
    const git = await deps.getGitHost()
    return gitRefsResultSchema.parse(await git.getGitRefs(cwd))
  })

  deps.ipcMain.handle(
    IPC.GIT_HISTORY,
    async (_event, raw: unknown): Promise<GitHistoryResult | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const { query, limit } = gitHistoryRequestSchema.parse(raw)
      const git = await deps.getGitHost()
      return gitHistoryResultSchema.parse(await git.getGitHistory(cwd, query, limit))
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_COMMIT_DIFF,
    async (_event, raw: unknown): Promise<GitFileDiff | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const { hash, path: filePath } = gitCommitDiffRequestSchema.parse(raw)
      const git = await deps.getGitHost()
      try {
        return gitFileDiffSchema.parse(await git.getGitCommitDiff(cwd, hash, filePath))
      } catch {
        return null
      }
    }
  )

  deps.ipcMain.handle(IPC.GIT_REMOTE_URL, async (): Promise<string | null> => {
    const cwd = requireCwd(deps)
    if (!cwd) return null
    const git = await deps.getGitHost()
    return git.getGitRemoteUrl(cwd)
  })

  deps.ipcMain.handle(
    IPC.GIT_CREATE_BRANCH,
    async (_event, raw: unknown): Promise<GitCreateBranchResult | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const { name } = gitCreateBranchSchema.parse(raw)
      const git = await deps.getGitHost()
      return gitCreateBranchResultSchema.parse(await git.createBranch(cwd, name))
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_STASH_APPLY,
    async (_event, raw: unknown): Promise<GitStashActionResult | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const { index } = gitStashActionSchema.parse(raw)
      const git = await deps.getGitHost()
      return gitStashActionResultSchema.parse(await git.stashApply(cwd, index))
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_STASH_POP,
    async (_event, raw: unknown): Promise<GitStashActionResult | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const { index } = gitStashActionSchema.parse(raw)
      const git = await deps.getGitHost()
      return gitStashActionResultSchema.parse(await git.stashPop(cwd, index))
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_STASH_DROP,
    async (_event, raw: unknown): Promise<GitStashActionResult | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const { index } = gitStashActionSchema.parse(raw)
      const git = await deps.getGitHost()
      return gitStashActionResultSchema.parse(await git.stashDrop(cwd, index))
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_CHECKOUT_BRANCH,
    async (_event, raw: unknown): Promise<GitCheckoutBranchResult | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const { branch } = gitCheckoutBranchSchema.parse(raw)
      const git = await deps.getGitHost()
      return gitCheckoutBranchResultSchema.parse(await git.checkoutBranch(cwd, branch))
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_FILE_TREE,
    async (_event, cwdFromRenderer?: string): Promise<FileTreeResult | null> => {
      const cwd = cwdFromRenderer ?? requireCwd(deps)
      if (!cwd) return null
      const git = await deps.getGitHost()
      const tree = git.getFileTree(cwd)
      // Enrich tree with git status so the renderer can show M/A/D/R badges
      const status = await git.getGitStatus(cwd)
      const statusMap = new Map<string, string>()
      for (const file of status.files) {
        statusMap.set(file.path, file.status)
      }
      return fileTreeResultSchema.parse(enrichTree(tree, statusMap))
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_GENERATE_COMMIT_MSG,
    async (): Promise<GenerateCommitMessageResult | null> => {
      const cwd = requireCwd(deps)
      if (!cwd) return null
      const git = await deps.getGitHost()
      const status = await git.getGitStatus(cwd)
      const staged = status?.files.filter((file) => file.staged) ?? []
      return { message: git.generateCommitMessage(staged, await deps.getCommitAgentContext()) }
    }
  )

  deps.ipcMain.handle(
    IPC.SEARCH_FILE_CONTENTS,
    async (_event, raw: unknown): Promise<FileContentHit[]> => {
      const cwd = requireCwd(deps)
      if (!cwd) return []
      const { query, matchCase, wholeWord, useRegex } = searchFileContentsRequestSchema.parse(raw)
      const git = await deps.getGitHost()
      return git.searchFileContents(cwd, query, matchCase, wholeWord, useRegex)
    }
  )
}
