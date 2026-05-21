import { ChevronDown, Plus, SlidersHorizontal } from 'lucide-solid'
import { For, Show } from 'solid-js'
import type { ModelInfo } from '../../lib/ipc'

interface ModelPickerProps {
  modelOpen: boolean
  modelSearch: string
  currentModel: ModelInfo | null
  filteredModels: () => ModelInfo[]
  onToggle: () => void
  onSearchChange: (value: string) => void
  onSelectModel: (model: ModelInfo) => void
  onConnectProvider: () => void
  onManageModels: () => void
  onClose: () => void
  wrapperRef: (el: HTMLDivElement) => void
}

export function ModelPicker(props: ModelPickerProps) {
  return (
    <div ref={(el) => props.wrapperRef(el)} class="composer-picker">
      <button type="button" class="composer-tool-btn" onClick={props.onToggle} title="Select model">
        <span class="composer-tool-label">{props.currentModel?.name ?? 'No model'}</span>
        <ChevronDown size={11} strokeWidth={2} />
      </button>

      <Show when={props.modelOpen}>
        <div class="composer-dropdown composer-dropdown-up composer-model-dropdown">
          <div class="cmd-header">
            <div class="cmd-search-wrap">
              <input
                class="cmd-search"
                placeholder="Search models"
                value={props.modelSearch}
                onInput={(e) => props.onSearchChange(e.currentTarget.value)}
              />
            </div>
            <button
              type="button"
              class="cmd-icon-btn"
              title="Connect provider"
              onClick={() => {
                props.onClose()
                props.onConnectProvider()
              }}
            >
              <Plus size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              class="cmd-icon-btn"
              title="Manage models"
              onClick={() => {
                props.onClose()
                props.onManageModels()
              }}
            >
              <SlidersHorizontal size={13} strokeWidth={2} />
            </button>
          </div>

          <For each={props.filteredModels()}>
            {(m) => {
              const active = () =>
                props.currentModel?.id === m.id && props.currentModel?.provider === m.provider
              return (
                <button
                  type="button"
                  class={`composer-drop-item ${active() ? 'is-active' : ''}`}
                  onClick={() => {
                    props.onSelectModel(m)
                    props.onClose()
                  }}
                >
                  <span class="composer-drop-name">{m.name}</span>
                  <span class="composer-drop-sub">{m.provider}</span>
                </button>
              )
            }}
          </For>

          <Show when={props.filteredModels().length === 0}>
            <div class="cmd-empty">No models match</div>
          </Show>
        </div>
      </Show>
    </div>
  )
}
