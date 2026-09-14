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
import {
  DEFAULT_POLICY_PREFERENCES,
  loadPolicyPreferences,
  POLICY_PREFERENCES,
  type PolicyPreferenceKey,
} from '../../lib/policyPreferences'
import type { GeneralPaneProps } from './generalPaneTypes'
import { useAppearancePrefs } from './useAppearancePrefs'
import { useBooleanPrefs } from './useBooleanPrefs'

type SavedKey =
  | DisplayPreferenceKey
  | NotificationPreferenceKey
  | PolicyPreferenceKey
  | SoundPreferenceKey
  | UpdatePreferenceKey
  | keyof AppearancePreferences
  | 'theme'
  | 'diagnostics'
  | 'checkPiUpdate'
  | 'installPiUpdate'

export function useGeneralPaneState(props: GeneralPaneProps) {
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
      display.load(),
      notification.load(),
      policy.load(),
      loadSoundPreferences().then(setSoundPrefs),
      loadUpdatePreferences().then(setUpdatePrefs),
    ])
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

  const notification = useBooleanPrefs({
    metas: NOTIFICATION_PREFERENCES,
    defaults: DEFAULT_NOTIFICATION_PREFERENCES,
    load: loadNotificationPreferences,
    markSaved,
    onError: props.onError,
  })

  const policy = useBooleanPrefs({
    metas: POLICY_PREFERENCES,
    defaults: DEFAULT_POLICY_PREFERENCES,
    load: loadPolicyPreferences,
    markSaved,
    onError: props.onError,
  })

  const { appearanceRows, saveAppearance, resetAppearance } = useAppearancePrefs({
    onError: props.onError,
    markSaved,
  })

  const announceDisplayChange = (next: DisplayPreferences) => {
    window.dispatchEvent(new CustomEvent(DISPLAY_PREFERENCES_CHANGED_EVENT, { detail: next }))
  }

  const display = useBooleanPrefs({
    metas: DISPLAY_PREFERENCES,
    defaults: DEFAULT_DISPLAY_PREFERENCES,
    load: loadDisplayPreferences,
    markSaved,
    onError: props.onError,
    onChange: announceDisplayChange,
  })

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
    const status = updateStatus()
    const target = status?.latestVersion
    if (!target) {
      setInstallOutput('No update available. Click "Check for updates" first.')
      setInstallingUpdate(false)
      return
    }
    void window.openpi
      .installPiUpdate(target)
      .then((result) => {
        setInstallOutput(
          result.message ??
            result.output ??
            (result.ok ? 'Update command completed.' : 'Update command failed.')
        )
        markSaved('installPiUpdate')
        if (result.ok) {
          if (updatePrefs().showReleaseNotesAfterUpdate) openLatestReleaseNotes()
          void window.openpi
            .checkPiUpdate()
            .then(setUpdateStatus)
            .catch(() => undefined)
        }
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
    prefs: display.values,
    notificationPrefs: notification.values,
    policyPrefs: policy.values,
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
    saveValue: display.save,
    resetValue: display.reset,
    saveNotificationValue: notification.save,
    resetNotificationValue: notification.reset,
    savePolicyValue: policy.save,
    resetPolicyValue: policy.reset,
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
