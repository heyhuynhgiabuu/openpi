/**
 * useExtensionTrackers — manages Pi extension tracker instances (tasks, ask, subagents).
 *
 * SolidJS hook encapsulating TaskTracker, AskTracker, and SubagentTracker lifecycle,
 * providing reactive signals derived from session events.
 */
import { batch, createSignal } from 'solid-js'
import {
  type AskState,
  AskTracker,
  SubagentTracker,
  TaskTracker,
  type TrackedAgent,
  type TrackedTask,
} from '../lib/extensionTrackers'

export interface SubagentNotification {
  id: string
  description: string
  status: 'completed' | 'failed'
  result?: string
}

export function useExtensionTrackers() {
  const _taskTracker = new TaskTracker()
  const _askTracker = new AskTracker()
  const _subagentTracker = new SubagentTracker()
  const _notifiedAgentIds = new Set<string>()

  const [tasks, setTasks] = createSignal<TrackedTask[]>([])
  const [askState, setAskState] = createSignal<AskState | null>(null)
  const [agents, setAgents] = createSignal<TrackedAgent[]>([])
  const [subagentNotification, setSubagentNotification] = createSignal<SubagentNotification | null>(
    null
  )

  const updateSnapshots = () => {
    batch(() => {
      setTasks(_taskTracker.snapshot())
      setAskState(_askTracker.snapshot())
      setAgents(_subagentTracker.snapshot())
    })
  }

  /** Dispatch a session event to the relevant tracker. Returns true if state changed. */
  const dispatchEvent = (event: Record<string, unknown>, eventType: string): boolean => {
    let changed = false

    if (eventType === 'openpi_subagent_update') {
      if (_subagentTracker.onSubagentUpdate(event)) {
        setAgents(_subagentTracker.snapshot())
      }

      const subEvent = event as {
        agent_id?: string
        status?: string
        background?: boolean
        description?: string
        result?: string
      }
      const agentStatus = subEvent.status
      if (
        subEvent.agent_id &&
        !_notifiedAgentIds.has(subEvent.agent_id) &&
        (agentStatus === 'completed' || agentStatus === 'failed')
      ) {
        _notifiedAgentIds.add(subEvent.agent_id)
        setSubagentNotification({
          id: subEvent.agent_id,
          description: String(subEvent.description ?? 'Agent task'),
          status: agentStatus as 'completed' | 'failed',
          result: subEvent.result,
        })
        // Auto-dismiss after 8 seconds
        setTimeout(() => setSubagentNotification(null), 8000)
      }
      return true
    }

    if (eventType === 'tool_execution_start') {
      const e = event as { toolCallId?: string; toolName?: string; args?: Record<string, unknown> }
      changed =
        _taskTracker.onToolStart(e.toolCallId ?? '', e.toolName ?? '', e.args ?? {}) || changed
      changed =
        _askTracker.onToolStart(e.toolCallId ?? '', e.toolName ?? '', e.args ?? {}) || changed
      changed =
        _subagentTracker.onToolStart(e.toolCallId ?? '', e.toolName ?? '', e.args ?? {}) || changed
    }

    if (eventType === 'tool_execution_end') {
      const e = event as {
        toolCallId?: string
        toolName?: string
        result?: unknown
        isError?: boolean
      }
      const id = e.toolCallId ?? ''
      const name = e.toolName ?? ''
      const result = typeof e.result === 'string' ? e.result : JSON.stringify(e.result ?? '')
      changed = _taskTracker.onToolEnd(id, name, result) || changed
      changed = _askTracker.onToolEnd(id, name, Boolean(e.isError)) || changed
      changed = _subagentTracker.onToolEnd(id, name, result, Boolean(e.isError)) || changed
    }

    if (changed) updateSnapshots()
    return changed
  }

  const clearFinished = () => {
    _subagentTracker.clearFinished()
    setAgents(_subagentTracker.snapshot())
  }

  const clearTasks = () => {
    _taskTracker.clear()
    setTasks([])
  }

  const clearAsk = () => {
    _askTracker.clear()
    setAskState(null)
  }

  const clearAll = () => {
    _taskTracker.clear()
    _askTracker.clear()
    _subagentTracker.clear()
    _notifiedAgentIds.clear()
    setSubagentNotification(null)
    setTasks([])
    setAskState(null)
    setAgents([])
  }

  return {
    tasks,
    askState,
    agents,
    subagentNotification,
    dismissSubagentNotification: () => setSubagentNotification(null),
    dispatchEvent,
    clearFinished,
    clearTasks,
    clearAsk,
    clearAll,
  }
}
