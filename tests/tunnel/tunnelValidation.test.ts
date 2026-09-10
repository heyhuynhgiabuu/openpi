/**
 * Tunnel validation contract tests.
 *
 * Red-phase TDD: asserts isDnsSafeReservedName and classifyZrokError behave
 * per the documented contract. These are generic on the contract, not on any
 * implementation detail.
 */

import { describe, expect, it } from 'vitest'
import { classifyZrokError, isDnsSafeReservedName } from '../../electron/ipc/tunnel'

describe('isDnsSafeReservedName', () => {
  it('accepts 4-32 lowercase alphanumeric reserved names', () => {
    expect(isDnsSafeReservedName('pidashabc123')).toBe(true)
    expect(isDnsSafeReservedName('abcd')).toBe(true)
  })

  it('rejects a name starting or ending with a hyphen', () => {
    expect(isDnsSafeReservedName('-leading')).toBe(false)
    expect(isDnsSafeReservedName('trailing-')).toBe(false)
  })

  it('rejects uppercase characters', () => {
    expect(isDnsSafeReservedName('Pi-Dash')).toBe(false)
    expect(isDnsSafeReservedName('P')).toBe(false)
  })

  it('rejects non-hyphen separators and whitespace', () => {
    expect(isDnsSafeReservedName('pi_dash')).toBe(false)
    expect(isDnsSafeReservedName('pi.dash')).toBe(false)
    expect(isDnsSafeReservedName('pi dash')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isDnsSafeReservedName('')).toBe(false)
  })

  it('rejects names longer than 32 characters', () => {
    expect(isDnsSafeReservedName('a'.repeat(32))).toBe(true)
    expect(isDnsSafeReservedName('a'.repeat(33))).toBe(false)
  })
})

describe('classifyZrokError', () => {
  it('classifies missing zrok binary', () => {
    expect(classifyZrokError('zsh: command not found: zrok')).toBe('not-installed')
    expect(classifyZrokError('/bin/zrok: No such file or directory')).toBe('not-installed')
  })

  it('classifies not-enabled errors', () => {
    expect(classifyZrokError('zrok is not enabled')).toBe('not-enabled')
    expect(classifyZrokError('please run "zrok enable" first')).toBe('not-enabled')
  })

  it('classifies auth failures', () => {
    expect(classifyZrokError('unauthorized: invalid token')).toBe('auth-failed')
    expect(classifyZrokError('authentication failed')).toBe('auth-failed')
  })

  it('classifies reserved-name conflicts', () => {
    expect(classifyZrokError('reserved name already in use')).toBe('name-conflict')
    expect(classifyZrokError('name "pi-dash" already reserved')).toBe('name-conflict')
  })

  it('classifies network/offline errors', () => {
    expect(classifyZrokError('dial tcp: connection refused')).toBe('offline')
    expect(classifyZrokError('network is unreachable')).toBe('offline')
  })

  it('falls back to unknown for unrecognized stderr', () => {
    expect(classifyZrokError('Arbitrary unrelated stderr output')).toBe('unknown')
    expect(classifyZrokError('')).toBe('unknown')
  })
})
