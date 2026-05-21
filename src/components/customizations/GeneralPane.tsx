import { Check, RotateCcw } from 'lucide-solid'
import { createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import {
  type AppearancePreferences,
  applyAppearancePreferences,
  COLOR_SCHEME_OPTIONS,
  DEFAULT_APPEARANCE_PREFERENCES,
  loadAppearancePreferences,
  sanitizeFontPreference,
  saveAppearancePreference,
} from '../../lib/appearancePreferences'
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
  SOUND_EFFECT_OPTIONS,
  SOUND_PREFERENCES,
  type SoundEffectId,
  type SoundPreferenceKey,
  type SoundPreferences,
} from '../../lib/soundPreferences'
import { applyThemeTokens, resetTheme } from '../../lib/themeApply'
import {
  DEFAULT_UPDATE_PREFERENCES,
  loadUpdatePreferences,
  UPDATE_PREFERENCES,
  type UpdatePreferenceKey,
  type UpdatePreferences,
} from '../../lib/updatePreferences'
import { BUILT_IN_THEME_OPTIONS, type GeneralPaneProps, THEME_DEFAULT } from './generalPaneTypes'
import { UpdateSection } from './UpdateSection'

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

export function GeneralPane(props: GeneralPaneProps) {
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
  const [appearance, setAppearance] = createSignal<AppearancePreferences>({
    ...DEFAULT_APPEARANCE_PREFERENCES,
  })
  const [activeTheme, setActiveTheme] = createSignal(THEME_DEFAULT)
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
      loadAppearancePreferences(),
      window.openpi.getSettings(),
    ])
      .then(
        ([
          displayPrefs,
          notificationPreferences,
          soundPreferences,
          updatePreferences,
          appearancePrefs,
          settings,
        ]) => {
          setPrefs(displayPrefs)
          setNotificationPrefs(notificationPreferences)
          setSoundPrefs(soundPreferences)
          setUpdatePrefs(updatePreferences)
          setAppearance(appearancePrefs)
          applyAppearancePreferences(appearancePrefs)
          const theme = (settings.effective as Record<string, unknown>)?.theme
          setActiveTheme(typeof theme === 'string' && theme ? theme : THEME_DEFAULT)
        }
      )
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  })

  const closeSoundMenu = () => setOpenSoundMenu(null)

  const handleSoundMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeSoundMenu()
  }

  document.addEventListener('mousedown', closeSoundMenu)
  document.addEventListener('keydown', handleSoundMenuKeyDown)

  onCleanup(() => {
    if (savedTimer) clearTimeout(savedTimer)
    document.removeEventListener('mousedown', closeSoundMenu)
    document.removeEventListener('keydown', handleSoundMenuKeyDown)
  })

  const markSaved = (key: SavedKey) => {
    setSavedKey(key)
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => setSavedKey(null), 1800)
  }

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

  const saveAppearance = <K extends keyof AppearancePreferences>(
    key: K,
    value: AppearancePreferences[K]
  ) => {
    const sanitized = key === 'colorScheme' ? value : sanitizeFontPreference(String(value))
    setAppearance((prev) => ({ ...prev, [key]: sanitized }))
    void saveAppearancePreference(key, value)
      .then((next) => {
        setAppearance(next)
        markSaved(key)
      })
      .catch((err) => props.onError(err instanceof Error ? err.message : String(err)))
  }

  const resetAppearance = (key: keyof AppearancePreferences) => {
    saveAppearance(key, DEFAULT_APPEARANCE_PREFERENCES[key])
  }

  const themeOptions = createMemo(() => {
    const customThemes = props.themeItems
      .filter((item) => item.name !== 'dark' && item.name !== 'light')
      .map((item) => ({ value: item.name, label: item.name }))
    const options = [...BUILT_IN_THEME_OPTIONS, ...customThemes]
    if (!options.some((option) => option.value === activeTheme())) {
      options.push({ value: activeTheme(), label: activeTheme() })
    }
    return options
  })

  const applyThemeSelection = async (themeName: string) => {
    const current = await window.openpi.getSettings()
    const globalSettings = {
      ...((current.global as Record<string, unknown>) ?? {}),
    }

    if (themeName === THEME_DEFAULT) {
      delete globalSettings.theme
      await window.openpi.saveSettings('global', globalSettings)
      resetTheme()
      setActiveTheme(THEME_DEFAULT)
      markSaved('theme')
      return
    }

    globalSettings.theme = themeName
    await window.openpi.saveSettings('global', globalSettings)
    setActiveTheme(themeName)

    const item = props.themeItems.find((candidate) => candidate.name === themeName)
    if (item?.path) {
      const tokens = await window.openpi.readThemeTokens(item.path)
      if (tokens) applyThemeTokens(tokens)
    } else {
      resetTheme()
    }

    markSaved('theme')
  }

  const saveTheme = (themeName: string) => {
    setActiveTheme(themeName)
    void applyThemeSelection(themeName).catch((err) =>
      props.onError(err instanceof Error ? err.message : String(err))
    )
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

  return (
    <div class="osp-root">
      <div class="osp-topbar">
        <div class="osp-scope-row">
          <div>
            <div class="osp-title">General</div>
          </div>
        </div>
      </div>

      <Show when={!loading()} fallback={<div class="osp-loading">Loading…</div>}>
        <div class="osp-scroll">
          <section class="osp-section">
            <div class="osp-section-head">Appearance</div>
            <For each={appearanceRows()}>
              {(field) => {
                const isDefault = () => field.value === field.defaultValue
                const justSaved = () => savedKey() === field.key
                return (
                  <div class="osp-row">
                    <div class="osp-row-left">
                      <div class="osp-row-name">
                        {field.label}
                        <Show when={justSaved()}>
                          <span class="osp-saved">
                            <Check size={10} /> saved
                          </span>
                        </Show>
                      </div>
                      <div class="osp-row-desc">{field.description}</div>
                    </div>
                    <div class="osp-row-right">
                      <Show when={!isDefault()}>
                        <button
                          class="osp-reset-btn"
                          type="button"
                          onClick={() => resetAppearance(field.key)}
                          title="Reset to default"
                        >
                          <RotateCcw size={11} />
                        </button>
                      </Show>
                      <Show
                        when={field.control === 'scheme'}
                        fallback={
                          <input
                            class="osp-input osp-input-font"
                            value={String(field.value)}
                            placeholder={field.placeholder}
                            onChange={(event) =>
                              saveAppearance(field.key, event.currentTarget.value)
                            }
                          />
                        }
                      >
                        <select
                          class="osp-select"
                          value={String(field.value)}
                          onChange={(event) =>
                            saveAppearance(
                              'colorScheme',
                              event.currentTarget.value as AppearancePreferences['colorScheme']
                            )
                          }
                        >
                          <For each={COLOR_SCHEME_OPTIONS}>
                            {(option) => <option value={option.value}>{option.label}</option>}
                          </For>
                        </select>
                      </Show>
                    </div>
                  </div>
                )
              }}
            </For>
            <div class="osp-row osp-row-last">
              <div class="osp-row-left">
                <div class="osp-row-name">
                  Theme
                  <Show when={savedKey() === 'theme'}>
                    <span class="osp-saved">
                      <Check size={10} /> saved
                    </span>
                  </Show>
                </div>
                <div class="osp-row-desc">
                  Select the Pi theme and apply matching OpenPi UI colors when theme tokens are
                  available
                </div>
              </div>
              <div class="osp-row-right">
                <Show when={activeTheme() !== THEME_DEFAULT}>
                  <button
                    class="osp-reset-btn"
                    type="button"
                    onClick={() => saveTheme(THEME_DEFAULT)}
                    title="Reset to default"
                  >
                    <RotateCcw size={11} />
                  </button>
                </Show>
                <select
                  class="osp-select"
                  value={activeTheme()}
                  onChange={(event) => saveTheme(event.currentTarget.value)}
                >
                  <For each={themeOptions()}>
                    {(option) => <option value={option.value}>{option.label}</option>}
                  </For>
                </select>
              </div>
            </div>
          </section>

          <section class="osp-section">
            <div class="osp-section-head">System notifications</div>
            <For each={NOTIFICATION_PREFERENCES}>
              {(field, i) => {
                const on = () => notificationPrefs()[field.key]
                const isDefault = () => on() === field.defaultValue
                const justSaved = () => savedKey() === field.key
                return (
                  <div
                    class={`osp-row${i() === NOTIFICATION_PREFERENCES.length - 1 ? ' osp-row-last' : ''}`}
                  >
                    <div class="osp-row-left">
                      <div class="osp-row-name">
                        {field.label}
                        <Show when={justSaved()}>
                          <span class="osp-saved">
                            <Check size={10} /> saved
                          </span>
                        </Show>
                      </div>
                      <div class="osp-row-desc">{field.description}</div>
                    </div>
                    <div class="osp-row-right">
                      <Show when={!isDefault()}>
                        <button
                          class="osp-reset-btn"
                          type="button"
                          onClick={() => resetNotificationValue(field.key)}
                          title="Reset to default"
                        >
                          <RotateCcw size={11} />
                        </button>
                      </Show>
                      <button
                        class={`osp-toggle${on() ? ' is-on' : ''}`}
                        type="button"
                        onClick={() => saveNotificationValue(field.key, !on())}
                        role="switch"
                        aria-checked={on()}
                        aria-label={field.label}
                      >
                        <span class="osp-toggle-thumb" />
                      </button>
                    </div>
                  </div>
                )
              }}
            </For>
          </section>

          <section class="osp-section osp-section-sound">
            <div class="osp-section-head">Sound effects</div>
            <For each={SOUND_PREFERENCES}>
              {(field, i) => {
                const selected = () => soundPrefs()[field.key]
                const selectedOption = () =>
                  SOUND_EFFECT_OPTIONS.find((option) => option.value === selected()) ??
                  SOUND_EFFECT_OPTIONS[0]
                const isOpen = () => openSoundMenu() === field.key
                const isDefault = () => selected() === field.defaultValue
                const justSaved = () => savedKey() === field.key
                return (
                  <div
                    class={`osp-row${i() === SOUND_PREFERENCES.length - 1 ? ' osp-row-last' : ''}`}
                  >
                    <div class="osp-row-left">
                      <div class="osp-row-name">
                        {field.label}
                        <Show when={justSaved()}>
                          <span class="osp-saved">
                            <Check size={10} /> saved
                          </span>
                        </Show>
                      </div>
                      <div class="osp-row-desc">{field.description}</div>
                    </div>
                    <div class="osp-row-right">
                      <Show when={!isDefault()}>
                        <button
                          class="osp-reset-btn"
                          type="button"
                          onClick={() => resetSoundValue(field.key)}
                          title="Reset to default"
                        >
                          <RotateCcw size={11} />
                        </button>
                      </Show>
                      <div class="osp-sound-picker">
                        <button
                          class="osp-sound-trigger"
                          type="button"
                          aria-haspopup="listbox"
                          aria-expanded={isOpen()}
                          aria-label={`${field.label} sound effect`}
                          onMouseDown={(event) => event.stopPropagation()}
                          onClick={() => setOpenSoundMenu(isOpen() ? null : field.key)}
                        >
                          <span>{selectedOption().label}</span>
                          <span class="osp-sound-caret" aria-hidden="true">
                            ▾
                          </span>
                        </button>
                        <Show when={isOpen()}>
                          <div
                            class="osp-sound-menu"
                            role="listbox"
                            aria-label={`${field.label} sound effects`}
                          >
                            <For each={SOUND_EFFECT_OPTIONS}>
                              {(option) => {
                                const optionSelected = () => option.value === selected()
                                return (
                                  <button
                                    class={`osp-sound-option${optionSelected() ? ' is-selected' : ''}`}
                                    type="button"
                                    role="option"
                                    aria-selected={optionSelected()}
                                    title={option.description}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onMouseEnter={() => previewSound(option.value)}
                                    onFocus={() => previewSound(option.value)}
                                    onClick={() => {
                                      saveSoundValue(field.key, option.value)
                                      previewSound(option.value)
                                      closeSoundMenu()
                                    }}
                                  >
                                    {option.label}
                                  </button>
                                )
                              }}
                            </For>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                )
              }}
            </For>
          </section>

          <section class="osp-section">
            <div class="osp-section-head">Timeline</div>
            <For each={DISPLAY_PREFERENCES}>
              {(field, i) => {
                const on = () => prefs()[field.key]
                const isDefault = () => on() === field.defaultValue
                const justSaved = () => savedKey() === field.key
                return (
                  <div
                    class={`osp-row${i() === DISPLAY_PREFERENCES.length - 1 ? ' osp-row-last' : ''}`}
                  >
                    <div class="osp-row-left">
                      <div class="osp-row-name">
                        {field.label}
                        <Show when={justSaved()}>
                          <span class="osp-saved">
                            <Check size={10} /> saved
                          </span>
                        </Show>
                      </div>
                      <div class="osp-row-desc">{field.description}</div>
                    </div>
                    <div class="osp-row-right">
                      <Show when={!isDefault()}>
                        <button
                          class="osp-reset-btn"
                          type="button"
                          onClick={() => resetValue(field.key)}
                          title="Reset to default"
                        >
                          <RotateCcw size={11} />
                        </button>
                      </Show>
                      <button
                        class={`osp-toggle${on() ? ' is-on' : ''}`}
                        type="button"
                        onClick={() => saveValue(field.key, !on())}
                        role="switch"
                        aria-checked={on()}
                        aria-label={field.label}
                      >
                        <span class="osp-toggle-thumb" />
                      </button>
                    </div>
                  </div>
                )
              }}
            </For>
          </section>

          <section class="osp-section">
            <div class="osp-section-head">Beta support diagnostics</div>
            <div class="osp-row osp-row-last">
              <div class="osp-row-left">
                <div class="osp-row-name">
                  Diagnostics export
                  <Show when={savedKey() === 'diagnostics'}>
                    <span class="osp-saved">
                      <Check size={10} /> copied
                    </span>
                  </Show>
                </div>
                <div class="osp-row-desc">
                  Copy a redacted support bundle with app/runtime metadata, sidecar state, resource
                  inventory, Git state, and SQLite file stats. Provider credentials are never read.
                </div>
                <Show when={diagnosticsOutput()}>
                  {(output) => <pre class="osp-update-output">{output()}</pre>}
                </Show>
              </div>
              <div class="osp-row-right osp-row-right-actions">
                <button
                  class="osp-action-btn"
                  type="button"
                  disabled={copyingDiagnostics()}
                  onClick={copyDiagnostics}
                >
                  {copyingDiagnostics() ? 'Copying…' : 'Copy bundle'}
                </button>
              </div>
            </div>
          </section>

          <UpdateSection
            updatePrefs={updatePrefs()}
            savedKey={savedKey()}
            updateStatus={updateStatus()}
            checkingUpdates={checkingUpdates()}
            installingUpdate={installingUpdate()}
            installOutput={installOutput()}
            onToggle={(key: string, value: boolean) =>
              saveUpdateValue(key as UpdatePreferenceKey, value)
            }
            onReset={(key: string) => resetUpdateValue(key as UpdatePreferenceKey)}
            onCheck={checkForUpdates}
            onInstall={installUpdate}
          />
        </div>
      </Show>

      <div class="osp-footer">
        OpenPi desktop appearance, display, notification, and sound preferences are stored locally.
        Theme selection updates Pi global settings.
      </div>
    </div>
  )
}
