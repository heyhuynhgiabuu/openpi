export type DisplayPreferenceKey =
  | 'showReasoningSummaries'
  | 'expandShellToolParts'
  | 'expandEditToolParts'
  | 'showSessionProgressBar'
  | 'hideThinkingBlock'

export type DisplayPreferences = Record<DisplayPreferenceKey, boolean>

export type DisplayPreferenceMeta = {
  key: DisplayPreferenceKey
  storageKey: string
  label: string
  description: string
  defaultValue: boolean
}

export const DISPLAY_PREFERENCES: DisplayPreferenceMeta[] = [
  {
    key: 'showReasoningSummaries',
    storageKey: 'display.show_reasoning_summaries',
    label: 'Show reasoning summaries',
    description: 'Display model reasoning summaries in the timeline',
    defaultValue: true,
  },
  {
    key: 'expandShellToolParts',
    storageKey: 'display.expand_shell_tool_parts',
    label: 'Expand shell tool parts',
    description: 'Show shell tool parts expanded by default in the timeline',
    defaultValue: false,
  },
  {
    key: 'expandEditToolParts',
    storageKey: 'display.expand_edit_tool_parts',
    label: 'Expand edit tool parts',
    description: 'Show edit, write, and patch tool parts expanded by default in the timeline',
    defaultValue: false,
  },
  {
    key: 'showSessionProgressBar',
    storageKey: 'display.show_session_progress_bar',
    label: 'Show session progress bar',
    description:
      'Display the animated progress bar at the top of the session when the agent is working',
    defaultValue: true,
  },
  {
    key: 'hideThinkingBlock',
    storageKey: 'display.hide_thinking_block',
    label: 'Hide Thinking Block',
    description:
      'Hide the Thinking block by default. Use this if you find the agent\u2019s reasoning noisy and want a cleaner conversation view.',
    defaultValue: false,
  },
]

export const DEFAULT_DISPLAY_PREFERENCES = DISPLAY_PREFERENCES.reduce((acc, pref) => {
  acc[pref.key] = pref.defaultValue
  return acc
}, {} as DisplayPreferences)

export const DISPLAY_PREFERENCES_CHANGED_EVENT = 'openpi:display-preferences-changed'

export async function loadDisplayPreferences(): Promise<DisplayPreferences> {
  const entries = await Promise.all(
    DISPLAY_PREFERENCES.map(async (pref) => {
      const raw = await window.openpi.getPref(pref.storageKey)
      return [pref.key, raw == null || raw === '' ? pref.defaultValue : raw === 'true'] as const
    })
  )

  return entries.reduce(
    (acc, [key, value]) => {
      acc[key] = value
      return acc
    },
    { ...DEFAULT_DISPLAY_PREFERENCES }
  )
}
