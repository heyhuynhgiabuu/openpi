/**
 * FileSearchModal — unified workspace search.
 *
 * One input, two live result sections:
 *   ① Files   — file-name matches (synchronous, Fuse.js fuzzy or RegExp exact)
 *   ② In files — content matches   (async, Electron main via IPC, 300 ms debounce)
 *
 * Three combinable modifiers apply to both sections:
 *   Aa   — Match Case
 *   ab|  — Match Whole Word
 *   .*   — Use Regular Expression
 *
 * Keyboard: ↑/↓ navigate across both sections · Enter preview · Esc close
 * Keybinding: Shift+⌘F / Shift+Ctrl+F (wired in App)
 */

// biome-ignore-all lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions lint/a11y/useSemanticElements: existing search modal backdrop/panel interactions are tracked separately from this release.
import { Search } from 'lucide-solid'
import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { FffGrepMatch } from '../../lib/ipc'
import { ModifierBtn } from './FileSearchHighlight'
import { FileHitsList, TextResultsList } from './FileSearchResults'
import { computeFileHits, type FlatFile } from './fileSearchHelpers'

interface FileSearchModalProps {
  cwd: string | null
  onClose: () => void
  onFileClick?: (relPath: string) => void
}

export function FileSearchModal(props: FileSearchModalProps) {
  const [query, setQuery] = createSignal('')
  const [files, setFiles] = createSignal<FlatFile[]>([])
  const [_fffFileHits, setFffFileHits] = createSignal<FlatFile[]>([])
  const [activeIdx, setActiveIdx] = createSignal(0)

  const [matchCase, setMatchCase] = createSignal(false)
  const [wholeWord, setWholeWord] = createSignal(false)
  const [useRegex, setUseRegex] = createSignal(false)

  const [textResults, setTextResults] = createSignal<FffGrepMatch[]>([])
  const [textSearching, setTextSearching] = createSignal(false)

  const debounceId: ReturnType<typeof setTimeout> | null = null
  let debounceGrepId: ReturnType<typeof setTimeout> | null = null
  let mounted = true
  let inputRef!: HTMLInputElement
  let listRef!: HTMLDivElement

  onMount(() => {
    mounted = true
    onCleanup(() => {
      mounted = false
      if (debounceId) clearTimeout(debounceId)
      if (debounceGrepId) clearTimeout(debounceGrepId)
    })
  })

  createEffect(() => {
    if (!props.cwd) return

    void window.openpi.fff
      .fileSearch('', 500, props.cwd)
      .then((items) => {
        setQuery('')
        setActiveIdx(0)
        setTextResults([])
        setTextSearching(false)
        setFffFileHits([])
        setFiles(items.map((f) => ({ name: f.fileName, path: f.relativePath, dir: f.dir })))
      })
      .catch(() => setFiles([]))
  })

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus())
  })

  const anyModifier = createMemo(() => matchCase() || wholeWord() || useRegex())

  const fileHitsState = createMemo(() => {
    return computeFileHits(query(), files(), matchCase(), wholeWord(), useRegex())
  })

  const runTextSearch = (q: string, mc: boolean, ww: boolean, rx: boolean) => {
    if (debounceGrepId) clearTimeout(debounceGrepId)
    if (!q.trim()) {
      setTextResults([])
      setTextSearching(false)
      return
    }

    setTextSearching(true)
    debounceGrepId = setTimeout(() => {
      let mode: 'plain' | 'regex' | 'fuzzy' = rx ? 'regex' : 'plain'
      let searchQuery = q
      if (!rx && ww) {
        mode = 'regex'
        searchQuery = `\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
      }
      const cwd = props.cwd
      if (!cwd) {
        setTextResults([])
        setTextSearching(false)
        return
      }
      void window.openpi.fff
        .grep(searchQuery, {
          mode,
          smartCase: !mc,
          maxMatchesPerFile: 5,
          timeBudgetMs: 3000,
          cwd,
        })
        .then((matches) => {
          if (!mounted) return
          setTextResults(matches)
          setTextSearching(false)
        })
        .catch(() => {
          if (!mounted) return
          setTextSearching(false)
        })
    }, 300)
  }

  createEffect(() => {
    query()
    matchCase()
    wholeWord()
    useRegex()
    void Promise.resolve().then(() => runTextSearch(query(), matchCase(), wholeWord(), useRegex()))
  })

  const textFilesGrouped = createMemo(() => {
    const groups = new Map<string, FffGrepMatch[]>()
    for (const m of textResults()) {
      const g = groups.get(m.relativePath) ?? []
      g.push(m)
      groups.set(m.relativePath, g)
    }
    return Array.from(groups.values())
  })

  const navIndex = createMemo(() => {
    const items: Array<{ path: string }> = fileHitsState().hits.map((h) => ({ path: h.item.path }))
    for (const group of textFilesGrouped()) {
      for (const m of group) items.push({ path: m.relativePath })
    }
    return items
  })

  const totalItems = createMemo(() => navIndex().length)

  createEffect(() => {
    const total = totalItems()
    setActiveIdx((i) => (total > 0 ? Math.min(i, total - 1) : 0))
  })

  createEffect(() => {
    const idx = activeIdx()
    listRef?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  const previewFile = (path: string) => {
    props.onFileClick?.(path)
    requestAnimationFrame(() => inputRef?.focus())
  }

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      props.onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      setActiveIdx((i) => Math.min(i + 1, totalItems() - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      setActiveIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const item = navIndex()[activeIdx()]
      if (item) previewFile(item.path)
    }
  }

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setActiveIdx(0)
  }

  const textMatchCount = createMemo(() => textResults().length)
  const textFileCount = createMemo(() => new Set(textResults().map((m) => m.relativePath)).size)

  return (
    <div
      class="fsearch-backdrop"
      onClick={props.onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Workspace search"
    >
      <div class="fsearch-panel" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div class={`fsearch-input-row${fileHitsState().error ? ' has-error' : ''}`}>
          <Search size={14} class="fsearch-input-icon" />
          <input
            ref={(el) => {
              inputRef = el
            }}
            class="fsearch-input"
            placeholder={anyModifier() ? 'Search workspace…' : 'Fuzzy search files and text…'}
            value={query()}
            onInput={(e) => handleQueryChange(e.currentTarget.value)}
            autocomplete="off"
            spellcheck={false}
          />
          <div class="fsearch-modifier-btns" role="group" aria-label="Search options">
            <ModifierBtn
              label="Aa"
              title="Match Case"
              active={matchCase()}
              onToggle={() => setMatchCase((v) => !v)}
            />
            <ModifierBtn
              label="ab|"
              title="Match Whole Word"
              active={wholeWord()}
              onToggle={() => setWholeWord((v) => !v)}
            />
            <ModifierBtn
              label=".*"
              title="Use Regular Expression"
              active={useRegex()}
              onToggle={() => setUseRegex((v) => !v)}
            />
          </div>
          <Show when={query()}>
            <button
              type="button"
              class="fsearch-clear"
              onClick={() => handleQueryChange('')}
              tabIndex={-1}
            >
              ×
            </button>
          </Show>
        </div>

        <Show when={fileHitsState().error}>
          <div class="fsearch-regex-error" role="alert">
            Invalid regular expression
          </div>
        </Show>

        <div
          ref={(el) => {
            listRef = el
          }}
          class="fsearch-results"
          role="listbox"
        >
          <FileHitsList
            hits={fileHitsState().hits}
            activeIdx={activeIdx()}
            onSelect={setActiveIdx}
            onClick={previewFile}
          />
          <TextResultsList
            results={textFilesGrouped()}
            textSearching={textSearching()}
            query={query()}
            activeIdx={activeIdx()}
            matchCount={textMatchCount()}
            fileHitCount={fileHitsState().hits.length}
            onSelect={setActiveIdx}
            onFileClick={(path) => props.onFileClick?.(path)}
          />
        </div>

        <div class="fsearch-footer">
          <span>↑↓ navigate</span>
          <span>↵ preview</span>
          <span>esc close</span>
          <span class="fsearch-footer-sep" />
          <span class="fsearch-mode-label">{anyModifier() ? 'exact' : 'fuzzy'}</span>
          <Show
            when={query()}
            fallback={<span class="fsearch-footer-count">{files().length} indexed</span>}
          >
            <span class="fsearch-footer-count">
              {fileHitsState().hits.length} file{fileHitsState().hits.length !== 1 ? 's' : ''}
              {textFileCount() > 0
                ? ` · ${textMatchCount()} match${textMatchCount() !== 1 ? 'es' : ''} in ${textFileCount()} file${textFileCount() !== 1 ? 's' : ''}`
                : ''}
            </span>
          </Show>
        </div>
      </div>
    </div>
  )
}
