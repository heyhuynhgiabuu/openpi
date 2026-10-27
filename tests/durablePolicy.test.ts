import type { ToolCall } from '@earendil-works/pi-ai'
import { describe, expect, it } from 'vitest'
import { beforeToolPolicy } from '../electron/pi/durable/policy'

/** Phase 8.2b: the durable runtime blocks what the desktop policy blocks in the SDK path. */

type Args = ToolCall['arguments']

function call(name: string, args: Args): ToolCall {
  return { type: 'toolCall', id: 'call-1', name, arguments: args }
}

describe('durable tool policy', () => {
  it('blocks hard-protected paths unconditionally', () => {
    const decision = beforeToolPolicy(call('write', { path: '~/.ssh/id_rsa' }))
    expect(decision?.block).toContain('desktop policy')
  })

  it('lets ordinary workspace writes through', () => {
    expect(beforeToolPolicy(call('write', { path: '/tmp/openpi-ok/file.txt' }))).toBeUndefined()
  })

  it('checks edit arguments too (filePath)', () => {
    const decision = beforeToolPolicy(call('edit', { filePath: '~/.ssh/id_ed25519' }))
    expect(decision?.block).toContain('desktop policy')
  })

  it('blocks high-risk shell commands', () => {
    const decision = beforeToolPolicy(call('bash', { command: 'git push --force origin main' }))
    expect(decision?.block).toContain('force-push')
  })

  it('allows ordinary shell commands', () => {
    expect(beforeToolPolicy(call('bash', { command: 'npm test' }))).toBeUndefined()
  })

  it('ignores tools it does not police', () => {
    expect(beforeToolPolicy(call('read', { path: '/tmp/openpi-ok/file.txt' }))).toBeUndefined()
    expect(beforeToolPolicy(call('codemode', { code: 'return 1' }))).toBeUndefined()
  })

  it('tolerates non-string and missing arguments without throwing', () => {
    expect(beforeToolPolicy(call('write', { path: 42 }))).toBeUndefined()
    expect(beforeToolPolicy(call('write', {}))).toBeUndefined()
  })
})
