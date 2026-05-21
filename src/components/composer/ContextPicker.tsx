// biome-ignore-all lint/a11y/noStaticElementInteractions: existing composer picker markup is tracked separately from this release.
import { Search } from 'lucide-solid'
import type { Component } from 'solid-js'
import { createEffect, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { FileIcon } from '../../lib/fileIcons'
import type { FffFileResult } from '../../lib/ipc'

interface ContextPickerProps {
  cwd: string | null
  attachedPaths: Set<string>
  onSelect: (file: FffFileResult) => void
  onClose: () => void
}

export const ContextPicker: Component<ContextPickerProps> = (props) => {
  const [query, setQuery] = createSignal('')
  const [activeIdx, setActiveIdx] = createSignal(0)
  const [results, setResults] = createSignal<FffFileResult[]>([])

  let inputRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined
  let debounceRef: ReturnType<typeof setTimeout> | null = null

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus())
  })

  // Run fff file search on every query change (debounced 100 ms for non-empty queries)
  createEffect(() => {
    const q = query()
    if (debounceRef) clearTimeout(debounceRef)
    const cwd = props.cwd
    if (!cwd) {
      setResults([])
      return
    }
    const delay = q.trim() ? 100 : 0
    debounceRef = setTimeout(() => {
      void window.openpi.fff
        .fileSearch(q, 60, cwd)
        .then((items) => setResults(items))
        .catch(() => setResults([]))
    }, delay)

    onCleanup(() => {
      if (debounceRef) clearTimeout(debounceRef)
    })
  })

  // Reset active idx when result set changes
  createEffect(() => {
    results().length
    setActiveIdx(0)
  })

  // Scroll active item into view
  createEffect(() => {
    const idx = activeIdx()
    listRef?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results().length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const f = results()[activeIdx()]
      if (f && !props.attachedPaths.has(f.relativePath)) {
        props.onSelect(f)
        props.onClose()
      }
    }
  }

  return (
    <div class="ctx-picker" onKeyDown={handleKeyDown}>
      {/* Search input */}
      <div class="ctx-picker-search">
        <Search size={12} class="ctx-picker-search-icon" />
        <input
          ref={(el) => {
            inputRef = el
          }}
          class="ctx-picker-input"
          placeholder="Search files… (fff)"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            setActiveIdx(0)
          }}
          autocomplete="off"
          spellcheck={false}
        />
      </div>

      {/* File list */}
      <div
        ref={(el) => {
          listRef = el
        }}
        class="ctx-picker-list"
      >
        <Show when={results().length === 0}>
          <div class="ctx-picker-empty">No files match</div>
        </Show>

        <For each={results()}>
          {(f, idx) => {
            const already = () => props.attachedPaths.has(f.relativePath)
            const isActive = () => idx() === activeIdx()

            return (
              <button
                type="button"
                data-idx={idx()}
                class={`ctx-picker-item${isActive() ? ' is-active' : ''}${already() ? ' is-attached' : ''}`}
                onClick={() => {
                  if (!already()) {
                    props.onSelect(f)
                    props.onClose()
                  }
                }}
                onMouseEnter={() => setActiveIdx(idx())}
                disabled={already()}
              >
                <span class="ctx-picker-item-icon">
                  <FileIcon name={f.fileName} size={12} />
                </span>
                <span class="ctx-picker-item-name">{f.fileName}</span>
                <Show when={f.dir}>
                  <span class="ctx-picker-item-dir">{f.dir}</span>
                </Show>
                <Show when={already()}>
                  <span class="ctx-picker-item-badge">added</span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      {/* Footer */}
      <div class="ctx-picker-footer">
        <span>↑↓ navigate</span>
        <span>↵ add</span>
        <span>esc close</span>
      </div>
    </div>
  )
}
