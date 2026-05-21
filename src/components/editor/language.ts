import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import type { Extension } from '@codemirror/state'

const LANG_MAP: Record<string, (() => Extension) | undefined> = {
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  mjs: () => javascript(),
  cjs: () => javascript(),
  py: () => python(),
  python: () => python(),
  rs: () => rust(),
  rust: () => rust(),
  json: () => json(),
  md: () => markdown(),
  mdx: () => markdown(),
  markdown: () => markdown(),
  css: () => css(),
  scss: () => css(),
  less: () => css(),
  html: () => html(),
  htm: () => html(),
  xml: () => html(),
  svg: () => html(),
}

export function languageFor(filename: string): Extension {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const factory = LANG_MAP[ext]
  if (factory) return factory()
  return []
}
