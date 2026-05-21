import { For, Show } from 'solid-js'
import { FileIcon } from '../../lib/fileIcons'
import type { FffGrepMatch } from '../../lib/ipc'
import { HighlightedText } from './FileSearchHighlight'

interface FileHitsListProps {
  hits: Array<{
    item: { name: string; path: string; dir: string }
    nameRanges?: Array<[number, number]>
    pathRanges?: Array<[number, number]>
  }>
  activeIdx: number
  onSelect: (idx: number) => void
  onClick: (path: string) => void
}

export function FileHitsList(props: FileHitsListProps) {
  return (
    <Show when={props.hits.length > 0}>
      <div class="fsearch-section">
        <div class="fsearch-section-header">
          Files
          <span class="fsearch-section-count">{props.hits.length}</span>
        </div>
        <For each={props.hits}>
          {(hit, idx) => (
            <button
              type="button"
              data-idx={idx()}
              class={`fsearch-result${idx() === props.activeIdx ? ' is-active' : ''}`}
              role="option"
              aria-selected={idx() === props.activeIdx}
              onClick={() => props.onClick(hit.item.path)}
              onMouseEnter={() => props.onSelect(idx())}
            >
              <span class="fsearch-result-icon">
                <FileIcon name={hit.item.name} size={13} />
              </span>
              <span class="fsearch-result-text">
                <span class="fsearch-result-name">
                  <HighlightedText text={hit.item.name} ranges={hit.nameRanges ?? []} />
                </span>
                <Show when={hit.item.dir}>
                  <span class="fsearch-result-dir">
                    <HighlightedText text={hit.item.dir} ranges={hit.pathRanges ?? []} />
                  </span>
                </Show>
              </span>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}

interface TextResultsListProps {
  results: FffGrepMatch[][]
  textSearching: boolean
  query: string
  activeIdx: number
  matchCount: number
  fileHitCount: number
  onSelect: (absoluteIndex: number) => void
  onFileClick: (relPath: string) => void
}

export function TextResultsList(props: TextResultsListProps) {
  return (
    <Show
      when={
        props.textSearching || props.results.length > 0 || (props.query && !props.textSearching)
      }
    >
      <div class="fsearch-section">
        <div class="fsearch-section-header">
          In files
          <Show
            when={props.textSearching}
            fallback={<span class="fsearch-section-count">{props.matchCount}</span>}
          >
            <span class="fsearch-section-searching">searching…</span>
          </Show>
        </div>

        <Show when={props.textSearching}>
          <div class="fsearch-empty" style={{ padding: '12px 14px' }}>
            …
          </div>
        </Show>

        <Show when={!props.textSearching && props.results.length === 0 && props.query}>
          <div class="fsearch-empty" style={{ padding: '8px 14px', 'font-size': '11px' }}>
            No content matches
          </div>
        </Show>

        <Show when={!props.textSearching}>
          <For each={props.results}>
            {(group, gi) => {
              const first = group[0]
              const offsetBefore = props.results.slice(0, gi()).reduce((s, g) => s + g.length, 0)
              const rp = first?.relativePath ?? ''
              const dirPart = rp.includes('/') ? rp.slice(0, rp.lastIndexOf('/')) : ''
              const namePart = first?.fileName ?? first?.relativePath.split('/').pop() ?? ''
              return (
                <div class="fsearch-file-group">
                  <div class="fsearch-file-header" aria-hidden>
                    <span class="fsearch-file-header-icon">
                      <FileIcon name={namePart} size={12} />
                    </span>
                    <span class="fsearch-file-header-name">{namePart}</span>
                    <Show when={dirPart}>
                      <span class="fsearch-file-header-dir">{dirPart}</span>
                    </Show>
                    <span class="fsearch-file-header-count">{group.length}</span>
                  </div>

                  <For each={group}>
                    {(match, mi) => {
                      const globalIdx = () => props.fileHitCount + offsetBefore + mi()
                      const isActive = () => globalIdx() === props.activeIdx
                      return (
                        <button
                          type="button"
                          data-idx={globalIdx()}
                          class={`fsearch-text-line${isActive() ? ' is-active' : ''}`}
                          onClick={() => props.onFileClick(match.relativePath)}
                          onMouseEnter={() => props.onSelect(globalIdx())}
                        >
                          <span class="fsearch-text-lineno">{match.lineNumber}</span>
                          <span class="fsearch-text-content">
                            <HighlightedText text={match.lineContent} ranges={match.matchRanges} />
                          </span>
                        </button>
                      )
                    }}
                  </For>
                </div>
              )
            }}
          </For>
        </Show>
      </div>
    </Show>
  )
}
