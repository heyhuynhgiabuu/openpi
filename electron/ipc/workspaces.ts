import path from 'node:path'
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
import { setWorkspaceTrustSync } from '../services/workspaceTrustSync'
import type { SessionIndexStore } from '../session/sessionIndex'

interface ConfirmMutationOptions {
  title: string
  message: string
  detail: string
}

interface WorkspacesIpcDeps {
  ipcMain: IpcMain
  getCwd: () => string | null
  getGitHost: () => Promise<typeof GitHost>
  getSessionIndex: () => SessionIndexStore | null
  getCustomizationsHost: () => Promise<typeof CustomizationsHost>
  getAgentDir: () => string
  confirmHighRiskMutation: (options: ConfirmMutationOptions) => Promise<boolean>
}

function authorizeWorkspace(deps: WorkspacesIpcDeps, submittedCwd: string): string {
  const candidate = path.resolve(submittedCwd)
  const active = deps.getCwd()
  if (active && path.resolve(active) === candidate) return active
  const known = deps
    .getSessionIndex()
    ?.listWorkspaces()
    .find((workspace) => path.resolve(workspace.path) === candidate)
  if (known) return known.path
  throw new Error('Unknown workspace')
}

export function registerWorkspacesIpc(deps: WorkspacesIpcDeps): void {
  deps.ipcMain.handle(IPC.GET_GIT_BRANCH, async (_event, raw: unknown): Promise<GitBranchInfo> => {
    const parsed = gitBranchSchema.parse(raw)
    const cwd = authorizeWorkspace(deps, parsed.cwd)
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
      const parsed = workspaceSummaryRequestSchema.parse(raw)
      const cwd = authorizeWorkspace(deps, parsed.cwd)
      const git = await deps.getGitHost()
      return workspaceSummaryInfoSchema.parse(await git.getWorkspaceSummary(cwd))
    }
  )

  deps.ipcMain.handle(
    IPC.SET_WORKSPACE_TRUST,
    async (_event, raw: unknown): Promise<WorkspaceTrustResult> => {
      const parsed = workspaceTrustRequestSchema.parse(raw)
      const cwd = authorizeWorkspace(deps, parsed.cwd)
      const { trusted } = parsed
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
      const result = workspaceTrustResultSchema.parse(sessionIndex.setWorkspaceTrust(cwd, trusted))
      // Mirror the decision into the bridge's trust file so Pi's
      // project_trust event handler can defer to the OpenPi UI.
      setWorkspaceTrustSync(cwd, trusted ? 'trusted' : 'untrusted')
      return result
    }
  )

  deps.ipcMain.handle(IPC.CHECK_PATH_PROTECTION, (_event, raw: unknown) => {
    const { path: targetPath, workspacePath: submittedWorkspace } =
      pathProtectionRequestSchema.parse(raw)
    const workspacePath = submittedWorkspace
      ? authorizeWorkspace(deps, submittedWorkspace)
      : deps.getCwd()
    const violation = checkProtectedPath(targetPath, workspacePath)
    return pathProtectionResultSchema.parse({
      protected: violation !== null,
      level: violation?.level ?? null,
      rule: violation?.rule ?? null,
      reason: violation?.reason ?? null,
    })
  })
}
