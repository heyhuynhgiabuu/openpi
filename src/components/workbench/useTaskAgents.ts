/**
 * Task-agent @mention catalog: pi-task owns definitions, precedence and tool
 * policy; the composer only displays what the task tool could actually run.
 * Empty when pi-task is not installed. Keyed on cwd so a workspace switch
 * refetches; main owns the discovery root.
 */

import { createEffect, createSignal, onCleanup, type Accessor } from 'solid-js'
import type { AgentMentionOption } from '../composer/useComposerPickers'

export function useTaskAgents(cwd: Accessor<string>) {
  const [taskAgents, setTaskAgents] = createSignal<AgentMentionOption[]>([])

  createEffect(() => {
    void cwd()
    let cancelled = false
    void window.openpi
      .getTaskAgents()
      .then((agents) => {
        if (!cancelled) setTaskAgents(agents)
      })
      .catch(() => {
        if (!cancelled) setTaskAgents([])
      })
    onCleanup(() => {
      cancelled = true
    })
  })

  return taskAgents
}
