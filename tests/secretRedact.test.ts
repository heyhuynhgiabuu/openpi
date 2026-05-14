import { describe, expect, it } from 'vitest'
import { redact, redactLines, redactObject } from '../electron/secretRedact'

describe('redact', () => {
  it('redacts GitHub tokens', () => {
    const raw = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456'
    const result = redact(raw)
    expect(result).not.toContain('ghp_')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Anthropic keys', () => {
    const raw = 'ANTHROPIC_API_KEY=sk-ant-api03-abc123def456ghi789jkl012mno345p'
    const result = redact(raw)
    expect(result).not.toContain('sk-ant-')
    expect(result).toContain('[REDACTED]')
  })

  it('redacts Bearer tokens in headers', () => {
    const raw = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.sig'
    const result = redact(raw)
    expect(result).toContain('Bearer [REDACTED]')
  })

  it('redacts env-var SECRET assignments', () => {
    const raw = 'SECRET=my-very-long-secret-value-here'
    const result = redact(raw)
    expect(result).not.toContain('my-very-long-secret-value-here')
    expect(result).toContain('[REDACTED]')
  })

  it('passes ordinary non-secret strings unchanged', () => {
    const raw = 'Building project: npm run build -- --mode production'
    expect(redact(raw)).toBe(raw)
  })

  it('applies caller-supplied extra patterns', () => {
    const raw = 'MY_CUSTOM_TOKEN=abc123xyz999foobarbaz'
    const result = redact(raw, { extraPatterns: [/abc123xyz999foobarbaz/g] })
    expect(result).not.toContain('abc123xyz999foobarbaz')
  })
})

describe('redactLines', () => {
  it('redacts each line independently', () => {
    const lines = [
      'Normal log line',
      'SECRET=verylongsecretvaluehere1234567890',
      'Another normal line',
    ]
    const result = redactLines(lines)
    expect(result[0]).toBe('Normal log line')
    expect(result[1]).not.toContain('verylongsecretvaluehere1234567890')
    expect(result[2]).toBe('Another normal line')
  })
})

describe('redactObject', () => {
  it('recursively redacts string values in objects', () => {
    const obj = {
      message: 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456',
      count: 42,
      nested: { key: 'ANTHROPIC_API_KEY=sk-ant-api03-abc123def456ghi789jkl012mno345p' },
    }
    const result = redactObject(obj)
    expect(result.message).toContain('[REDACTED]')
    expect(result.count).toBe(42)
    expect(result.nested.key).toContain('[REDACTED]')
  })

  it('recursively redacts strings in arrays', () => {
    const arr = ['normal', 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef123456']
    const result = redactObject(arr)
    expect(result[0]).toBe('normal')
    expect(result[1]).toContain('[REDACTED]')
  })

  it('leaves non-string primitives untouched', () => {
    expect(redactObject(42)).toBe(42)
    expect(redactObject(true)).toBe(true)
    expect(redactObject(null)).toBeNull()
  })
})
