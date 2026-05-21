import { createMemo, createSignal, onMount } from 'solid-js'
import {
  type AppearancePreferences,
  applyAppearancePreferences,
  DEFAULT_APPEARANCE_PREFERENCES,
  loadAppearancePreferences,
  sanitizeFontPreference,
  saveAppearancePreference,
} from '../../lib/appearancePreferences'

interface UseAppearancePrefsConfig {
  onError: (message: string) => void
  markSaved: (key: keyof AppearancePreferences) => void
}

export function useAppearancePrefs(config: UseAppearancePrefsConfig) {
  const [appearance, setAppearance] = createSignal<AppearancePreferences>({
    ...DEFAULT_APPEARANCE_PREFERENCES,
  })

  onMount(() => {
    void loadAppearancePreferences()
      .then((appearancePrefs) => {
        setAppearance(appearancePrefs)
        applyAppearancePreferences(appearancePrefs)
      })
      .catch((err) => config.onError(err instanceof Error ? err.message : String(err)))
  })

  const saveAppearance = <K extends keyof AppearancePreferences>(
    key: K,
    rawValue: AppearancePreferences[K]
  ) => {
    const value =
      key === 'uiFont' || key === 'codeFont' || key === 'terminalFont'
        ? (sanitizeFontPreference(String(rawValue)) as AppearancePreferences[K])
        : rawValue

    setAppearance((prev) => {
      const next = { ...prev, [key]: value }
      applyAppearancePreferences(next)
      return next
    })
    saveAppearancePreference(key, value)
      .then(() => config.markSaved(key))
      .catch((err) => config.onError(err instanceof Error ? err.message : String(err)))
  }

  const resetAppearance = (key: keyof AppearancePreferences) => {
    saveAppearance(key, DEFAULT_APPEARANCE_PREFERENCES[key])
  }

  const appearanceRows = createMemo(() => [
    {
      key: 'colorScheme' as const,
      label: 'Color scheme',
      description: 'Choose whether OpenPi follows the system, light, or dark interface scheme',
      value: appearance().colorScheme,
      defaultValue: DEFAULT_APPEARANCE_PREFERENCES.colorScheme,
      control: 'scheme' as const,
    },
    {
      key: 'uiFont' as const,
      label: 'UI font',
      description: 'Font family used throughout the interface',
      value: appearance().uiFont,
      defaultValue: DEFAULT_APPEARANCE_PREFERENCES.uiFont,
      placeholder: 'System Sans',
      control: 'font' as const,
    },
    {
      key: 'codeFont' as const,
      label: 'Code font',
      description: 'Font family used in code blocks, diffs, and inline code',
      value: appearance().codeFont,
      defaultValue: DEFAULT_APPEARANCE_PREFERENCES.codeFont,
      placeholder: 'System Mono',
      control: 'font' as const,
    },
    {
      key: 'terminalFont' as const,
      label: 'Terminal font',
      description: 'Font family used by xterm shells; Nerd Font symbols stay in the fallback stack',
      value: appearance().terminalFont,
      defaultValue: DEFAULT_APPEARANCE_PREFERENCES.terminalFont,
      placeholder: 'JetBrainsMono Nerd Font Mono',
      control: 'font' as const,
    },
  ])

  return {
    appearanceRows,
    saveAppearance,
    resetAppearance,
  }
}
