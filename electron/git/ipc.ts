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
  gitBranchDiffRequestSchema,
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
  gitHunkActionSchema,
  gitRefsResultSchema,
  gitStagedDiffRequestSchema,
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

/** Same cwd resolution as GIT_PANEL_MOUNTED / git poll — avoids status stuck while poll runs. */
function resolveGitCwd(deps: GitIpcDeps): string | null {
  return deps.getCwd() ?? deps.getDeferredWorkspace()
}

function requireCwd(deps: GitIpcDeps): string | null {
  return resolveGitCwd(deps)
}

/**
 * Verify that a hunk patch's `+++ b/<path>` (or `--- a/<path>` for renames/new
 * files) matches the requested filePath. Defends against a compromised renderer
 * shipping a patch that targets a different file than the user clicked on.
 */
function assertHunkTargetsFile(hunkPatch: string, filePath: string): void {
  const normalizedExpected = filePath.replace(/^\.\//, '').trim()
  const lines = hunkPatch.split(/\r?\n/)
  let sawNewPath = false
  let sawOldPath = false
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      // Once we hit a new diff header, we only care about subsequent target lines
      if (sawNewPath) return // past the first diff header, stop
      continue
    }
    if (line.startsWith('new file mode') || line.startsWith('deleted file mode')) {
      // Allowed; target check still applies below
    }
    if (line.startsWith('rename from ')) {
      // Source path: must equal filePath
      const src = line.slice('rename from '.length).trim()
      if (path.basename(src) !== path.basename(normalizedExpected)) {
        throw new Error(
          `Hunk patch rename source does not match requested file (expected ${normalizedExpected}, got ${src})`
        )
      }
      sawOldPath = true
      continue
    }
    if (line.startsWith('rename to ')) {
      const dst = line.slice('rename to '.length).trim()
      if (path.basename(dst) !== path.basename(normalizedExpected)) {
        throw new Error(
          `Hunk patch rename target does not match requested file (expected ${normalizedExpected}, got ${dst})`
        )
      }
      sawNewPath = true
      continue
    }
    if (line.startsWith('--- ')) {
      const src = line.slice(4).trim()
      // Skip the /dev/null case
      if (src === '/dev/null') {
        sawOldPath = true
        continue
      }
      if (src.startsWith('a/')) {
        if (src.slice(2) !== normalizedExpected) {
          throw new Error(
            `Hunk patch source path does not match requested file (expected ${normalizedExpected}, got ${src.slice(2)})`
          )
        }
        sawOldPath = true
      }
      continue
    }
    if (line.startsWith('+++ ')) {
      const dst = line.slice(4).trim()
      if (dst === '/dev/null') {
        sawNewPath = true
        continue
      }
      if (!dst.startsWith('b/')) {
        throw new Error(`Malformed hunk patch: missing b/ prefix on +++ line (got ${dst})`)
      }
      if (dst.slice(2) !== normalizedExpected) {
        throw new Error(
          `Hunk patch target path does not match requested file (expected ${normalizedExpected}, got ${dst.slice(2)})`
        )
      }
      sawNewPath = true
      // Once we see the new path line, we've verified the first file in the patch
      return
    }
  }
  if (!sawNewPath) {
    throw new Error('Hunk patch missing +++ header (no target file)')
  }
}

export function registerGitIpc(deps: GitIpcDeps): void {
  deps.ipcMain.on(IPC.GIT_PANEL_MOUNTED, () => {
    const cwd = resolveGitCwd(deps)
    console.log('[openpi:git] GIT_PANEL_MOUNTED cwd=', cwd)
    if (!cwd) return
    void deps.restartGitMonitoring(cwd)
  })

  deps.ipcMain.handle(
    IPC.GIT_STATUS,
    async (_event, cwdFromRenderer?: string): Promise<GitStatusResult | null> => {
      const cwd = cwdFromRenderer ?? resolveGitCwd(deps)
      console.log('[openpi:git] GIT_STATUS cwd=', cwd, 'fromRenderer=', !!cwdFromRenderer)
      if (!cwd) return null
      try {
        const git = await deps.getGitHost()
        const result = await git.getGitStatus(cwd)
        console.log('[openpi:git] GIT_STATUS success, files=', result?.files?.length)
        return result
      } catch (err) {
        console.error('[openpi:git-status] error for cwd', cwd, err)
        return null
      }
    }
  )

  deps.ipcMain.handle(IPC.GIT_DIFF, async (_event, raw: unknown): Promise<GitFileDiff | null> => {
    const parsed = gitDiffRequestSchema.parse(raw)
    const cwd = resolveGitCwd(deps) ?? parsed.cwd
    if (!cwd) {
      console.warn(`[openpi:git] GIT_DIFF no cwd (path=${parsed.path})`)
      return null
    }
    const git = await deps.getGitHost()
    try {
      const result = await git.getGitFileDiff(cwd, parsed.path, {
        scope: parsed.scope,
        baseBranch: parsed.baseBranch,
      })
      console.log(
        `[openpi:git] GIT_DIFF ok cwd=${cwd} path=${parsed.path} scope=${parsed.scope ?? 'auto'} hasOld=${!!result?.oldContent} hasNew=${!!result?.newContent}`
      )
      return result
    } catch (err) {
      console.warn(
        `[openpi:git] GIT_DIFF error cwd=${cwd} path=${parsed.path}: ${(err as Error).message}`
      )
      throw err
    }
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
      const parsed = gitCommitDiffRequestSchema.parse(raw)
      const cwd = resolveGitCwd(deps) ?? parsed.cwd
      if (!cwd) {
        console.warn(`[openpi:git] GIT_COMMIT_DIFF no cwd (hash=${parsed.hash})`)
        return null
      }
      const { hash, path: filePath } = parsed
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

  // ─── Phase 3: Scoped diffs & hunk operations ──────────────────────────

  deps.ipcMain.handle(
    IPC.GIT_STAGED_DIFF,
    async (_event, raw: unknown): Promise<Record<string, GitFileDiff> | null> => {
      const parsed = gitStagedDiffRequestSchema.parse(raw ?? {})
      const cwd = resolveGitCwd(deps) ?? parsed.cwd
      if (!cwd) {
        console.warn('[openpi:git] GIT_STAGED_DIFF no cwd')
        return null
      }
      const git = await deps.getGitHost()
      return git.getGitStagedDiff(cwd)
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_BRANCH_DIFF,
    async (_event, raw: unknown): Promise<Record<string, GitFileDiff> | null> => {
      const parsed = gitBranchDiffRequestSchema.parse(raw ?? {})
      const cwd = resolveGitCwd(deps) ?? parsed.cwd
      if (!cwd) {
        console.warn('[openpi:git] GIT_BRANCH_DIFF no cwd')
        return null
      }
      const git = await deps.getGitHost()
      return git.getGitBranchDiff(cwd, parsed.baseBranch)
    }
  )

  deps.ipcMain.handle(
    IPC.GIT_BRANCH_BASE,
    async (_event, raw: unknown): Promise<{ base: string } | null> => {
      const parsed = gitStagedDiffRequestSchema.parse(raw ?? {})
      const cwd = resolveGitCwd(deps) ?? parsed.cwd
      if (!cwd) {
        console.warn('[openpi:git] GIT_BRANCH_BASE no cwd')
        return null
      }
      const git = await deps.getGitHost()
      const base = await git.getGitBranchBase(cwd)
      return base ? { base } : null
    }
  )

  deps.ipcMain.handle(IPC.GIT_STAGE_HUNK, async (_event, raw: unknown) => {
    const parsed = gitHunkActionSchema.parse(raw)
    const cwd = resolveGitCwd(deps) ?? parsed.cwd
    if (!cwd) {
      console.warn(`[openpi:git] GIT_STAGE_HUNK no cwd (path=${parsed.path})`)
      throw new Error('No workspace cwd available')
    }
    const { path: filePath, hunkPatch } = parsed
    assertHunkTargetsFile(hunkPatch, filePath)
    const { blocked } = deps.filterBlockedPaths([filePath])
    if (blocked.length > 0) {
      throw new Error(
        `Cannot stage hunk in protected path: ${blocked[0]?.violation.reason ?? 'blocked'}`
      )
    }
    const git = await deps.getGitHost()
    return git.stageHunk(cwd, filePath, hunkPatch)
  })

  deps.ipcMain.handle(IPC.GIT_UNSTAGE_HUNK, async (_event, raw: unknown) => {
    const parsed = gitHunkActionSchema.parse(raw)
    const cwd = resolveGitCwd(deps) ?? parsed.cwd
    if (!cwd) {
      console.warn(`[openpi:git] GIT_UNSTAGE_HUNK no cwd (path=${parsed.path})`)
      throw new Error('No workspace cwd available')
    }
    const { path: filePath, hunkPatch } = parsed
    assertHunkTargetsFile(hunkPatch, filePath)
    const git = await deps.getGitHost()
    return git.unstageHunk(cwd, filePath, hunkPatch)
  })

  deps.ipcMain.handle(IPC.GIT_REVERT_HUNK, async (_event, raw: unknown) => {
    const parsed = gitHunkActionSchema.parse(raw)
    const cwd = resolveGitCwd(deps) ?? parsed.cwd
    if (!cwd) {
      console.warn(`[openpi:git] GIT_REVERT_HUNK no cwd (path=${parsed.path})`)
      throw new Error('No workspace cwd available')
    }
    const { path: filePath, hunkPatch } = parsed
    assertHunkTargetsFile(hunkPatch, filePath)
    const approved = await deps.confirmHighRiskMutation({
      title: 'Revert hunk?',
      message: 'Confirm hunk revert',
      detail: `This will discard the working-tree changes for this hunk in:

${filePath}

This cannot be undone by OpenPi.`,
    })
    if (!approved) return null
    const { blocked } = deps.filterBlockedPaths([filePath])
    if (blocked.length > 0) {
      throw new Error(
        `Cannot revert hunk in protected path: ${blocked[0]?.violation.reason ?? 'blocked'}`
      )
    }
    const git = await deps.getGitHost()
    return git.revertHunk(cwd, filePath, hunkPatch)
  })
}
