// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: existing manage-models modal backdrop interaction is tracked separately from this release.
import { ChevronDown, ChevronRight, Plus, Search, X } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { ModelInfo } from '../../lib/ipc'
import { getProviderLabel } from '../../lib/providers'

type Props = {
  models: ModelInfo[]
  hiddenModels: Set<string>
  onToggle: (key: string) => void
  onClose: () => void
  onConnectProvider: () => void
}

export function ManageModelsModal(props: Props) {
  const [search, setSearch] = createSignal('')
  const [collapsedProviders, setCollapsedProviders] = createSignal<Set<string>>(new Set())
  let _searchRef!: HTMLInputElement

  const q = createMemo(() => search().toLowerCase())

  const filtered = createMemo(() => {
    if (!q()) return props.models
    return props.models.filter(
      (m) =>
        m.name.toLowerCase().includes(q()) ||
        m.provider.toLowerCase().includes(q()) ||
        getProviderLabel(m.provider).toLowerCase().includes(q())
    )
  })

  const groups = createMemo(() => {
    const next = new Map<string, ModelInfo[]>()
    for (const model of filtered()) {
      const list = next.get(model.provider) ?? []
      list.push(model)
      next.set(model.provider, list)
    }
    return Array.from(next.entries())
  })

  const toggleProvider = (provider: string) => {
    setCollapsedProviders((prev) => {
      const next = new Set(prev)
      if (next.has(provider)) next.delete(provider)
      else next.add(provider)
      return next
    })
  }

  const visibleCount = (providerModels: ModelInfo[]) => {
    return providerModels.filter((m) => !props.hiddenModels.has(`${m.provider}/${m.id}`)).length
  }

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose()
      }}
    >
      <div class="modal-sheet mm-sheet">
        <div class="mm-header">
          <div class="mm-header-left">
            <h2 class="mm-title">Manage models</h2>
            <p class="mm-subtitle">Customize which models appear in the model selector.</p>
          </div>
          <div class="mm-header-right">
            <button
              type="button"
              class="mm-connect-btn"
              onClick={() => {
                props.onClose()
                props.onConnectProvider()
              }}
            >
              <Plus size={12} strokeWidth={2.5} />
              Connect provider
            </button>
            <button type="button" class="modal-close-btn" onClick={props.onClose}>
              <X size={15} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div class="cp-search-row">
          <Search size={13} strokeWidth={2} class="cp-search-icon" />
          <input
            ref={(el) => {
              _searchRef = el
            }}
            class="cp-search-input"
            placeholder="Search models or providers"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
        </div>

        <div class="mm-list">
          <Show when={groups().length === 0}>
            <div class="cp-empty">
              {props.models.length === 0
                ? 'No models available. Connect a provider first.'
                : `No models match "${search()}"`}
            </div>
          </Show>

          <For each={groups()}>
            {(entry) => {
              const provider = entry[0]
              const providerModels = entry[1]
              const isCollapsed = () => collapsedProviders().has(provider)
              const vis = () => visibleCount(providerModels)
              const label = () => getProviderLabel(provider)

              return (
                <div class="mm-provider-group">
                  <button
                    type="button"
                    class="mm-provider-header"
                    onClick={() => toggleProvider(provider)}
                  >
                    <span class="mm-provider-chevron">
                      <Show
                        when={isCollapsed()}
                        fallback={<ChevronDown size={12} strokeWidth={2} />}
                      >
                        <ChevronRight size={12} strokeWidth={2} />
                      </Show>
                    </span>
                    <span class="mm-provider-name">{label()}</span>
                    <span class="mm-provider-meta">
                      {vis()}/{providerModels.length} shown
                    </span>
                  </button>

                  <Show when={!isCollapsed()}>
                    <For each={providerModels}>
                      {(model) => {
                        const key = `${model.provider}/${model.id}`
                        const isVisible = () => !props.hiddenModels.has(key)
                        return (
                          <div class="mm-model-row">
                            <div class="mm-model-info">
                              <span class="mm-model-name">{model.name}</span>
                            </div>
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isVisible()}
                              class={`mm-toggle ${isVisible() ? 'is-on' : ''}`}
                              onClick={() => props.onToggle(key)}
                              title={isVisible() ? 'Hide from picker' : 'Show in picker'}
                            >
                              <span class="mm-toggle-thumb" />
                            </button>
                          </div>
                        )
                      }}
                    </For>
                  </Show>
                </div>
              )
            }}
          </For>
        </div>
      </div>
    </div>
  )
}
