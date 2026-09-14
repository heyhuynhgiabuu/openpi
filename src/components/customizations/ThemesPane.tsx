import { AlertTriangle, Check, RotateCcw } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onMount, Show } from 'solid-js'
import type { CustomizationItem, CustomizationScope, ThemeColors } from '../../lib/ipc'
import { applyThemeTokens, isThemeApplied, resetTheme } from '../../lib/themeApply'

function shortenPath(p: string | null): string {
  if (!p) return ''
  return p.replace(/^\/Users\/[^/]+\//, '~/')
}

const DISPLAY_SCOPE: Record<CustomizationScope, string> = {
  user: 'Global',
  project: 'Project',
  temporary: 'Temp',
}

const SWATCH_KEYS: Array<keyof ThemeColors> = [
  'accent',
  'userMessageBg',
  'toolSuccessBg',
  'toolErrorBg',
  'syntaxKeyword',
  'syntaxString',
  'mdHeading',
]

function ColorSwatch(props: { color: string | null | undefined; label: string }) {
  if (!props.color) return null
  return (
    <span
      class="thm-swatch"
      style={{ background: props.color }}
      title={`${props.label}: ${props.color}`}
      aria-label={`${props.label} color: ${props.color}`}
    />
  )
}

function ThemeCard(props: {
  item: CustomizationItem
  isActive: boolean
  onApply: (item: CustomizationItem) => Promise<void>
}) {
  const [colors, setColors] = createSignal<ThemeColors | null>(null)
  const [applying, setApplying] = createSignal(false)
  const [applied, setApplied] = createSignal(false)

  createEffect(() => {
    const path = props.item.path
    if (!path) {
      setColors(null)
      return
    }
    void window.openpi.readThemeColors(path).then((value) => {
      setColors(value)
    })
  })

  const resolvedSwatches = createMemo(() => {
    if (!colors()) return []
    return SWATCH_KEYS.map((key) => ({ key, color: colors()?.[key] ?? null })).filter(
      (entry) => entry.color
    )
  })

  const handleApply = async () => {
    if (props.isActive || applying()) return
    setApplying(true)
    try {
      await props.onApply(props.item)
      setApplied(true)
      setTimeout(() => setApplied(false), 2000)
    } finally {
      setApplying(false)
    }
  }

  return (
    <article class={`thm-card${props.isActive ? ' is-active' : ''}`}>
      <div class="thm-card-header">
        <div class="thm-card-title-row">
          <span class="thm-card-name">{props.item.name}</span>
          <Show when={props.isActive}>
            <span class="thm-active-chip">
              <Check size={10} /> Active
            </span>
          </Show>
          <span class="thm-scope-chip">{DISPLAY_SCOPE[props.item.scope]}</span>
          <Show when={!props.item.enabled}>
            <span class="thm-disabled-chip">disabled</span>
          </Show>
        </div>

        <button
          type="button"
          class={`thm-apply-btn${props.isActive ? ' is-active' : ''}${applied() ? ' is-applied' : ''}`}
          onClick={() => {
            void handleApply()
          }}
          disabled={props.isActive || applying()}
          aria-label={props.isActive ? 'This theme is active' : `Apply ${props.item.name} theme`}
          title={props.isActive ? 'Currently active' : 'Apply theme globally'}
        >
          <Show when={!applying()} fallback={'…'}>
            <Show
              when={!applied()}
              fallback={
                <>
                  <Check size={12} /> Applied
                </>
              }
            >
              <Show when={props.isActive} fallback={'Apply'}>
                <Check size={12} /> Active
              </Show>
            </Show>
          </Show>
        </button>
      </div>

      <div class="thm-swatches-row">
        <Show
          when={resolvedSwatches().length > 0}
          fallback={<span class="thm-swatches-empty">No extractable colors</span>}
        >
          <For each={resolvedSwatches()}>
            {(entry) => <ColorSwatch color={entry.color} label={String(entry.key)} />}
          </For>
        </Show>
      </div>

      <div class="thm-card-footer">
        <Show when={props.item.path}>
          <span class="thm-card-path">{shortenPath(props.item.path)}</span>
        </Show>
        <Show when={props.item.warning}>
          <div class="thm-card-warning">
            <AlertTriangle size={11} />
            <span>{props.item.warning}</span>
          </div>
        </Show>
      </div>
    </article>
  )
}

type ThemesPaneProps = {
  items: CustomizationItem[]
  loading: boolean
}

export function ThemesPane(props: ThemesPaneProps) {
  const [activeTheme, setActiveTheme] = createSignal<string | null>(null)
  const [hasCustomTheme, setHasCustomTheme] = createSignal(isThemeApplied())

  onMount(() => {
    void window.openpi.getSettings().then((result) => {
      const theme = (result.effective as Record<string, unknown>)?.theme
      if (typeof theme === 'string') setActiveTheme(theme)
    })
  })

  const applyTheme = async (item: CustomizationItem) => {
    const current = await window.openpi.getSettings()
    const globalSettings = { ...((current.global as Record<string, unknown>) ?? {}) }
    globalSettings.theme = item.name
    await window.openpi.saveSettings('global', globalSettings)
    setActiveTheme(item.name)

    if (item.path) {
      const tokens = await window.openpi.readThemeTokens(item.path)
      if (tokens) {
        applyThemeTokens(tokens)
        setHasCustomTheme(true)
      }
    }
  }

  const handleReset = () => {
    resetTheme()
    setHasCustomTheme(false)
  }

  const hasBuiltIn = createMemo(() => props.items.some((item) => item.scope === 'temporary'))

  return (
    <div class="thm-pane">
      <div class="thm-toolbar">
        <div class="thm-toolbar-copy">
          <span class="thm-toolbar-eyebrow">Appearance</span>
          <p>
            Applying a theme updates Pi settings and recolors the OpenPi interface when theme tokens
            are available.
          </p>
        </div>
        <Show when={hasCustomTheme()}>
          <button
            type="button"
            class="thm-reset-btn"
            onClick={handleReset}
            title="Reset OpenPi UI to default colors"
          >
            <RotateCcw size={12} />
            Reset UI colors
          </button>
        </Show>
      </div>

      <div class="thm-list">
        <Show
          when={!props.loading}
          fallback={<div class="thm-empty">Scanning Pi theme directories…</div>}
        >
          <Show
            when={props.items.length > 0}
            fallback={
              <div class="thm-empty">
                <p>No custom themes discovered.</p>
                <p class="thm-empty-hint">
                  Pi includes <code>dark</code> and <code>light</code> built-in. Use the shell-level
                  AI generator or drop a JSON file in <code>~/.pi/agent/themes/</code>.
                </p>
              </div>
            }
          >
            <Show when={hasBuiltIn()}>
              <p class="thm-builtin-note">
                Built-in themes (<code>dark</code>, <code>light</code>) are always available and do
                not appear here.
              </p>
            </Show>
            <For each={props.items}>
              {(item) => (
                <ThemeCard
                  item={item}
                  isActive={activeTheme() === item.name}
                  onApply={applyTheme}
                />
              )}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={props.items.length > 0}>
        <div class="thm-footer">
          Select the active theme via <code>/settings</code> or{' '}
          <code>~/.pi/agent/settings.json</code> → <code>"theme": "name"</code>. Use{' '}
          <strong>Reset UI colors</strong> to restore OpenPi defaults.
        </div>
      </Show>
    </div>
  )
}
