import { homedir } from 'node:os'
import path from 'node:path'
import type { ToolHookCall, ToolHooks } from '@earendil-works/pi-durable'
import { checkProtectedPath } from '../../services/protectedPaths'
import { highRiskShellReason } from '../../services/highRisk'

/** Policy decisions the durable runtime must honor, mirroring the SDK-path gates in Electron main. */
export interface DurablePolicyOptions {
  /** Active workspace root; paths outside it are scope violations. */
  workspacePath?: string | null
  /** Tools whose file arguments are checked against protected paths. */
  fileTools?: readonly string[]
  /** Tool whose `command` argument is checked against the high-risk shell patterns. */
  shellTool?: string
}

const DEFAULT_FILE_TOOLS = ['write', 'edit', 'read']
const DEFAULT_SHELL_TOOL = 'bash'

/** Read a string argument without trusting the caller's shape. */
function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * Expand a leading `~` before policy checks. `checkProtectedPath` compares absolute paths, so a
 * model-written `~/.ssh/id_rsa` would otherwise slip past the hard rules.
 */
function expandHome(target: string): string {
  if (target === '~') return homedir()
  if (target.startsWith('~/') || target.startsWith('~\\'))
    return path.join(homedir(), target.slice(2))
  return target
}

/**
 * Resolve the path the way the tool will: `~` against the real home, relative paths against the
 * tool's working directory. Falling back to `process.cwd()` would let `.ssh/id_rsa` slip past the
 * hard rules whenever Electron was started outside the workspace.
 */
function resolveToolPath(target: string, workspacePath: string | null | undefined): string {
  const expanded = expandHome(target)
  if (path.isAbsolute(expanded)) return expanded
  return path.resolve(workspacePath ?? process.cwd(), expanded)
}

/**
 * Map a tool call to the argument that names a filesystem path.
 * `write`/`read` use `path`, `edit` uses `filePath`; unknown tools contribute no path.
 */
function pathForCall(name: string, args: Record<string, unknown>): string | undefined {
  return stringArg(args, 'path') ?? stringArg(args, 'filePath')
}

/**
 * `ToolTask.beforeTool` handler: block hard-protected paths unconditionally, and block
 * high-risk shell commands. Soft/scope protections are surfaced to the caller for
 * confirmation in a later slice instead of blocking silence-free.
 */
export function beforeToolPolicy(
  call: ToolHookCall,
  options: DurablePolicyOptions = {}
): { block: string } | undefined {
  const fileTools = options.fileTools ?? DEFAULT_FILE_TOOLS
  const shellTool = options.shellTool ?? DEFAULT_SHELL_TOOL
  const args: Record<string, unknown> = call.arguments ?? {}

  if (fileTools.includes(call.name)) {
    const target = pathForCall(call.name, args)
    if (target) {
      const violation = checkProtectedPath(
        resolveToolPath(target, options.workspacePath),
        options.workspacePath ?? null
      )
      if (violation && violation.level === 'hard') {
        return { block: `Blocked by desktop policy: ${violation.reason} (${violation.rule})` }
      }
    }
  }

  if (call.name === shellTool) {
    const command = stringArg(args, 'command')
    const reason = command ? highRiskShellReason(command) : null
    if (reason) return { block: `Blocked by desktop policy: ${reason}` }
  }

  return undefined
}

/** The `ToolTask` hook registration the durable registry installs. */
export function policyToolHooks(options: DurablePolicyOptions = {}): ToolHooks {
  return {
    beforeTool: (call) => beforeToolPolicy(call, options),
    afterTool: () => undefined,
  }
}
