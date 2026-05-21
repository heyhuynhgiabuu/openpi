import { Check, RotateCcw } from 'lucide-solid'
import { For, Show } from 'solid-js'
import { COLOR_SCHEME_OPTIONS } from '../../lib/appearancePreferences'

interface AppearanceRow {
  key: string
  label: string
  description: string
  value: unknown
  defaultValue: unknown
  control: 'scheme' | 'font'
  placeholder?: string
}

interface AppearanceSectionProps {
  appearanceRows: AppearanceRow[]
  savedKey: string | null
  onSave: (key: string, value: unknown) => void
  onReset: (key: string) => void
}

export function AppearanceSection(props: AppearanceSectionProps) {
  return (
    <section class="osp-section">
      <div class="osp-section-head">Appearance</div>
      <For each={props.appearanceRows}>
        {(field) => {
          const isDefault = () => field.value === field.defaultValue
          const justSaved = () => props.savedKey === field.key
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
                    onClick={() => props.onReset(field.key)}
                    title="Reset to default"
                  >
                    <RotateCcw size={11} />
                  </button>
                </Show>
                <Show when={field.control === 'scheme'}>
                  <select
                    class="osp-select"
                    value={String(field.value ?? '')}
                    onChange={(e) => props.onSave(field.key, e.currentTarget.value)}
                  >
                    <For each={COLOR_SCHEME_OPTIONS}>
                      {(option) => <option value={option.value}>{option.label}</option>}
                    </For>
                  </select>
                </Show>
                <Show when={field.control === 'font'}>
                  <div class="osp-font-input-wrap">
                    <input
                      class="osp-input"
                      type="text"
                      value={String(field.value ?? '')}
                      placeholder={field.placeholder}
                      onInput={(e) => props.onSave(field.key, e.currentTarget.value)}
                    />
                    <Show when={field.value}>
                      <span
                        class="osp-font-preview"
                        style={{ 'font-family': `"${field.value}", sans-serif` }}
                      >
                        Aa
                      </span>
                    </Show>
                  </div>
                </Show>
              </div>
            </div>
          )
        }}
      </For>
    </section>
  )
}
