/**
 * Tunnel status shape contract tests.
 *
 * Red-phase TDD: asserts tunnelStatusSchema validates the documented lifecycle
 * shape — state plus optional reservedName/url/error/startedAt. Generic on the
 * contract shape, not on any implementation detail.
 */

import { describe, expect, it } from 'vitest'
import { type TunnelStatus, tunnelStatusSchema } from '../../electron/ipc/tunnel'

describe('tunnelStatusSchema', () => {
  it('parses a fully-populated running status', () => {
    const status: TunnelStatus = {
      state: 'running',
      reservedName: 'pidashabc123',
      url: 'https://pidashabc123.shares.zrok.io',
      error: null,
      startedAt: 1710000000000,
    }
    expect(tunnelStatusSchema.safeParse(status).success).toBe(true)
  })

  it('accepts basic-auth credentials in a running status', () => {
    expect(
      tunnelStatusSchema.safeParse({
        state: 'running',
        url: 'https://abcd.shares.zrok.io',
        authUser: 'dashboard',
        authPass: 'fake-test-pass-01',
      }).success
    ).toBe(true)
  })

  it('parses an off status with no tunnel info', () => {
    const status: TunnelStatus = { state: 'off' }
    expect(tunnelStatusSchema.safeParse(status).success).toBe(true)
  })

  it('parses an error status carrying a message', () => {
    const status: TunnelStatus = {
      state: 'error',
      error: 'command not found: zrok',
    }
    expect(tunnelStatusSchema.safeParse(status).success).toBe(true)
  })

  it('rejects a status with an unknown state', () => {
    expect(tunnelStatusSchema.safeParse({ state: 'exploded' }).success).toBe(false)
  })

  it('rejects a status missing the required state field', () => {
    expect(tunnelStatusSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a status with an extra unknown field (strict shape)', () => {
    expect(tunnelStatusSchema.safeParse({ state: 'running', bogus: 1 }).success).toBe(false)
  })

  it('accepts installed/enrolled capability flags', () => {
    const status: TunnelStatus = {
      state: 'off',
      installed: true,
      enrolled: true,
    }
    expect(tunnelStatusSchema.safeParse(status).success).toBe(true)
  })

  it('accepts a not-installed status', () => {
    expect(tunnelStatusSchema.safeParse({ state: 'off', installed: false }).success).toBe(true)
  })
})
