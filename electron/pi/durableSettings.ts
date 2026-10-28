import type { ModelThinkingLevel } from '@earendil-works/pi-ai'
import type { DurableHarness } from './durable/types'
import type { SessionReadyPayload, SidecarCommand } from './sidecarTypes'

/**
 * Phase 8.3j: `set_model`, `set_thinking` and `set_session_name` on a durable session.
 *
 * Same observable behavior as the SDK path: an unknown model is ignored, the user's choice is
 * persisted as the default, and the sidebar learns of a rename. The difference is that an
 * unsupported thinking level is refused with a log line instead of being silently clamped.
 */

export type ResolvedModel = {
  info: NonNullable<SessionReadyPayload['model']>
  /** Levels this model supports, in pi-ai's order. */
  thinkingLevels: readonly ModelThinkingLevel[]
}

export interface SettingsDeps {
  resolveModel: (provider: string, modelId: string) => Promise<ResolvedModel | undefined>
  log: (level: 'info' | 'warn' | 'error', text: string) => void
}

/** Save a choice as the user's default, as the SDK's `persist: true` does; bound to the session's settings. */
export interface SettingsPersist {
  model: (provider: string, modelId: string) => void
  thinking: (level: ModelThinkingLevel) => void
}

/** The slice of an active session these commands read and update. */
export interface SettingsTarget {
  harness: DurableHarness
  model: SessionReadyPayload['model']
  thinkingLevel: string | null
  thinkingLevels: readonly ModelThinkingLevel[]
  sessionName: string | null
  persist: SettingsPersist
}

type SettingsCommand = Extract<
  SidecarCommand,
  { type: 'set_model' | 'set_thinking' | 'set_session_name' }
>

export function isSettingsCommand(cmd: SidecarCommand): cmd is SettingsCommand {
  return cmd.type === 'set_model' || cmd.type === 'set_thinking' || cmd.type === 'set_session_name'
}

/** Persisting is a convenience; a failed write must not undo a change that already took effect. */
function persistQuietly(deps: SettingsDeps, what: string, save: () => void): void {
  try {
    save()
  } catch (error) {
    deps.log(
      'warn',
      `[durable] could not save ${what}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

export async function applySettingsCommand(
  cmd: SettingsCommand,
  session: SettingsTarget,
  deps: SettingsDeps,
  afterChange: () => Promise<void>
): Promise<void> {
  if (cmd.type === 'set_model') {
    const resolved = await deps.resolveModel(cmd.provider, cmd.modelId)
    if (!resolved) {
      deps.log(
        'warn',
        `[durable] unknown model ${cmd.provider}/${cmd.modelId}; keeping the current one`
      )
      return
    }
    await session.harness.configure({ model: { provider: cmd.provider, modelId: cmd.modelId } })
    session.model = resolved.info
    session.thinkingLevels = resolved.thinkingLevels
    persistQuietly(deps, 'the default model', () =>
      session.persist.model(cmd.provider, cmd.modelId)
    )
    return
  }
  if (cmd.type === 'set_thinking') {
    const level = session.thinkingLevels.find((candidate) => candidate === cmd.level)
    if (level === undefined) {
      deps.log('warn', `[durable] thinking level '${cmd.level}' is not supported by this model`)
      return
    }
    await session.harness.configure({ thinkingLevel: level })
    session.thinkingLevel = level
    persistQuietly(deps, 'the default thinking level', () => session.persist.thinking(level))
    return
  }
  const name = cmd.name.trim()
  await session.harness.setSessionName(name)
  session.sessionName = name === '' ? session.sessionName : name
  await afterChange()
}
