import type { IpcMain } from 'electron'
import type { GitBranchInfo, WorkspaceSummaryInfo, WorkspaceTrustResult } from '../../src/lib/ipc'
import {
  gitBranchSchema,
  IPC,
  pathProtectionRequestSchema,
  pathProtectionResultSchema,
  workspaceSummaryInfoSchema,
  workspaceSummaryRequestSchema,
  workspaceTrustRequestSchema,
  workspaceTrustResultSchema,
} from '../../src/lib/ipc'
import type * as GitHost from '../git/gitHost'
import type * as CustomizationsHost from '../services/customizations'
import { checkProtectedPath } from '../services/protectedPaths'
import type { SessionIndexStore } from '../session/sessionIndex'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

interface WorkspacesIpcDeps {
  ipcMain: IpcMain
  getGitHost: () => Promise<typeof GitHost>
  getSessionIndex: () => SessionIndexStore | null
  getCustomizationsHost: () => Promise<typeof CustomizationsHost>
  getAgentDir: () => string
  confirmHighRiskMutation: (options: ConfirmMutationOptions) => Promise<boolean>
}

export function registerWorkspacesIpc(deps: WorkspacesIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_GIT_BRANCH, async (_event, raw: unknown): Promise<GitBranchInfo> => {
    const { cwd } = gitBranchSchema.parse(raw)
    try {
      const { default: simpleGit } = await import('simple-git')
      const branch = await simpleGit({ baseDir: cwd }).branch()
      return { branch: branch.current || null }
    } catch {
      return { branch: null }
    }
  })

  deps.ipcMain.handle(
    IPC.GET_WORKSPACE_SUMMARY,
    async (_event, raw: unknown): Promise<WorkspaceSummaryInfo> => {
      const { cwd } = workspaceSummaryRequestSchema.parse(raw)
      const git = await deps.getGitHost()
      return workspaceSummaryInfoSchema.parse(await git.getWorkspaceSummary(cwd))
    }
  )

  deps.ipcMain.handle(
    IPC.SET_WORKSPACE_TRUST,
    async (_event, raw: unknown): Promise<WorkspaceTrustResult> => {
      const { cwd, trusted } = workspaceTrustRequestSchema.parse(raw)
      const sessionIndex = deps.getSessionIndex()
      if (!sessionIndex) throw new Error('Session index is not ready')
      if (trusted && !sessionIndex.isWorkspaceTrusted(cwd)) {
        const { discoverCustomizations } = await deps.getCustomizationsHost()
        const inventory = await discoverCustomizations({
          cwd,
          agentDir: deps.getAgentDir(),
          workspaceTrusted: false,
        })
        const projectExtensions = inventory.items.filter(
          (item) => item.type === 'extensions' && item.scope === 'project'
        )
        if (projectExtensions.length > 0) {
          const approved = await deps.confirmHighRiskMutation({
            title: 'Trust workspace extensions?',
            message: 'Confirm workspace trust before enabling executable project resources.',
            detail: `This will allow ${projectExtensions.length} project extension${projectExtensions.length === 1 ? '' : 's'} to run with full Node permissions:\n\n${projectExtensions.map((item) => `• ${item.name}: ${item.path ?? item.source}`).join('\n')}`,
          })
          if (!approved) {
            return workspaceTrustResultSchema.parse({ cwd, trusted: false, trustedAt: null })
          }
        }
      }
      return workspaceTrustResultSchema.parse(sessionIndex.setWorkspaceTrust(cwd, trusted))
    }
  )

  deps.ipcMain.handle(IPC.CHECK_PATH_PROTECTION, (_event, raw: unknown) => {
    const { path: targetPath, workspacePath } = pathProtectionRequestSchema.parse(raw)
    const violation = checkProtectedPath(targetPath, workspacePath)
    return pathProtectionResultSchema.parse({
      protected: violation !== null,
      level: violation?.level ?? null,
      rule: violation?.rule ?? null,
      reason: violation?.reason ?? null,
    })
  })
}
