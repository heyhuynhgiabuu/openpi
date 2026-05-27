import { createSignal, onCleanup, onMount } from 'solid-js'
import type { AppearancePreferences } from '../../lib/appearancePreferences'
import {
  DEFAULT_DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES,
  DISPLAY_PREFERENCES_CHANGED_EVENT,
  type DisplayPreferenceKey,
  type DisplayPreferences,
  loadDisplayPreferences,
} from '../../lib/displayPreferences'
import type { PiUpdateCheckResult } from '../../lib/ipc'
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
  NOTIFICATION_PREFERENCES,
  type NotificationPreferenceKey,
  type NotificationPreferences,
} from '../../lib/notificationPreferences'
import {
  DEFAULT_SOUND_PREFERENCES,
  loadSoundPreferences,
  SOUND_PREFERENCES,
  type SoundEffectId,
  type SoundPreferenceKey,
  type SoundPreferences,
} from '../../lib/soundPreferences'
import {
  DEFAULT_UPDATE_PREFERENCES,
  loadUpdatePreferences,
  UPDATE_PREFERENCES,
  type UpdatePreferenceKey,
  type UpdatePreferences,
} from '../../lib/updatePreferences'
import type { GeneralPaneProps } from './generalPaneTypes'
import { useAppearancePrefs } from './useAppearancePrefs'

type SavedKey =
  | DisplayPreferenceKey
  | NotificationPreferenceKey
  | SoundPreferenceKey
  | UpdatePreferenceKey
  | keyof AppearancePreferences
  | 'theme'
  | 'diagnostics'
  | 'checkPiUpdate'
  | 'installPiUpdate'

export function useGeneralPaneState(props: GeneralPaneProps) {
  const [prefs, setPrefs] = createSignal<DisplayPreferences>({
    ...DEFAULT_DISPLAY_PREFERENCES,
  })
  const [notificationPrefs, setNotificationPrefs] = createSignal<NotificationPreferences>({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
  })
  const [soundPrefs, setSoundPrefs] = createSignal<SoundPreferences>({
    ...DEFAULT_SOUND_PREFERENCES,
  })
  const [updatePrefs, setUpdatePrefs] = createSignal<UpdatePreferences>({
    ...DEFAULT_UPDATE_PREFERENCES,
  })
  const [updateStatus, setUpdateStatus] = createSignal<PiUpdateCheckResult | null>(null)
  const [checkingUpdates, setCheckingUpdates] = createSignal(false)
  const [installingUpdate, setInstallingUpdate] = createSignal(false)
  const [installOutput, setInstallOutput] = createSignal<string | null>(null)
  const [diagnosticsOutput, setDiagnosticsOutput] = createSignal<string | null>(null)
  const [copyingDiagnostics, setCopyingDiagnostics] = createSignal(false)
  const [openSoundMenu, setOpenSoundMenu] = createSignal<SoundPreferenceKey | null>(null)
  const [savedKey, setSavedKey] = createSignal<SavedKey | null>(null)
  const [loading, setLoading] = createSignal(true)
  let savedTimer: ReturnType<typeof setTimeout> | undefined

  onMount(() => {
    void Promise.all([
      loadDisplayPreferences(),
      loadNotificationPreferences(),
      loadSoundPreferences(),
      loadUpdatePreferences(),
    ])
      .then(([displayPrefs, notificationPreferences, soundPreferences, updatePreferences]) => {
        setPrefs(displayPrefs)
        setNotificationPrefs(notificationPreferences)
        setSoundPrefs(soundPreferences)
        setUpdatePrefs(updatePreferences)
      })
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  })

  const closeSoundMenu = () => setOpenSoundMenu(null)

  const handleOutsideMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest('.osp-sound-picker')) return
    closeSoundMenu()
  }

  const handleSoundMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeSoundMenu()
  }

  document.addEventListener('mousedown', handleOutsideMouseDown)
  document.addEventListener('keydown', handleSoundMenuKeyDown)

  onCleanup(() => {
    if (savedTimer) clearTimeout(savedTimer)
    document.removeEventListener('mousedown', handleOutsideMouseDown)
    document.removeEventListener('keydown', handleSoundMenuKeyDown)
  })

  const markSaved = (key: SavedKey) => {
    setSavedKey(key)
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => setSavedKey(null), 1800)
  }

  const { appearanceRows, saveAppearance, resetAppearance } = useAppearancePrefs({
    onError: props.onError,
    markSaved,
  })

  const announceDisplayChange = (next: DisplayPreferences) => {
    window.dispatchEvent(new CustomEvent(DISPLAY_PREFERENCES_CHANGED_EVENT, { detail: next }))
  }

  const saveValue = (key: DisplayPreferenceKey, value: boolean) => {
    const meta = DISPLAY_PREFERENCES.find((item) => item.key === key)
    if (!meta) return

    setPrefs((prev) => {
      const next = { ...prev, [key]: value }
      announceDisplayChange(next)
      return next
    })

    void window.openpi
      .setPref(meta.storageKey, String(value))
      .then(() => markSaved(key))
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
  }

  const resetValue = (key: DisplayPreferenceKey) => {
    const meta = DISPLAY_PREFERENCES.find((item) => item.key === key)
    if (!meta) return
    saveValue(key, meta.defaultValue)
  }

  const saveNotificationValue = (key: NotificationPreferenceKey, value: boolean) => {
    const meta = NOTIFICATION_PREFERENCES.find((item) => item.key === key)
    if (!meta) return

    setNotificationPrefs((prev) => ({ ...prev, [key]: value }))

    void window.openpi
      .setPref(meta.storageKey, String(value))
      .then(() => markSaved(key))
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
  }

  const resetNotificationValue = (key: NotificationPreferenceKey) => {
    const meta = NOTIFICATION_PREFERENCES.find((item) => item.key === key)
    if (!meta) return
    saveNotificationValue(key, meta.defaultValue)
  }

  const saveSoundValue = (key: SoundPreferenceKey, value: SoundEffectId) => {
    const meta = SOUND_PREFERENCES.find((item) => item.key === key)
    if (!meta) return

    setSoundPrefs((prev) => ({ ...prev, [key]: value }))

    void window.openpi
      .setPref(meta.storageKey, value)
      .then(() => markSaved(key))
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
  }

  const resetSoundValue = (key: SoundPreferenceKey) => {
    const meta = SOUND_PREFERENCES.find((item) => item.key === key)
    if (!meta) return
    saveSoundValue(key, meta.defaultValue)
  }

  const previewSound = (sound: SoundEffectId) => {
    if (sound === 'none') return
    void window.openpi.playSoundEffect(sound).catch(() => undefined)
  }

  const saveUpdateValue = (key: UpdatePreferenceKey, value: boolean) => {
    const meta = UPDATE_PREFERENCES.find((item) => item.key === key)
    if (!meta) return

    setUpdatePrefs((prev) => ({ ...prev, [key]: value }))

    void window.openpi
      .setPref(meta.storageKey, String(value))
      .then(() => markSaved(key))
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
  }

  const resetUpdateValue = (key: UpdatePreferenceKey) => {
    const meta = UPDATE_PREFERENCES.find((item) => item.key === key)
    if (!meta) return
    saveUpdateValue(key, meta.defaultValue)
  }

  const checkForUpdates = () => {
    setCheckingUpdates(true)
    setInstallOutput(null)
    void window.openpi
      .checkPiUpdate()
      .then((result) => {
        setUpdateStatus(result)
        markSaved('checkPiUpdate')
      })
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setCheckingUpdates(false))
  }

  const installUpdate = () => {
    setInstallingUpdate(true)
    setInstallOutput(null)
    void window.openpi
      .installPiUpdate()
      .then((result) => {
        setInstallOutput(
          result.output || (result.ok ? 'Update command completed.' : 'Update command failed.')
        )
        markSaved('installPiUpdate')
        if (result.ok && updatePrefs().showReleaseNotesAfterUpdate) openLatestReleaseNotes()
        void window.openpi
          .checkPiUpdate()
          .then(setUpdateStatus)
          .catch(() => undefined)
      })
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setInstallingUpdate(false))
  }

  const openLatestReleaseNotes = () => {
    const version = updateStatus()?.latestVersion
    void window.openpi.openExternal(
      version
        ? `https://github.com/earendil-works/pi/releases/tag/v${version}`
        : 'https://github.com/earendil-works/pi/releases'
    )
  }

  const copyDiagnostics = () => {
    setCopyingDiagnostics(true)
    setDiagnosticsOutput(null)
    void window.openpi
      .getDiagnosticsBundle()
      .then(async (bundle) => {
        const text = JSON.stringify(bundle, null, 2)
        await navigator.clipboard.writeText(text)
        setDiagnosticsOutput(
          'Diagnostics bundle copied to clipboard. Secrets and sensitive paths were redacted in Electron main.'
        )
        markSaved('diagnostics')
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err)
        setDiagnosticsOutput(message)
        props.onError(message)
      })
      .finally(() => setCopyingDiagnostics(false))
  }

  return {
    prefs,
    notificationPrefs,
    soundPrefs,
    updatePrefs,
    updateStatus,
    checkingUpdates,
    installingUpdate,
    installOutput,
    diagnosticsOutput,
    copyingDiagnostics,
    openSoundMenu,
    setOpenSoundMenu,
    savedKey,
    loading,
    closeSoundMenu,
    saveValue,
    resetValue,
    saveNotificationValue,
    resetNotificationValue,
    saveSoundValue,
    resetSoundValue,
    previewSound,
    saveUpdateValue,
    resetUpdateValue,
    checkForUpdates,
    installUpdate,
    copyDiagnostics,
    saveAppearance,
    resetAppearance,
    appearanceRows,
  }
}
