import type { SidecarCommand } from './sidecarTypes'

const replacementTypes: ReadonlySet<SidecarCommand['type']> = new Set([
  'start_session',
  'reload_session',
  'fork_session',
  'stop',
])

const interruptTypes: ReadonlySet<SidecarCommand['type']> = new Set([
  'prompt',
  'steer',
  'follow_up',
  'abort',
])

const unblockTypes: ReadonlySet<SidecarCommand['type']> = new Set([
  'resolve_provider_prompt',
  'extension_ui_response',
])

export function createSidecarCommandQueue(
  run: (command: SidecarCommand) => Promise<void>
): (command: SidecarCommand) => Promise<void> {
  let replacementTail = Promise.resolve()
  const activeResultCommands = new Set<Promise<void>>()

  return (command) => {
    if (replacementTypes.has(command.type)) {
      const next = replacementTail.then(async () => {
        await Promise.allSettled([...activeResultCommands])
        await run(command)
      })
      replacementTail = next.catch(() => undefined)
      return next
    }

    if (unblockTypes.has(command.type)) return run(command)

    const runAfterReplacement = async () => {
      const execution = run(command)
      if (interruptTypes.has(command.type)) return execution
      activeResultCommands.add(execution)
      try {
        await execution
      } finally {
        activeResultCommands.delete(execution)
      }
    }
    return replacementTail.then(runAfterReplacement)
  }
}
