import { describe, expect, it } from 'vitest'
import { matchRemoteRoute, REMOTE_ROUTES } from '../electron/remote/allowlist'
import { gateDecisionSchema, pairRequestSchema } from '../electron/remote/protocol'

describe('remote allowlist', () => {
  it('matches every declared route with its method', () => {
    for (const route of REMOTE_ROUTES) {
      const pattern = route.pattern.replace(/:id/u, 'test')
      const match = matchRemoteRoute(route.method, pattern)
      expect(match?.route.handler).toBe(route.handler)
    }
  })

  it('captures path parameters', () => {
    const match = matchRemoteRoute('GET', '/api/session/abc123')
    expect(match?.params.id).toBe('abc123')

    const approve = matchRemoteRoute('POST', '/api/gates/gate%2Fslash/approve')
    expect(approve).toBeNull()
  })

  it('rejects traversal and control characters in captured segments', () => {
    expect(matchRemoteRoute('GET', '/api/session/..')).toBeNull()
    expect(matchRemoteRoute('GET', '/api/session/.')).toBeNull()
    expect(matchRemoteRoute('GET', '/api/session/a%0d%0ab')).toBeNull()
    expect(matchRemoteRoute('GET', '/api/session/%09tab')).toBeNull()
    expect(matchRemoteRoute('GET', '/api/session/%007f')).toBeNull()
  })

  it('denies wrong methods, unknown paths, and traversal — deny by default', () => {
    expect(matchRemoteRoute('GET', '/api/pair')).toBeNull()
    expect(matchRemoteRoute('POST', '/api/session-list')).toBeNull()
    expect(matchRemoteRoute('GET', '/api/nope')).toBeNull()
    expect(matchRemoteRoute('GET', '/api/session/a/b')).toBeNull()
    expect(matchRemoteRoute('GET', '/api/session/')).toBeNull()
    expect(matchRemoteRoute('GET', '/api')).toBeNull()
  })

  it('denies the deferred mutation surfaces by omission — 501, never a handler', () => {
    const forbidden = [
      ['POST', '/api/session/prompt'],
      ['POST', '/api/session/steer'],
      ['POST', '/api/session/follow-up'],
      ['POST', '/api/pty/write'],
      ['POST', '/api/git/stage'],
      ['POST', '/api/git/commit'],
      ['POST', '/api/files/write'],
      ['POST', '/api/settings'],
      ['GET', '/api/settings'],
      ['POST', '/api/extensions/enable'],
    ]
    for (const [method, path] of forbidden) {
      expect(matchRemoteRoute(method, path)).toBeNull()
    }
  })
})

describe('remote protocol schemas', () => {
  it('accepts a well-formed pair request and rejects junk', () => {
    expect(pairRequestSchema.safeParse({ code: '123456', name: 'phone' }).success).toBe(true)
    expect(pairRequestSchema.safeParse({ code: '12345', name: 'phone' }).success).toBe(false)
    expect(pairRequestSchema.safeParse({ code: 'abcdef', name: 'phone' }).success).toBe(false)
    expect(pairRequestSchema.safeParse({ code: '123456', name: '' }).success).toBe(false)
    expect(pairRequestSchema.safeParse({ code: '123456', name: 'x'.repeat(65) }).success).toBe(
      false
    )
    // Unknown fields rejected, not passed through.
    expect(
      pairRequestSchema.safeParse({ code: '123456', name: 'phone', admin: true }).success
    ).toBe(false)
  })

  it('validates gate decisions, including the hunk payload', () => {
    expect(gateDecisionSchema.safeParse({ gateToken: 'a'.repeat(16) }).success).toBe(true)
    expect(
      gateDecisionSchema.safeParse({ gateToken: 'a'.repeat(16), approvedIndexes: [0, 2] }).success
    ).toBe(true)
    expect(gateDecisionSchema.safeParse({ gateToken: 'short' }).success).toBe(false)
    expect(
      gateDecisionSchema.safeParse({ gateToken: 'a'.repeat(16), approvedIndexes: [-1] }).success
    ).toBe(false)
  })
})
