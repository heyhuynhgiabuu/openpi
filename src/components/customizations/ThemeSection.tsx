import { Check, RotateCcw } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { AppearancePreferences } from '../../lib/appearancePreferences'
import { BUILT_IN_THEME_OPTIONS } from './generalPaneTypes'

interface ThemeSectionProps {
  themeItems: import('../../lib/ipc').CustomizationItem[]
  activeTheme: string
  savedKey: string | null
  onThemeChange: (theme: string) => void
  onThemeInstall: () => void
}

export function ThemeSection(props: ThemeSectionProps) {
  return (
    <section class="osp-section">
      <div class="osp-section-head">Theme</div>
      <div class="osp-row">
        <div class="osp-row-left">
          <div class="osp-row-name">Pre-installed themes</div>
          <div class="osp-row-desc">Built-in theme presets</div>
        </div>
        <div class="osp-row-right">
          <select
            class="osp-select"
            value={props.activeTheme}
            onChange={(e) => props.onThemeChange(e.currentTarget.value)}
          >
            <For each={BUILT_IN_THEME_OPTIONS}>
              {(opt) => <option value={opt.value}>{opt.label}</option>}
            </For>
          </select>
        </div>
      </div>
      <Show when={props.themeItems.length > 0}>
        <div class="osp-row osp-row-last">
          <div class="osp-row-left">
            <div class="osp-row-name">Installed themes</div>
            <div class="osp-row-desc">Community themes added via `pi install`</div>
          </div>
          <div class="osp-row-right">
            <select
              class="osp-select"
              value={props.activeTheme}
              onChange={(e) => props.onThemeChange(e.currentTarget.value)}
            >
              <option value="">— Select —</option>
              <For each={props.themeItems}>
                {(item) => <option value={item.name}>{item.name}</option>}
              </For>
            </select>
          </div>
        </div>
      </Show>
      <Show when={props.savedKey === 'theme'}>
        <div class="osp-saved-inline">
          <Check size={10} /> saved
        </div>
      </Show>
    </section>
  )
}
