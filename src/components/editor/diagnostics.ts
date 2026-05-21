import { jsonParseLinter } from '@codemirror/lang-json'
import { linter, lintGutter } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'

function extensionOf(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

export function diagnosticsEnabledFor(filename: string): boolean {
  switch (extensionOf(filename)) {
    case 'json':
    case 'jsonc':
      return true
    default:
      return false
  }
}

export function diagnosticsFor(filename: string): Extension {
  if (!diagnosticsEnabledFor(filename)) return []
  return [lintGutter(), linter(jsonParseLinter(), { delay: 300 })]
}
