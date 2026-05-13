import { Command, FileText, MessageCircle, Search, X } from 'lucide-solid'
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from 'solid-js'
import { FileIcon } from '../lib/fileIcons'
import type { FffFileResult, SessionListItem } from '../lib/ipc'
import { formatKeyLabel, type KeybindingActionId } from '../lib/keybindings'
import { formatRelativeTime } from '../lib/sessionView'

export type PaletteCommand = {
  id: KeybindingActionId
  label: string
  description: string
  keys: string
  run: () => void
}

type PaletteResult =
  | {
      kind: 'command'
      id: string
      label: string
      description: string
      keys: string
      run: () => void
    }
  | {
      kind: 'file'
      id: string
      file: FffFileResult
      run: () => void
    }
  | {
      kind: 'session'
      id: string
      session: SessionListItem
      run: () => void
    }

type PaletteSection = {
  label: string
  items: PaletteResult[]
}

type CommandPaletteProps = {
  cwd: string | null
  commands: PaletteCommand[]
  sessions: SessionListItem[]
  onClose: () => void
  onOpenFile: (path: string) => void
  onOpenSession: (session: SessionListItem) => void
}

function searchable(value: string | null | undefined): string {
  return (value ?? '').toLowerCase()
}

function commandMatches(command: PaletteCommand, query: string): boolean {
  if (!query) return true
  const haystack = [command.label, command.description, command.id, command.keys]
    .join(' ')
    .toLowerCase()
  return haystack.includes(query)
}

function sessionMatches(session: SessionListItem, query: string): boolean {
  if (!query) return false
  return [
    session.title,
    session.firstMessage,
    session.workspaceName,
    session.cwd,
    session.lastModel,
  ].some((value) => searchable(value).includes(query))
}

function sessionSubtitle(session: SessionListItem): string {
  const model = session.lastModel ? ` · ${session.lastModel}` : ''
  return `${session.workspaceName}${model}`
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal('')
  const [files, setFiles] = createSignal<FffFileResult[]>([])
  const [activeIdx, setActiveIdx] = createSignal(0)
  const [isSearchingFiles, setIsSearchingFiles] = createSignal(false)

  let inputRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined
  let mounted = true
  let fileSearchRequest = 0

  onMount(() => {
    mounted = true
    requestAnimationFrame(() => inputRef?.focus())
    onCleanup(() => {
      mounted = false
    })
  })

  createEffect(() => {
    const q = query().trim()
    const requestId = ++fileSearchRequest

    if (!q || !props.cwd) {
      setFiles([])
      setIsSearchingFiles(false)
      return
    }

    setIsSearchingFiles(true)
    void window.openpi.fff
      .fileSearch(q, 9, props.cwd)
      .then((items) => {
        if (!mounted || requestId !== fileSearchRequest) return
        setFiles(items)
      })
      .catch(() => {
        if (!mounted || requestId !== fileSearchRequest) return
        setFiles([])
      })
      .finally(() => {
        if (!mounted || requestId !== fileSearchRequest) return
        setIsSearchingFiles(false)
      })
  })

  const normalizedQuery = createMemo(() => query().trim().toLowerCase())

  const commandResults = createMemo<PaletteResult[]>(() =>
    props.commands
      .filter((command) => commandMatches(command, normalizedQuery()))
      .slice(0, normalizedQuery() ? 8 : 9)
      .map((command) => ({
        kind: 'command' as const,
        id: `command:${command.id}`,
        label: command.label,
        description: command.description,
        keys: command.keys,
        run: command.run,
      }))
  )

  const fileResults = createMemo<PaletteResult[]>(() =>
    files().map((file) => ({
      kind: 'file' as const,
      id: `file:${file.relativePath}`,
      file,
      run: () => props.onOpenFile(file.relativePath),
    }))
  )

  const sessionResults = createMemo<PaletteResult[]>(() =>
    props.sessions
      .filter((session) => sessionMatches(session, normalizedQuery()))
      .slice(0, 8)
      .map((session) => ({
        kind: 'session' as const,
        id: `session:${session.path}`,
        session,
        run: () => props.onOpenSession(session),
      }))
  )

  const sections = createMemo<PaletteSection[]>(() => {
    const next: PaletteSection[] = []
    if (commandResults().length > 0) next.push({ label: 'Commands', items: commandResults() })
    if (fileResults().length > 0) next.push({ label: 'Files', items: fileResults() })
    if (sessionResults().length > 0) next.push({ label: 'Session', items: sessionResults() })
    return next
  })

  const flatResults = createMemo(() => sections().flatMap((section) => section.items))

  createEffect(() => {
    const total = flatResults().length
    setActiveIdx((idx) => (total > 0 ? Math.min(idx, total - 1) : 0))
  })

  createEffect(() => {
    const idx = activeIdx()
    listRef?.querySelector(`[data-cpal-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  const sectionOffset = (sectionIndex: number) =>
    sections()
      .slice(0, sectionIndex)
      .reduce((sum, section) => sum + section.items.length, 0)

  const runActive = () => {
    const item = flatResults()[activeIdx()]
    if (!item) return
    props.onClose()
    item.run()
  }

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      props.onClose()
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      setActiveIdx((idx) => Math.min(idx + 1, Math.max(0, flatResults().length - 1)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setActiveIdx((idx) => Math.max(idx - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      runActive()
    }
  }

  const handleQuery = (value: string) => {
    setQuery(value)
    setActiveIdx(0)
  }

  const resultCount = createMemo(() => flatResults().length)

  return (
    <div
      class="cpal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) props.onClose()
      }}
    >
      <div class="cpal-panel">
        <div class="cpal-input-row">
          <Search size={15} class="cpal-input-icon" />
          <input
            ref={(el) => {
              inputRef = el
            }}
            class="cpal-input"
            value={query()}
            placeholder="Search files, commands, and sessions"
            onInput={(event) => handleQuery(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            autocomplete="off"
            spellcheck={false}
          />
          <Show when={query()}>
            <button
              type="button"
              class="cpal-clear"
              onClick={() => handleQuery('')}
              aria-label="Clear search"
              tabIndex={-1}
            >
              <X size={13} />
            </button>
          </Show>
        </div>

        <div
          ref={(el) => {
            listRef = el
          }}
          class="cpal-results"
          role="listbox"
        >
          <For each={sections()}>
            {(section, sectionIndex) => {
              const offset = () => sectionOffset(sectionIndex())
              return (
                <section class="cpal-section">
                  <div class="cpal-section-label">{section.label}</div>
                  <For each={section.items}>
                    {(item, itemIndex) => {
                      const idx = () => offset() + itemIndex()
                      const isActive = () => idx() === activeIdx()
                      return (
                        <button
                          type="button"
                          data-cpal-idx={idx()}
                          class={`cpal-item${isActive() ? ' is-active' : ''}`}
                          role="option"
                          aria-selected={isActive()}
                          onMouseEnter={() => setActiveIdx(idx())}
                          onClick={() => {
                            setActiveIdx(idx())
                            props.onClose()
                            item.run()
                          }}
                        >
                          <PaletteItem item={item} />
                        </button>
                      )
                    }}
                  </For>
                </section>
              )
            }}
          </For>

          <Show when={isSearchingFiles()}>
            <div class="cpal-searching">Searching files…</div>
          </Show>

          <Show when={!isSearchingFiles() && resultCount() === 0}>
            <div class="cpal-empty">No files, commands, or sessions match “{query()}”.</div>
          </Show>
        </div>

        <div class="cpal-footer">
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span class="cpal-footer-spacer" />
          <span>
            {resultCount()} result{resultCount() === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  )
}

function PaletteItem(props: { item: PaletteResult }) {
  return (
    <>
      <span class="cpal-item-icon">
        {props.item.kind === 'file' ? (
          <FileIcon name={props.item.file.fileName} size={14} />
        ) : props.item.kind === 'session' ? (
          <MessageCircle size={14} />
        ) : (
          <Command size={14} />
        )}
      </span>

      <span class="cpal-item-main">
        {props.item.kind === 'command' ? (
          <>
            <span class="cpal-item-title">{props.item.label}</span>
            <span class="cpal-item-subtitle">{props.item.description}</span>
          </>
        ) : props.item.kind === 'file' ? (
          <>
            <span class="cpal-item-title">{props.item.file.fileName}</span>
            <span class="cpal-item-subtitle">{props.item.file.dir}</span>
          </>
        ) : (
          <>
            <span class="cpal-item-title">{props.item.session.title}</span>
            <span class="cpal-item-subtitle">{sessionSubtitle(props.item.session)}</span>
          </>
        )}
      </span>

      <span class="cpal-item-meta">
        {props.item.kind === 'command' ? (
          <kbd>{formatKeyLabel(props.item.keys)}</kbd>
        ) : props.item.kind === 'session' ? (
          formatRelativeTime(props.item.session.updatedAt)
        ) : (
          <FileText size={12} />
        )}
      </span>
    </>
  )
}
