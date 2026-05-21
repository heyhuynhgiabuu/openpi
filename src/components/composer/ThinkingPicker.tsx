import { ChevronDown } from 'lucide-solid'
import { For, Show } from 'solid-js'
import { THINKING_LEVELS } from './helpers'

interface ThinkingPickerProps {
  thinkingOpen: boolean
  thinkingLevel: string
  onToggle: () => void
  onSelect: (level: string) => void
  onClose: () => void
  wrapperRef: (el: HTMLDivElement) => void
}

export function ThinkingPicker(props: ThinkingPickerProps) {
  return (
    <div ref={(el) => props.wrapperRef(el)} class="composer-picker">
      <button
        type="button"
        class="composer-tool-btn"
        onClick={props.onToggle}
        title="Thinking level"
      >
        <span class="composer-tool-label">{props.thinkingLevel}</span>
        <ChevronDown size={11} strokeWidth={2} />
      </button>

      <Show when={props.thinkingOpen}>
        <div class="composer-dropdown composer-dropdown-up">
          <For each={THINKING_LEVELS}>
            {(level) => (
              <button
                type="button"
                class={`composer-drop-item ${props.thinkingLevel === level ? 'is-active' : ''}`}
                onClick={() => {
                  props.onSelect(level)
                  props.onClose()
                }}
              >
                <span class="composer-drop-name">{level}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
