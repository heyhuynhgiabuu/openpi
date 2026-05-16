/**
 * shiki.ts — shared syntax highlighter instance.
 *
 * Used by MarkdownContent and FilePreviewPane/LineNumberedEditor.
 * Exposes a synchronous `highlightCode` function that returns plain HTML
 * when the highlighter is ready (falls back to escaped text otherwise).
 *
 * Theme strategy: use embedded themes (github-dark-dimmed / github-light)
 * instead of css-variables — css-variables is NOT bundled in shiki v3 and
 * causes createHighlighter to reject, silently breaking all highlighting.
 */
import type { createHighlighter } from 'shiki'

type HighlighterInstance = Awaited<ReturnType<typeof createHighlighter>>

let _highlighter: HighlighterInstance | null = null
// Do NOT cache rejected promises — reset to null so the next call retries.
let _highlighterPromise: Promise<HighlighterInstance> | null = null

export async function ensureHighlighter(): Promise<HighlighterInstance> {
  if (_highlighter) return _highlighter

  if (!_highlighterPromise) {
    _highlighterPromise = import('shiki')
      .then(({ createHighlighter, createJavaScriptRegexEngine }) =>
        createHighlighter({
          // Use the JS regex engine — no WebAssembly needed, works under any CSP.
          // Falls back gracefully on grammars that use Oniguruma-only features.
          engine: createJavaScriptRegexEngine(),
          // css-variables is NOT a bundled shiki v3 theme — do not include it.
          // github-dark-dimmed  → dark UI, github-light → light UI.
          themes: ['github-dark-dimmed', 'github-light'],
          langs: [
            'typescript',
            'javascript',
            'tsx',
            'jsx',
            'css',
            'scss',
            'html',
            'json',
            'bash',
            'python',
            'rust',
            'go',
            'yaml',
            'markdown',
            'sql',
            'toml',
            'ruby',
            'php',
            'graphql',
            'plaintext',
          ],
        })
      )
      .then((h) => {
        _highlighter = h
        return h
      })
      .catch((err) => {
        // Reset so the next call can retry instead of caching the rejection.
        _highlighterPromise = null
        throw err
      })
  }

  return _highlighterPromise
}

/**
 * Map common fence-language aliases to the shiki-registered language id.
 * Shiki v3 resolves js/ts automatically but NOT py/sh/rb/etc.
 * This map covers all the gaps.
 */
export const LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'jsx',
  mjs: 'javascript',
  cjs: 'javascript',
  css: 'css',
  scss: 'scss',
  less: 'css',
  html: 'html',
  htm: 'html',
  json: 'json',
  jsonc: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'toml',
  md: 'markdown',
  mdx: 'markdown',
  py: 'python',
  rs: 'rust',
  go: 'go',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  rb: 'ruby',
  php: 'php',
  sql: 'sql',
  graphql: 'graphql',
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Resolve extension → shiki language id */
export function extToLang(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return LANG_MAP[ext] ?? null
}

/**
 * Select the shiki theme that matches the current app theme.
 * Reads the data-theme attribute on :root (set by OpenPi's theme system).
 */
export function activeShikiTheme(): 'github-dark-dimmed' | 'github-light' {
  if (typeof document === 'undefined') return 'github-dark-dimmed'
  return document.documentElement.getAttribute('data-theme') === 'light'
    ? 'github-light'
    : 'github-dark-dimmed'
}

/**
 * Highlight `code` for the given `filename` extension.
 * Synchronous: returns a plain <pre> if the highlighter isn't ready yet.
 */
export function highlightCode(code: string, filename: string): string {
  const lang = extToLang(filename)
  if (!_highlighter || !lang) return `<pre>${escHtml(code)}</pre>`
  const theme = activeShikiTheme()
  return cachedCodeToHtml(code, lang, theme, _highlighter)
}

export function getHighlighter(): HighlighterInstance | null {
  return _highlighter
}

// ── Code-block highlight cache ────────────────────────────────────────────
// Bounded LRU Map shared across all MarkdownContent and FilePreviewPane
// instances. Key: `theme:lang:code` — correctness requires full code in key.
// Trade-off: O(n) Map key hash on first lookup, O(1) thereafter (V8 caches
// the hash on the string object). Far cheaper than re-running Shiki.
const CODE_CACHE_MAX = 400
const _codeCache = new Map<string, string>()

export function cachedCodeToHtml(
  code: string,
  lang: string,
  theme: string,
  h: HighlighterInstance
): string {
  const key = `${theme}\x00${lang}\x00${code}`
  const cached = _codeCache.get(key)
  if (cached !== undefined) return cached

  let result: string
  try {
    result = h.codeToHtml(code, { lang, theme })
  } catch {
    try {
      result = h.codeToHtml(code, { lang: 'plaintext', theme })
    } catch {
      result = `<pre>${escHtml(code)}</pre>`
    }
  }

  if (_codeCache.size >= CODE_CACHE_MAX) {
    // Evict the oldest entry (Map preserves insertion order).
    const oldest = _codeCache.keys().next().value
    if (oldest !== undefined) _codeCache.delete(oldest)
  }
  _codeCache.set(key, result)
  return result
}

/** Invalidate the code cache (e.g. on theme change). */
export function invalidateCodeCache(): void {
  _codeCache.clear()
}
