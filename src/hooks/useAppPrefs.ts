import type { Setter } from 'solid-js'
import { applyAppearancePreferences, loadAppearancePreferences } from '../lib/appearancePreferences'
import type { DisplayPreferences } from '../lib/displayPreferences'
import {
  DISPLAY_PREFERENCES_CHANGED_EVENT,
  loadDisplayPreferences,
} from '../lib/displayPreferences'
import type { AppInfo } from '../lib/ipc'
import type { KeybindingOverrides } from '../lib/keybindings'
import { KEYBINDINGS_CHANGED_EVENT, loadCustomKeybindings } from '../lib/keybindings'
import { restoreThemeFromStorage } from '../lib/themeApply'

interface UseAppPrefsOptions {
  setAppInfo: Setter<AppInfo | null>
  setDisplayPreferences: Setter<DisplayPreferences>
  setCustomKeybindings: Setter<KeybindingOverrides>
}

export function useAppPrefs(options: UseAppPrefsOptions) {
  const setupOnMount = (): (() => void) => {
    restoreThemeFromStorage()
    window.openpi
      .getAppInfo()
      .then(options.setAppInfo)
      .catch(() => {})
    loadAppearancePreferences()
      .then(applyAppearancePreferences)
      .catch(() => {})

    loadDisplayPreferences()
      .then(options.setDisplayPreferences)
      .catch(() => {})
    loadCustomKeybindings()
      .then(options.setCustomKeybindings)
      .catch(() => {})

    const onDisplayPreferencesChanged = (event: Event) => {
      options.setDisplayPreferences((event as CustomEvent<DisplayPreferences>).detail)
    }
    window.addEventListener(DISPLAY_PREFERENCES_CHANGED_EVENT, onDisplayPreferencesChanged)

    const onKeybindingsChanged = (event: Event) => {
      options.setCustomKeybindings((event as CustomEvent<KeybindingOverrides>).detail)
    }
    window.addEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)

    return () => {
      window.removeEventListener(DISPLAY_PREFERENCES_CHANGED_EVENT, onDisplayPreferencesChanged)
      window.removeEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)
    }
  }

  return { setupOnMount }
}
