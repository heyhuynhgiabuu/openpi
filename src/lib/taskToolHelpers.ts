/** Mirrors `@heyhuynhgiabuu/pi-task` tool `details` / receipt shapes. */
import type { SlashCommandItem } from './ipc'

export interface TaskToolDetails {
  task_id?: string
  agent_type?: string
  description?: string
  phase?: 'done' | 'failed' | 'cancelled' | string
  background?: boolean
  tool_uses?: number
  toolCalls?: number
  duration_ms?: number
  conversation_id?: string
  tmux_session?: string
}

export function parseTaskDetails(
  args: Record<string, unknown>,
  details?: Record<string, unknown>
): TaskToolDetails {
  const d = details ?? {}
  return {
    task_id: typeof d.task_id === 'string' ? d.task_id : undefined,
    agent_type:
      typeof d.agent_type === 'string'
        ? d.agent_type
        : typeof args.agent_type === 'string'
          ? args.agent_type
          : undefined,
    description:
      typeof d.description === 'string'
        ? d.description
        : typeof args.description === 'string'
          ? args.description
          : undefined,
    phase: typeof d.phase === 'string' ? d.phase : undefined,
    background: typeof d.background === 'boolean' ? d.background : args.background !== false,
    tool_uses:
      typeof d.tool_uses === 'number'
        ? d.tool_uses
        : typeof d.toolCalls === 'number'
          ? d.toolCalls
          : undefined,
    duration_ms: typeof d.duration_ms === 'number' ? d.duration_ms : undefined,
    conversation_id: typeof d.conversation_id === 'string' ? d.conversation_id : undefined,
    tmux_session: typeof d.tmux_session === 'string' ? d.tmux_session : undefined,
  }
}

export function formatTaskDurationMs(ms: number): string {
  if (ms >= 60_000) {
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1_000)}s`
  }
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(1)}s`
  return `${ms}ms`
}

/** Foreground task from args; pi-task defaults background to true when omitted. */
export function isTaskForeground(args: Record<string, unknown>): boolean {
  return args.background === false
}

/** End event is a background handoff receipt, not final subagent output. */
/**
 * pi-task exposes task control as the user command `/task cancel <id>`, not as a
 * tool. Returns null when Pi does not report that command: sending an unknown
 * slash text would hand it to the model as an ordinary prompt instead.
 */
export function taskCancelCommand(taskId: string, commands: SlashCommandItem[]): string | null {
  return commands.some((command) => command.name === 'task') ? `/task cancel ${taskId}` : null
}

export function isBackgroundHandoff(
  details: TaskToolDetails,
  output: string,
  streaming: boolean
): boolean {
  if (streaming) return false
  if (details.background === true && !details.phase) return true
  if (details.phase) return false
  const lower = output.toLowerCase()
  return (
    lower.includes('started task') ||
    lower.includes('sdk backend') ||
    lower.includes('completion notification') ||
    lower.includes('do not poll')
  )
}

export function parseStreamingToolCount(output: string): number | undefined {
  const m = output.match(/(\d+)\s+tool\s*calls?/i)
  if (m) return Number.parseInt(m[1], 10)
  return undefined
}

export function taskResultPreview(text: string, max = 120): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  const oneLine = trimmed.split('\n')[0] ?? trimmed
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine
}

/**
 * pi-task only accepts IDs it generated itself (short base-36 + short suffix)
 * or a user-supplied conversation_id. Full or partial UUIDs are invalid.
 */
export function isValidPiTaskId(id: string | undefined): boolean {
  if (!id) return false
  // Reject anything that looks like a UUID (multiple hyphens or standard 8-4-4-4-12 pattern)
  if (id.split('-').length > 2) return false
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false
  // Strict pi-task generated format (one hyphen, short suffix)
  if (/^[0-9a-z]+-[0-9a-z]{3,8}$/i.test(id)) return true
  // conversation_id style (user-controlled, 1-80 safe chars)
  if (/^[A-Za-z0-9._-]{1,80}$/.test(id)) return true
  return false
}
