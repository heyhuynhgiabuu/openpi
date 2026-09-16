/**
 * taskAgents.ts — Effective pi-task agent catalog for the composer's
 * @mention suggestions.
 *
 * pi-task owns agent semantics (definitions, precedence, tool policy), so this
 * module imports pi-task's own `discoverAgents` from the installed package
 * instead of reimplementing discovery. Precedence: bundled < user
 * (~/.pi/agent/agents) < project (<workspace>/.pi/agents); hidden agents are
 * excluded exactly like pi-task's tool description.
 *
 * If pi-task is not installed (no `task` tool exists) or its helpers cannot be
 * loaded, the catalog is empty — the composer then offers no agent mentions,
 * which matches what the agent runtime could actually execute.
 */
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { taskAgentInfoSchema, type TaskAgentInfo } from '../../src/lib/ipc'

const PI_TASK_PACKAGE = path.join('@heyhuynhgiabuu', 'pi-task')

/** Where Pi installs `npm:` packages for the agent dir (settings.json `packages`). */
export function resolvePiTaskDir(agentDir: string): string | null {
  const candidates = [
    path.join(agentDir, 'npm', 'node_modules', PI_TASK_PACKAGE),
    path.join(agentDir, 'node_modules', PI_TASK_PACKAGE),
  ]
  for (const dir of candidates) {
    if (existsSync(path.join(dir, 'package.json'))) return dir
  }
  return null
}

/** Minimal structural contract of the pieces of pi-task's helpers this module uses. */
interface PiTaskHelpers {
  discoverAgents: (cwd: string, bundledAgentDir?: string) => { agents?: unknown }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Validate + map one pi-task agent into the IPC DTO; null = skip. */
function toTaskAgentInfo(raw: unknown): TaskAgentInfo | null {
  if (!isRecord(raw)) return null
  const candidate = {
    name: typeof raw.name === 'string' ? raw.name : '',
    description: typeof raw.description === 'string' ? raw.description : '',
    source: raw.source,
    readonly: raw.readonly === true,
    proactive: raw.proactive === true,
    model: typeof raw.model === 'string' ? raw.model : null,
    thinking: typeof raw.thinking === 'string' ? raw.thinking : null,
    maxTurns:
      typeof raw.maxTurns === 'number' && Number.isInteger(raw.maxTurns) ? raw.maxTurns : null,
    runtime: typeof raw.runtime === 'string' ? raw.runtime : null,
    tools: Array.isArray(raw.tools)
      ? raw.tools.filter((t): t is string => typeof t === 'string')
      : [],
    disallowedTools: Array.isArray(raw.disallowedTools)
      ? raw.disallowedTools.filter((t): t is string => typeof t === 'string')
      : [],
    skills: Array.isArray(raw.skills)
      ? raw.skills.filter((s): s is string => typeof s === 'string')
      : [],
    path: typeof raw.path === 'string' ? raw.path : '',
  }
  const parsed = taskAgentInfoSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

export interface TaskAgentsDeps {
  /** pi agent dir (mirrors the sidecar: ~/.pi/agent). */
  agentDir: string
  cwd: string
  /** Injectable for tests; defaults to a runtime dynamic import. */
  importHelpers?: (helpersPath: string) => Promise<unknown>
}

/**
 * The effective agent catalog for `cwd`, or [] when pi-task is absent or its
 * helpers cannot be loaded. Mirrors pi-task's own visibility: hidden agents
 * are excluded; the tool description's PROACTIVE prefix stays in the DTO (the
 * UI strips it for display, like pi-task's formatAgentList does).
 */
export async function listTaskAgents(deps: TaskAgentsDeps): Promise<TaskAgentInfo[]> {
  const pkgDir = resolvePiTaskDir(deps.agentDir)
  if (!pkgDir) return []

  const helpersPath = path.join(pkgDir, 'dist', 'helpers.js')
  if (!existsSync(helpersPath)) return []

  try {
    const imported = deps.importHelpers
      ? await deps.importHelpers(helpersPath)
      : await import(pathToFileURL(helpersPath).href)
    if (!isRecord(imported) || typeof imported.discoverAgents !== 'function') return []
    const helpers = imported as unknown as PiTaskHelpers

    const bundledAgentDir = path.join(pkgDir, 'agents')
    const result = helpers.discoverAgents(deps.cwd, bundledAgentDir)
    if (!isRecord(result) || !Array.isArray(result.agents)) return []

    // Mirror pi-task's getTaskAgents(): hidden agents never reach the tool
    // description, so the composer must not offer them either.
    return (result.agents as unknown[])
      .filter((candidate) => isRecord(candidate) && candidate.hidden !== true)
      .map(toTaskAgentInfo)
      .filter((agent): agent is TaskAgentInfo => agent !== null)
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.warn(`[openpi:task-agents] catalog unavailable: ${message}`)
    return []
  }
}

/** Mirrors the sidecar's agent dir resolution. */
export function getDefaultPiAgentDir(): string {
  return path.join(os.homedir(), '.pi', 'agent')
}
