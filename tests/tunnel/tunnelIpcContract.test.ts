/**
 * Tunnel IPC wire-contract tests.
 *
 * Red-phase TDD: asserts the Zod schemas that validate renderer -> main tunnel
 * requests (enable/start/stop). Generic on the wire contract, not on any
 * implementation detail.
 */

import { describe, expect, it } from 'vitest'
import { tunnelEnableSchema, tunnelStartSchema, tunnelStopSchema } from '../../electron/ipc/tunnel'

describe('tunnelEnableSchema', () => {
  it('accepts a token-only enable request', () => {
    expect(tunnelEnableSchema.safeParse({ token: 'zrok-secret-token' }).success).toBe(true)
  })

  it('accepts an enable request with optional persistence flag', () => {
    expect(
      tunnelEnableSchema.safeParse({ token: 'zrok-secret-token', persistent: true }).success
    ).toBe(true)
  })

  it('rejects a request missing the token', () => {
    expect(tunnelEnableSchema.safeParse({}).success).toBe(false)
    expect(tunnelEnableSchema.safeParse({ persistent: true }).success).toBe(false)
  })

  it('rejects a non-string token', () => {
    expect(tunnelEnableSchema.safeParse({ token: 42 }).success).toBe(false)
  })

  it('accepts an enable request with an optional reservedName', () => {
    expect(
      tunnelEnableSchema.safeParse({ token: 'tok', reservedName: 'pi-dash-abc123' }).success
    ).toBe(true)
  })

  it('rejects a reservedName that is not DNS-safe', () => {
    expect(tunnelEnableSchema.safeParse({ token: 'tok', reservedName: 'Bad Name' }).success).toBe(
      false
    )
  })

  it('rejects unknown fields (strict shape)', () => {
    expect(tunnelEnableSchema.safeParse({ token: 'tok', bogus: 1 }).success).toBe(false)
  })
})

describe('tunnelStartSchema', () => {
  it('accepts a start request with an optional reservedName', () => {
    expect(tunnelStartSchema.safeParse({ reservedName: 'pi-dash-abc123' }).success).toBe(true)
  })

  it('accepts an ephemeral start request with no reservedName', () => {
    expect(tunnelStartSchema.safeParse({}).success).toBe(true)
  })

  it('attaches a persistence flag', () => {
    expect(
      tunnelStartSchema.safeParse({ reservedName: 'pi-dash-abc123', persistent: true }).success
    ).toBe(true)
  })

  it('rejects unknown fields (strict shape)', () => {
    expect(tunnelStartSchema.safeParse({ reservedName: 'name', bogus: 1 }).success).toBe(false)
  })
})

describe('tunnelStopSchema', () => {
  it('accepts an empty stop request', () => {
    expect(tunnelStopSchema.safeParse({}).success).toBe(true)
  })

  it('rejects unknown fields (strict shape)', () => {
    expect(tunnelStopSchema.safeParse({ bogus: 1 }).success).toBe(false)
  })
})
