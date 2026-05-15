/**
 * MarkdownContent — renders Pi agent responses as formatted markdown.
 *
 * Uses marked + marked-shiki (shiki for code blocks, GFM extensions).
 * Each render uses a fresh Marked instance to avoid mutating global state.
 *
 * Code blocks get a header with:
 *  - language badge (e.g. "js", "python")
 *  - copy-to-clipboard button (event delegation via onClick on the container)
 */

import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import markedShiki from 'marked-shiki'
import { type Component, createEffect, createSignal, onCleanup } from 'solid-js'
import { activeShikiTheme, ensureHighlighter, LANG_MAP } from '../../lib/shiki'

type Props = { text: string; streaming?: boolean }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeMarkdownHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['button'],
    ADD_ATTR: ['class', 'type', 'aria-label'],
  })
}

/**
 * Resolve a fenced-code language alias to the shiki-registered id.
 * Shiki v3 handles js/ts natively but not py/sh/rb etc.
 */
function resolveLang(raw: string): string {
  if (!raw) return 'plaintext'
  const lower = raw.toLowerCase().trim()
  return LANG_MAP[lower] ?? lower
}

/**
 * Wrap shiki HTML output in a code block container with header.
 * The copy button reads textContent from the inner <code> element at
 * click-time via event delegation (no data-attribute encoding needed).
 */
function wrapCodeBlock(shikiHtml: string, rawLang: string): string {
  const display =
    rawLang && rawLang !== 'plaintext' && rawLang !== 'text'
      ? escapeHtml(rawLang.toLowerCase())
      : ''
  return [
    '<div class="code-block">',
    '<div class="code-block-header">',
    display
      ? `<span class="code-lang-badge">${display}</span>`
      : '<span class="code-lang-badge"></span>',
    '<button class="code-copy-btn" type="button" aria-label="Copy code">Copy</button>',
    '</div>',
    shikiHtml,
    '</div>',
  ].join('')
}

/**
 * Wrap bare <table> elements in a scrollable .md-table-wrap container
 * and stamp the .md-table class. Marked generates bare tags so a simple
 * replace is sufficient and doesn't need a full renderer override.
 */
function wrapTables(html: string): string {
  return html
    .replace(/<table(\s[^>]*)?>/g, '<div class="md-table-wrap"><table class="md-table"$1>')
    .replace(/<\/table>/g, '</table></div>')
}

/**
 * Module-level parser cache — created once after shiki loads, reused on
 * every subsequent render. This eliminates per-token `new Marked()` cost
 * and prevents the two-phase flash that caused streaming flicker.
 *
 * `activeShikiTheme()` is read inside `highlight()` at call-time so theme
 * changes are always reflected without needing to recreate the parser.
 */
/**
 * Cache the Promise (not the resolved value) so concurrent callers during
 * the first async load all await the same inflight request instead of each
 * creating a redundant Marked instance. Reset on failure so the next call
 * can retry (mirrors the pattern in ensureHighlighter).
 */
let _parserPromise: Promise<Marked> | null = null

function getHighlightedParser(): Promise<Marked> {
  if (_parserPromise) return _parserPromise

  _parserPromise = ensureHighlighter()
    .then((h) => {
      const parser = new Marked({ gfm: true })
      parser.use(
        markedShiki({
          highlight(code, rawLang) {
            const lang = resolveLang(rawLang)
            // Read theme at highlight-time so dark↔light changes are reflected
            // without rebuilding the parser.
            const theme = activeShikiTheme()
            try {
              return wrapCodeBlock(h.codeToHtml(code, { lang, theme }), rawLang)
            } catch {
              try {
                return wrapCodeBlock(h.codeToHtml(code, { lang: 'plaintext', theme }), rawLang)
              } catch {
                return wrapCodeBlock(`<pre><code>${escapeHtml(code)}</code></pre>`, rawLang)
              }
            }
          },
        })
      )
      return parser
    })
    .catch((err) => {
      // Reset so the next render attempt can retry.
      _parserPromise = null
      throw err
    })

  return _parserPromise
}

export const MarkdownContent: Component<Props> = (props) => {
  const [html, setHtml] = createSignal('')
  // Timer lives on the component instance, not inside the effect closure,
  // so clearing works correctly across consecutive effect runs.
  let renderTimer: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(renderTimer))

  createEffect(() => {
    const text = props.text
    const isStreaming = props.streaming
    let cancelled = false

    // Phase 1: instant plain render — ONLY on first render (html is empty).
    // Skipping it on subsequent updates prevents the highlighted→plain→highlighted
    // flash that caused visible flicker on every streaming token.
    if (!html()) {
      void (async () => {
        const result = new Marked({ gfm: true }).parse(text)
        const h = result instanceof Promise ? await result : result
        if (!cancelled) setHtml(sanitizeMarkdownHtml(wrapTables(h)))
      })()
    }

    // Phase 2: highlighted render, debounced during streaming.
    // During active streaming we batch updates to ~60 ms intervals instead
    // of re-rendering on every character/token. The cached parser resolves
    // synchronously after the first load, so the 60 ms delay is the only
    // latency — no additional async wait piles on top of it.
    clearTimeout(renderTimer)
    renderTimer = setTimeout(
      () => {
        void getHighlightedParser()
          .then((parser) => parser.parse(text))
          .then((enhanced) => {
            if (!cancelled) setHtml(sanitizeMarkdownHtml(wrapTables(enhanced)))
          })
          .catch(() => {
            /* keep whatever is already shown */
          })
      },
      isStreaming ? 60 : 0
    )

    onCleanup(() => {
      cancelled = true
    })
  })

  /**
   * Event delegation for copy buttons injected into code block headers.
   * Reads textContent from the sibling <code> element — no encoding tricks needed.
   */
  const handleClick = (e: MouseEvent) => {
    const btn = (e.target as Element).closest<HTMLButtonElement>('.code-copy-btn')
    if (!btn) return

    const block = btn.closest('.code-block')
    const codeEl = block?.querySelector('code')
    if (!codeEl) return

    const text = codeEl.textContent ?? ''
    void navigator.clipboard.writeText(text).then(() => {
      btn.textContent = 'Copied!'
      btn.classList.add('is-copied')
      setTimeout(() => {
        btn.textContent = 'Copy'
        btn.classList.remove('is-copied')
      }, 1800)
    })
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: event delegation for copy buttons injected via innerHTML — the <button> elements inside handle their own keyboard events
    // biome-ignore lint/a11y/useKeyWithClickEvents: copy buttons inside are proper <button type="button"> elements that handle their own keyboard events
    <div
      class={`md-content${props.streaming ? ' is-streaming' : ''}`}
      innerHTML={html()}
      onClick={handleClick}
    />
  )
}
