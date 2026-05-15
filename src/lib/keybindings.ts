export type KeybindingCategory =
  | 'general'
  | 'session'
  | 'model'
  | 'navigation'
  | 'terminal'
  | 'prompt'

export const KEYBINDING_ACTION_IDS = [
  'toggleSidebar',
  'toggleGitPanel',
  'toggleFileTree',
  'openCustomizations',
  'openCommandPalette',
  'openFileSearch',
  'openProject',
  'archiveSession',
  'compactSession',
  'forkFromMessage',
  'newSession',
  'nextMessage',
  'nextSession',
  'nextUnreadSession',
  'previousMessage',
  'previousSession',
  'previousUnreadSession',
  'shareSession',
  'stopAutoAcceptingPermissions',
  'renameSession',
  'toggleSteps',
  'interruptAgent',
  'chooseModel',
  'cycleThinkingEffort',
  'goBack',
  'goForward',
  'addFiles',
  'openFile',
  'closeFileTab',
  'searchInFile',
  'toggleTerminal',
  'newTerminal',
  'focusComposer',
  'sendPrompt',
  'submitPrompt',
  'newlineInPrompt',
  'toggleShellMode',
  'clearInput',
] as const

export type KeybindingActionId = (typeof KEYBINDING_ACTION_IDS)[number]

export type KeybindingOverrides = Partial<Record<KeybindingActionId, string>>

export interface KeybindingDef {
  id: KeybindingActionId
  label: string
  description: string
  category: KeybindingCategory
  defaultKeys: string
}

export interface KeybindingEntry extends KeybindingDef {
  keys: string
  isModified: boolean
}

export const KEYBINDINGS_PREF_KEY = 'keybindings.overrides'
export const KEYBINDINGS_CHANGED_EVENT = 'openpi:keybindings-changed'
const LEGACY_LOCAL_STORAGE_KEY = 'openpi-keybindings'

export const CATEGORY_LABELS: Record<KeybindingCategory, string> = {
  general: 'General',
  session: 'Session',
  navigation: 'Navigation',
  terminal: 'Terminal',
  prompt: 'Prompt',
  model: 'Model and Agent',
}

export const CATEGORY_ORDER: KeybindingCategory[] = [
  'general',
  'session',
  'model',
  'navigation',
  'terminal',
  'prompt',
]

export const KEYBINDING_CONFIG = {
  toggleSidebar: {
    label: 'Toggle Sidebar',
    description: 'Show or hide the session sidebar',
    category: 'general',
    defaultKeys: 'Cmd+B',
  },
  toggleGitPanel: {
    label: 'Toggle Git Panel',
    description: 'Show or hide the source control panel',
    category: 'general',
    defaultKeys: 'Shift+Cmd+G',
  },
  toggleFileTree: {
    label: 'Toggle File Tree',
    description: 'Show or hide the file tree in the sidebar',
    category: 'general',
    defaultKeys: 'Cmd+\\',
  },
  openCustomizations: {
    label: 'Open Customizations',
    description: 'Open the customizations modal',
    category: 'general',
    defaultKeys: 'Cmd+,',
  },
  openCommandPalette: {
    label: 'Command Palette',
    description: 'Search files, commands, and sessions',
    category: 'general',
    defaultKeys: 'Shift+Cmd+P',
  },
  openFileSearch: {
    label: 'Open File Search',
    description: 'Search and navigate files in the workspace',
    category: 'general',
    defaultKeys: 'Shift+Cmd+F',
  },
  openProject: {
    label: 'Open Project',
    description: 'Pick a new workspace / open project folder',
    category: 'general',
    defaultKeys: 'Cmd+O',
  },
  archiveSession: {
    label: 'Archive Session',
    description: 'Archive the current session',
    category: 'session',
    defaultKeys: 'Shift+Cmd+Backspace',
  },
  compactSession: {
    label: 'Compact Session',
    description: 'Compact the current conversation context',
    category: 'session',
    defaultKeys: 'Unassigned',
  },
  forkFromMessage: {
    label: 'Fork from Message',
    description: 'Create a session branch from the selected message',
    category: 'session',
    defaultKeys: 'Unassigned',
  },
  newSession: {
    label: 'New Session',
    description: 'Start a new agent session',
    category: 'session',
    defaultKeys: 'Shift+Cmd+S',
  },
  nextMessage: {
    label: 'Next Message',
    description: 'Move to the next message in the session',
    category: 'session',
    defaultKeys: 'Alt+Cmd+]',
  },
  nextSession: {
    label: 'Next Session',
    description: 'Switch to the next session',
    category: 'session',
    defaultKeys: 'Alt+Down',
  },
  nextUnreadSession: {
    label: 'Next Unread Session',
    description: 'Switch to the next unread session',
    category: 'session',
    defaultKeys: 'Alt+Shift+Down',
  },
  previousMessage: {
    label: 'Previous Message',
    description: 'Move to the previous message in the session',
    category: 'session',
    defaultKeys: 'Alt+Cmd+[',
  },
  previousSession: {
    label: 'Previous Session',
    description: 'Switch to the previous session',
    category: 'session',
    defaultKeys: 'Alt+Up',
  },
  previousUnreadSession: {
    label: 'Previous Unread Session',
    description: 'Switch to the previous unread session',
    category: 'session',
    defaultKeys: 'Alt+Shift+Up',
  },
  shareSession: {
    label: 'Share Session',
    description: 'Share the current session',
    category: 'session',
    defaultKeys: 'Unassigned',
  },
  stopAutoAcceptingPermissions: {
    label: 'Stop Auto-Accepting Permissions',
    description: 'Stop automatically accepting permission prompts',
    category: 'session',
    defaultKeys: 'Shift+Cmd+A',
  },
  renameSession: {
    label: 'Rename Session',
    description: 'Rename the current session',
    category: 'session',
    defaultKeys: 'Shift+Cmd+R',
  },
  toggleSteps: {
    label: 'Toggle Steps',
    description: 'Show or hide session step details',
    category: 'session',
    defaultKeys: 'Cmd+E',
  },
  interruptAgent: {
    label: 'Interrupt / Stop Agent',
    description: 'Stop the currently running agent (Pi app.interrupt)',
    category: 'session',
    defaultKeys: 'Escape',
  },
  chooseModel: {
    label: 'Choose Model',
    description: 'Open the model selection dropdown',
    category: 'model',
    defaultKeys: "Cmd+'",
  },
  cycleThinkingEffort: {
    label: 'Cycle Thinking Effort',
    description: 'Cycle through thinking effort levels (off, minimal, low, medium, high, xhigh)',
    category: 'model',
    defaultKeys: 'Shift+Cmd+D',
  },
  goBack: {
    label: 'Navigate Back',
    description: 'Go back to the previous conversation state',
    category: 'navigation',
    defaultKeys: 'Alt+Left',
  },
  goForward: {
    label: 'Navigate Forward',
    description: 'Go forward in conversation history',
    category: 'navigation',
    defaultKeys: 'Alt+Right',
  },
  addFiles: {
    label: 'Add Files',
    description: 'Add files to the conversation context',
    category: 'navigation',
    defaultKeys: 'Cmd+/',
  },
  openFile: {
    label: 'Open File',
    description: 'Quick-open a file from the workspace',
    category: 'navigation',
    defaultKeys: 'Cmd+K',
  },
  closeFileTab: {
    label: 'Close File Tab',
    description: 'Close the active file tab in the file pane',
    category: 'navigation',
    defaultKeys: 'Cmd+W',
  },
  searchInFile: {
    label: 'Search in File',
    description: 'Open find bar in the active file pane',
    category: 'navigation',
    defaultKeys: 'Cmd+F',
  },
  toggleTerminal: {
    label: 'Toggle Terminal',
    description: 'Show or hide the terminal panel',
    category: 'terminal',
    defaultKeys: 'Cmd+J',
  },
  newTerminal: {
    label: 'New Terminal',
    description: 'Open a new terminal tab',
    category: 'terminal',
    defaultKeys: 'Shift+Cmd+T',
  },
  focusComposer: {
    label: 'Focus Composer',
    description: 'Move focus to the prompt input',
    category: 'prompt',
    defaultKeys: 'Cmd+L',
  },
  sendPrompt: {
    label: 'Send as Prompt',
    description: 'Send the current input as a prompt to the agent',
    category: 'prompt',
    defaultKeys: 'Shift+Cmd+E',
  },
  submitPrompt: {
    label: 'Submit Prompt',
    description: 'Send the current prompt to the agent',
    category: 'prompt',
    defaultKeys: 'Enter',
  },
  newlineInPrompt: {
    label: 'Newline in Prompt',
    description: 'Insert a newline without submitting',
    category: 'prompt',
    defaultKeys: 'Shift+Enter',
  },
  toggleShellMode: {
    label: 'Toggle Shell Mode',
    description: 'Switch between regular prompt and shell input mode',
    category: 'prompt',
    defaultKeys: 'Shift+Cmd+X',
  },
  clearInput: {
    label: 'Clear Input',
    description: 'Clear the composer input without submitting',
    category: 'prompt',
    defaultKeys: 'Ctrl+C',
  },
} satisfies Record<KeybindingActionId, Omit<KeybindingDef, 'id'>>

export const DEFAULT_KEYBINDINGS: KeybindingDef[] = KEYBINDING_ACTION_IDS.map((id) => ({
  id,
  ...KEYBINDING_CONFIG[id],
}))

export function splitKeyCombo(keys: string): string[] {
  return keys.split('+').map((k) => k.trim())
}

export function normalizeBinding(keys: string): string {
  if (keys === 'Unassigned') return keys

  const parts = splitKeyCombo(keys)
  const key = parts.at(-1) ?? ''
  const modifiers = new Set(parts.slice(0, -1))
  const orderedModifiers = ['Ctrl', 'Alt', 'Shift', 'Cmd'].filter((modifier) =>
    modifiers.has(modifier)
  )

  return [...orderedModifiers, key].join('+')
}

export function formatKeyLabel(keys: string): string {
  return keys
    .replace(/Ctrl/g, '⌃')
    .replace(/Shift/g, '⇧')
    .replace(/Alt/g, '⌥')
    .replace(/Cmd/g, '⌘')
    .replace(/Escape/g, 'Esc')
    .replace(/Enter/g, '↵')
    .replace(/Backspace/g, '⌫')
    .replace(/Delete/g, '⌦')
    .replace(/Tab/g, '⇥')
    .replace(/Arrow/g, '')
}

export function keyEventToBinding(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'CapsLock', 'Fn'].includes(e.key)) return null

  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  if (e.metaKey) parts.push('Cmd')

  const keyMap: Record<string, string> = {
    Escape: 'Escape',
    Enter: 'Enter',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Tab: 'Tab',
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    '`': '`',
    ',': ',',
    '.': '.',
    "'": "'",
    '/': '/',
    '\\': '\\',
    '[': '[',
    ']': ']',
  }

  const mappedKey = keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key)
  parts.push(mappedKey)

  if (parts.length === 1 && !['Escape', 'Enter'].includes(mappedKey)) return null
  return parts.join('+')
}

export function isKeybindingActionId(id: string): id is KeybindingActionId {
  return (KEYBINDING_ACTION_IDS as readonly string[]).includes(id)
}

function sanitizeKeybindingOverrides(bindings: Record<string, string>): KeybindingOverrides {
  return Object.fromEntries(
    Object.entries(bindings).filter(([id]) => isKeybindingActionId(id))
  ) as KeybindingOverrides
}

export function buildKeybindingEntries(customBindings: KeybindingOverrides): KeybindingEntry[] {
  return DEFAULT_KEYBINDINGS.map((binding) => {
    const customKeys = customBindings[binding.id]
    return {
      ...binding,
      keys: customKeys ?? binding.defaultKeys,
      isModified: Boolean(
        customKeys && normalizeBinding(customKeys) !== normalizeBinding(binding.defaultKeys)
      ),
    }
  })
}

export function findBinding(
  entries: KeybindingEntry[],
  actionId: KeybindingActionId
): string | null {
  return entries.find((entry) => entry.id === actionId)?.keys ?? null
}

export function eventMatchesBinding(e: KeyboardEvent, binding: string | null | undefined): boolean {
  if (!binding || binding === 'Unassigned') return false
  const eventBinding = keyEventToBinding(e)
  return eventBinding !== null && normalizeBinding(eventBinding) === normalizeBinding(binding)
}

function parseCustomKeybindings(raw: string | null): Record<string, string> {
  if (!raw) return {}

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string'
      )
    )
  } catch {
    return {}
  }
}

export async function loadCustomKeybindings(): Promise<KeybindingOverrides> {
  const raw = await window.openpi.getPref(KEYBINDINGS_PREF_KEY)
  const persisted = sanitizeKeybindingOverrides(parseCustomKeybindings(raw))
  if (Object.keys(persisted).length > 0) return persisted

  const legacy = sanitizeKeybindingOverrides(
    parseCustomKeybindings(localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY))
  )
  if (Object.keys(legacy).length > 0) {
    await window.openpi.setPref(KEYBINDINGS_PREF_KEY, JSON.stringify(legacy))
  }
  return legacy
}

export async function saveCustomKeybindings(bindings: KeybindingOverrides): Promise<void> {
  const next = sanitizeKeybindingOverrides(bindings)
  await window.openpi.setPref(KEYBINDINGS_PREF_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent(KEYBINDINGS_CHANGED_EVENT, { detail: next }))
}
