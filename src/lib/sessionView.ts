import type { GroupMode, SessionGroup } from '../types/session'
import type { SessionListItem } from './ipc'

export const OPENPI_ASCII = [
  ' ██████╗ ██████╗ ███████╗███╗   ██╗██████╗ ██╗',
  '██╔═══██╗██╔══██╗██╔════╝████╗  ██║██╔══██╗██║',
  '██║   ██║██████╔╝█████╗  ██╔██╗ ██║██████╔╝██║',
  '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║██╔═══╝ ██║',
  '╚██████╔╝██║     ███████╗██║ ╚████║██║     ██║',
  ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝╚═╝     ╚═╝',
].join('\n')

export const TOOL_LABEL: Record<string, string> = {
  // Shell
  bash: 'Shell',
  sh: 'Shell',
  computer_bash: 'Shell',
  run_command: 'Shell',
  // File ops
  read: 'Read',
  write: 'Write',
  // Edit ops
  edit: 'Edit',
  multiedit: 'Edit',
  // Search / navigation
  grep: 'Grep',
  find: 'Find',
  ls: 'List',
  // Pi Subagents
  task: 'Task',
}

export function labelForTool(name: string): string {
  // `TOOL_LABEL` inherits from `Object.prototype`, so a tool named `toString`
  // or `constructor` would return a function from the index access and reach
  // the renderer as a non-string child.
  return Object.hasOwn(TOOL_LABEL, name) ? TOOL_LABEL[name] : 'Tool'
}

export function groupSessions(sessions: SessionListItem[], groupBy: GroupMode): SessionGroup[] {
  const map = new Map<string, SessionListItem[]>()
  for (const session of sessions) {
    const key =
      groupBy === 'time'
        ? timeGroup(session.updatedAt)
        : session.workspacePath || session.cwd || 'unknown'
    const list = map.get(key) ?? []
    list.push(session)
    map.set(key, list)
  }
  return Array.from(map.entries()).map(([key, list]) => ({
    key,
    label: groupBy === 'time' ? key : (list[0]?.workspaceName ?? key),
    sessions: list,
  }))
}

export function formatRelativeTime(value: string): string {
  const diff = Date.now() - new Date(value).getTime()
  // Every comparison below is false for NaN, so an unparseable timestamp used
  // to fall through to the month branch and render as "NaNmo".
  if (!Number.isFinite(diff)) return 'unknown'
  // A timestamp in the future lands here as a negative and reads 'now' too.
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  return `${months}mo`
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m tok`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k tok`
  return `${value} tok`
}

export function formatCurrency(value: number): string {
  return `$${value >= 1 ? value.toFixed(2) : value.toFixed(4)}`
}

/**
 * Compact display name for a Pi model ID.
 * claude-sonnet-4-6 → "sonnet 4.6"
 * claude-haiku-4-5  → "haiku 4.5"
 * claude-opus-4     → "opus 4"
 * gpt-4o            → "gpt-4o"
 * gemini-2.5-pro    → "gemini-2.5"
 *
 * The registry spells the same family three ways, so all of these compact to
 * "sonnet 4.5": `claude-sonnet-4-5`, `claude-sonnet-4.5` (OpenRouter-style
 * aliases) and `claude-sonnet-4-5-20250929` (the dated Anthropic/Bedrock IDs).
 */
export function formatModelName(modelId: string): string {
  if (!modelId) return ''
  // claude-<name>-<major>[-|.]<minor> with an optional -YYYYMMDD release date
  const claude = modelId.match(/^claude-([a-z]+)-(\d+)(?:[.-](\d{1,7}))?(?:-\d{8})?$/)
  if (claude)
    return claude[3] ? `${claude[1]} ${claude[2]}.${claude[3]}` : `${claude[1]} ${claude[2]}`
  // gemini-2.5-pro → gemini-2.5
  const gemini = modelId.match(/^(gemini-[\d.]+)/)
  if (gemini) return gemini[1]
  // Strip provider prefixes like anthropic/ or google/
  return modelId.replace(/^(anthropic|google|openai)\//, '')
}

function timeGroup(value: string): string {
  const date = new Date(value)
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const days = Math.floor((startOfToday - startOfDate) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return 'This week'
  if (days < 30) return 'This month'
  return 'Older'
}
