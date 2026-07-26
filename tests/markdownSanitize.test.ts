import { describe, expect, it } from 'vitest'
import { sanitizeMarkdownHtml } from '../src/components/conversation/MarkdownContent'

describe('markdown sanitization', () => {
  it('preserves OpenPi review tags while removing executable markup', () => {
    const sanitized = sanitizeMarkdownHtml(
      '<file_comment path="src/app.ts" line="4">Review</file_comment>' +
        '<selected_code startline="1" endline="2">const value = 1</selected_code>' +
        '<img src="x" onerror="alert(1)"><script>alert(1)</script>'
    )

    expect(sanitized).toContain('<file_comment path="src/app.ts" line="4">Review</file_comment>')
    expect(sanitized).toContain(
      '<selected_code startline="1" endline="2">const value = 1</selected_code>'
    )
    expect(sanitized).not.toContain('onerror')
    expect(sanitized).not.toContain('<script')
  })
})
