import {
  ChevronDown,
  ChevronUp,
  PanelBottomOpen,
  Replace,
  ReplaceAll,
  Search,
  X,
} from 'lucide-solid'
import { Show } from 'solid-js'

export interface FilePreviewFindBarProps {
  findOpen: boolean
  findQuery: string
  findCaseSensitive: boolean
  findWholeWord: boolean
  findRegex: boolean
  findReplaceOpen: boolean
  replaceQuery: string
  findInSelection: boolean
  findTotal: number
  safeMatchIndex: number
  findQueryIsInvalid: boolean
  modeIsEdit: boolean
  inputRef?: HTMLInputElement
  replaceInputRef?: HTMLInputElement
  onFindQueryChange: (value: string) => void
  onFindMatchIndexReset: () => void
  onFindCaseSensitiveToggle: () => void
  onFindWholeWordToggle: () => void
  onFindRegexToggle: () => void
  onFindReplaceOpenToggle: (open: boolean) => void
  onReplaceQueryChange: (value: string) => void
  onFindInSelectionToggle: () => void
  onFindNext: () => void
  onFindPrev: () => void
  onCloseFindBar: () => void
  onSelectAllMatches: () => void
  onToggleInSelection: () => void
  onReplaceNext: () => void
  onReplaceAll: () => void
}

export function FilePreviewFindBar(props: FilePreviewFindBarProps) {
  return (
    <Show when={props.findOpen}>
      {/* ── Search row ── */}
      <div class="fv-find-bar">
        {/* Replace-toggle chevron */}
        <button
          type="button"
          class={`fv-find-replace-toggle${props.findReplaceOpen ? ' is-active' : ''}`}
          title={`${props.findReplaceOpen ? 'Hide' : 'Show'} Replace (Cmd+⌥F)`}
          onClick={() => {
            const next = !props.findReplaceOpen
            props.onFindReplaceOpenToggle(next)
            if (next) setTimeout(() => props.replaceInputRef?.focus(), 30)
          }}
        >
          <PanelBottomOpen size={13} strokeWidth={2} />
        </button>

        <Search size={12} class="fv-find-icon" />
        <input
          ref={props.inputRef}
          class={`fv-find-input${props.findQueryIsInvalid ? ' fv-find-input--error' : ''}`}
          type="text"
          value={props.findQuery}
          placeholder={props.findRegex ? 'Search regex…' : 'Find in file…'}
          onInput={(e) => {
            props.onFindQueryChange(e.currentTarget.value)
            props.onFindMatchIndexReset()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.shiftKey ? props.onFindPrev() : props.onFindNext()
            if (e.key === 'Escape') {
              e.stopPropagation()
              props.onCloseFindBar()
            }
          }}
        />

        {/* ── Match-mode toggles (Aa / Wd / .*) ── */}
        <div class="fv-find-toggles">
          <button
            type="button"
            class={`fv-find-toggle${props.findCaseSensitive ? ' is-active' : ''}`}
            title="Match case (Alt+C)"
            onClick={() => props.onFindCaseSensitiveToggle()}
          >
            Aa
          </button>
          <button
            type="button"
            class={`fv-find-toggle${props.findWholeWord ? ' is-active' : ''}`}
            title="Match whole word (Alt+W)"
            onClick={() => props.onFindWholeWordToggle()}
          >
            Wd
          </button>
          <button
            type="button"
            class={`fv-find-toggle${props.findRegex ? ' is-active' : ''}`}
            title="Use regular expression (Alt+R)"
            onClick={() => props.onFindRegexToggle()}
          >
            .*
          </button>
        </div>

        <span class="fv-find-sep" />

        {/* ── Selection scope + select-all ── */}
        <div class="fv-find-toggles">
          <button
            type="button"
            class={`fv-find-toggle${props.findInSelection ? ' is-active' : ''}`}
            title={
              props.findInSelection
                ? 'Clear selection scope (Alt+L)'
                : 'Find in current selection (Alt+L) — select text first'
            }
            onClick={props.onToggleInSelection}
          >
            [sel]
          </button>
          <button
            type="button"
            class="fv-find-toggle"
            title="Select all matches (Alt+↩)"
            onClick={props.onSelectAllMatches}
            disabled={props.findTotal === 0}
          >
            all
          </button>
        </div>

        <span class="fv-find-sep" />

        {/* ── Count + navigation ── */}
        <span class="fv-find-count">
          <Show when={props.findQuery}>
            {props.findTotal === 0
              ? 'No results'
              : `${props.safeMatchIndex + 1} / ${props.findTotal}`}
          </Show>
        </span>
        <button
          type="button"
          class="fv-find-nav"
          title="Previous (Shift+↩)"
          onClick={props.onFindPrev}
          disabled={props.findTotal === 0}
        >
          <ChevronUp size={13} strokeWidth={2.2} />
        </button>
        <button
          type="button"
          class="fv-find-nav"
          title="Next (↩)"
          onClick={props.onFindNext}
          disabled={props.findTotal === 0}
        >
          <ChevronDown size={13} strokeWidth={2.2} />
        </button>

        <button
          type="button"
          class="fv-find-close"
          title="Close (Esc)"
          onClick={props.onCloseFindBar}
        >
          <X size={12} />
        </button>
      </div>

      {/* ── Replace row (shown when findReplaceOpen) ── */}
      <Show when={props.findReplaceOpen}>
        <div class="fv-find-replace-row">
          <span class="fv-find-replace-indent" />
          <Search size={12} class="fv-find-icon fv-find-icon--replace" />
          <input
            ref={props.replaceInputRef}
            class="fv-find-input"
            type="text"
            value={props.replaceQuery}
            placeholder="Replace with…"
            disabled={!props.modeIsEdit}
            onInput={(e) => props.onReplaceQueryChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                props.onReplaceAll()
              } else if (e.key === 'Enter') {
                e.preventDefault()
                props.onReplaceNext()
              }
              if (e.key === 'Escape') {
                e.stopPropagation()
                props.onCloseFindBar()
              }
            }}
          />
          <div class="fv-find-replace-actions">
            <button
              type="button"
              class="fv-find-replace-btn"
              title="Replace next (↩)"
              onClick={props.onReplaceNext}
              disabled={props.findTotal === 0 || !props.modeIsEdit}
            >
              <Replace size={13} strokeWidth={2} />
            </button>
            <button
              type="button"
              class="fv-find-replace-btn"
              title="Replace all (Cmd+↩)"
              onClick={props.onReplaceAll}
              disabled={props.findTotal === 0 || !props.modeIsEdit}
            >
              <ReplaceAll size={13} strokeWidth={2} />
            </button>
          </div>
          <Show when={!props.modeIsEdit}>
            <span class="fv-find-replace-note">switch to Edit mode to replace</span>
          </Show>
        </div>
      </Show>
    </Show>
  )
}
