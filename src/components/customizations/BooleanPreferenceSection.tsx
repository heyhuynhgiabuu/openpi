import { Check, RotateCcw } from 'lucide-solid'
import { For, Show } from 'solid-js'

interface BooleanPreferenceItem {
  key: string
  label: string
  description: string
  defaultValue: boolean
}

interface BooleanPreferenceSectionProps {
  title: string
  items: readonly BooleanPreferenceItem[]
  values: Record<string, boolean>
  savedKey: string | null
  onSave: (key: string, value: boolean) => void
  onReset: (key: string) => void
}

export function BooleanPreferenceSection(props: BooleanPreferenceSectionProps) {
  return (
    <section class="osp-section">
      <div class="osp-section-head">{props.title}</div>
      <For each={props.items}>
        {(field, i) => {
          const on = () => props.values[field.key]
          const isDefault = () => on() === field.defaultValue
          const justSaved = () => props.savedKey === field.key
          return (
            <div class={`osp-row${i() === props.items.length - 1 ? ' osp-row-last' : ''}`}>
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
                <button
                  class={`osp-toggle${on() ? ' is-on' : ''}`}
                  type="button"
                  onClick={() => props.onSave(field.key, !on())}
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
  )
}
