export interface CoreSlashCommand {
  id: string
  /** Slash name without the leading slash (e.g. "compact", "name"). */
  slash: string
  /** Display name including the leading slash (e.g. "/compact"). */
  name: string
  description: string
  argHint?: string
  category: 'session' | 'model' | 'settings' | 'system'
  /** Run the command. Returning true means handled; false means fall back to session.prompt. */
  onSelect: (arg: string) => boolean | undefined
}

export interface CoreCommandContext {
  sessionReady: boolean
  onCompact: (customInstructions?: string) => Promise<void> | void
  onReload: () => Promise<void> | void
  onCopyLast: () => Promise<string | null> | string | null
  onOpenModelPicker: () => void
  onOpenSettings: () => void
  onOpenLogin: (provider?: string) => void
  onLogout: (provider?: string) => void
  onNewSession: () => void
  onOpenResumeDialog: () => void
  onCycleThinking: () => void
  onCycleModel: () => void
  onSetSessionName: (name: string) => Promise<void> | void
  onShowSessionInfo: () => Promise<void> | void
  onShowError: (message: string) => void
}

/**
 * Build the catalog of slash commands OpenPi itself understands and can
 * execute. Pattern follows opencode's `CommandOption` registry: each command
 * is a self-contained { id, slash, onSelect } that is registered once and
 * shows up in the slash picker.
 *
 * Extension commands (loaded from Pi via IPC) and prompt templates are merged
 * separately by `useComposerPickers`. The order in the picker is:
 *   1. coreCommands (this list)
 *   2. extension commands
 *   3. prompt templates
 */
export function buildCoreSlashCommands(ctx: CoreCommandContext): CoreSlashCommand[] {
  return [
    {
      id: 'session.compact',
      slash: 'compact',
      name: '/compact',
      description: 'Manually compact session context (optionally with instructions)',
      argHint: '[instructions]',
      category: 'session',
      onSelect: (arg) => {
        if (!ctx.sessionReady) {
          ctx.onShowError('No active session.')
          return true
        }
        void ctx.onCompact(arg.trim() || undefined)
        return true
      },
    },
    {
      id: 'session.name',
      slash: 'name',
      name: '/name',
      description: 'Set the display name for the current session',
      argHint: '<name>',
      category: 'session',
      onSelect: (arg) => {
        if (!ctx.sessionReady) {
          ctx.onShowError('No active session.')
          return true
        }
        const name = arg.trim()
        if (!name) {
          ctx.onShowError('Usage: /name <name>')
          return true
        }
        void ctx.onSetSessionName(name)
        return true
      },
    },
    {
      id: 'session.info',
      slash: 'session',
      name: '/session',
      description: 'Show the active session file, ID, and stats',
      category: 'session',
      onSelect: () => {
        if (!ctx.sessionReady) {
          ctx.onShowError('No active session.')
          return true
        }
        void ctx.onShowSessionInfo()
        return true
      },
    },
    {
      id: 'session.reload',
      slash: 'reload',
      name: '/reload',
      description: 'Reload extensions, skills, prompts, and themes',
      category: 'session',
      onSelect: () => {
        if (!ctx.sessionReady) {
          ctx.onShowError('No active session.')
          return true
        }
        void ctx.onReload()
        return true
      },
    },
    {
      id: 'session.copy',
      slash: 'copy',
      name: '/copy',
      description: 'Copy the last assistant message to the clipboard',
      category: 'session',
      onSelect: () => {
        if (!ctx.sessionReady) {
          ctx.onShowError('No active session.')
          return true
        }
        const text = ctx.onCopyLast()
        if (text instanceof Promise) {
          void text.then((value) => {
            if (!value) ctx.onShowError('No assistant message to copy yet.')
          })
        } else if (!text) {
          ctx.onShowError('No assistant message to copy yet.')
        }
        return true
      },
    },
    {
      id: 'session.new',
      slash: 'new',
      name: '/new',
      description: 'Start a new session',
      category: 'session',
      onSelect: () => {
        ctx.onNewSession()
        return true
      },
    },
    {
      id: 'session.resume',
      slash: 'resume',
      name: '/resume',
      description: 'Resume an existing session',
      category: 'session',
      onSelect: () => {
        ctx.onOpenResumeDialog()
        return true
      },
    },
    {
      id: 'session.cycleModel',
      slash: 'scoped-models',
      name: '/scoped-models',
      description: 'Cycle the active model',
      category: 'model',
      onSelect: () => {
        if (!ctx.sessionReady) {
          ctx.onShowError('No active session.')
          return true
        }
        ctx.onCycleModel()
        return true
      },
    },
    {
      id: 'model.list',
      slash: 'model',
      name: '/model',
      description: 'Open the model picker',
      category: 'model',
      onSelect: () => {
        ctx.onOpenModelPicker()
        return true
      },
    },
    {
      id: 'model.cycleThinking',
      slash: 'thinking',
      name: '/thinking',
      description: 'Cycle the thinking level',
      category: 'model',
      onSelect: () => {
        if (!ctx.sessionReady) {
          ctx.onShowError('No active session.')
          return true
        }
        ctx.onCycleThinking()
        return true
      },
    },
    {
      id: 'settings.open',
      slash: 'settings',
      name: '/settings',
      description: 'Open settings',
      category: 'settings',
      onSelect: () => {
        ctx.onOpenSettings()
        return true
      },
    },
    {
      id: 'auth.login',
      slash: 'login',
      name: '/login',
      description: 'Configure provider authentication',
      argHint: '<provider>',
      category: 'settings',
      onSelect: (arg) => {
        const provider = arg.trim() || undefined
        ctx.onOpenLogin(provider)
        return true
      },
    },
    {
      id: 'auth.logout',
      slash: 'logout',
      name: '/logout',
      description: 'Remove a provider authentication',
      argHint: '<provider>',
      category: 'settings',
      onSelect: (arg) => {
        const provider = arg.trim() || undefined
        ctx.onLogout(provider)
        return true
      },
    },
  ]
}

export function findCoreCommand(
  list: CoreSlashCommand[],
  invocation: string
): CoreSlashCommand | null {
  return list.find((cmd) => cmd.slash === invocation) ?? null
}
