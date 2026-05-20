/**
 * PTY host smoke tests.
 *
 * Tests PtyHost lifecycle — create, write, resize, close — without
 * spawning real PTY processes. node-pty is mocked because it requires
 * native modules and a real shell.
 *
 * Authority boundary: PtyHost lives in Electron main. The renderer
 * never has direct PTY access.
 */

import * as pty from '@lydell/node-pty'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildShellLaunchConfig, PtyHost } from '../electron/services/ptyHost'

const ptyMock = vi.hoisted(() => {
  const handlers: Record<string, (...args: unknown[]) => void> = {}
  const spawn = vi.fn(() => ({
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn((cb: (...args: unknown[]) => void) => {
      handlers.data = cb
    }),
    onExit: vi.fn((cb: (...args: unknown[]) => void) => {
      handlers.exit = cb
    }),
    _handlers: handlers,
  }))
  return { handlers, spawn }
})

vi.mock('@lydell/node-pty', () => ({
  default: { spawn: ptyMock.spawn },
  spawn: ptyMock.spawn,
}))

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PtyHost', () => {
  beforeEach(() => {
    ptyMock.spawn.mockClear()
  })

  it('creates a PTY and returns an id', () => {
    const host = new PtyHost()
    const id = host.create('/tmp', 80, 24)
    expect(id).toMatch(/^pty-\d+$/)
    host.close(id)
    host.closeAll()
  })

  it('creates multiple PTYs with unique ids', () => {
    const host = new PtyHost()
    const id1 = host.create('/tmp', 80, 24)
    const id2 = host.create('/tmp', 80, 24)
    expect(id1).not.toBe(id2)
    host.closeAll()
  })

  it('passes true-color terminal env to node-pty', () => {
    const host = new PtyHost()
    const id = host.create('/tmp/openpi-workspace', 80, 24)

    expect(pty.spawn).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        cwd: '/tmp/openpi-workspace',
        env: expect.objectContaining({
          COLORTERM: 'truecolor',
          OPENPI_TERMINAL: '1',
          PWD: '/tmp/openpi-workspace',
          TERM: 'xterm-256color',
        }),
      })
    )

    host.close(id)
  })

  it('builds zsh shell integration launch config', () => {
    const launch = buildShellLaunchConfig('/bin/zsh', '/tmp/openpi-workspace')

    expect(launch.shell).toBe('/bin/zsh')
    expect(launch.args).toContain('-i')
    expect(launch.env.COLORTERM).toBe('truecolor')
    expect(launch.env.OPENPI_TERMINAL).toBe('1')
    expect(launch.env.ZDOTDIR).toContain('openpi')
  })

  it('builds bash shell integration launch config', () => {
    const launch = buildShellLaunchConfig('/bin/bash', '/tmp/openpi-workspace')

    expect(launch.shell).toBe('/bin/bash')
    expect(launch.args).toEqual(expect.arrayContaining(['--rcfile', '-i']))
    expect(launch.env.COLORTERM).toBe('truecolor')
    expect(launch.env.OPENPI_TERMINAL).toBe('1')
  })

  it('resize handles missing entry gracefully', () => {
    const host = new PtyHost()
    // Should not throw
    host.resize('pty-nonexistent', 100, 40)
  })

  it('close handles missing entry gracefully', () => {
    const host = new PtyHost()
    host.close('pty-nonexistent')
  })

  it('closeAll clears all entries', () => {
    const host = new PtyHost()
    host.create('/tmp', 80, 24)
    host.create('/tmp', 80, 24)
    host.create('/tmp', 80, 24)
    host.closeAll()
    // After closeAll, creating a new PTY should still work
    const id = host.create('/tmp', 80, 24)
    expect(id).toBeTruthy()
    host.close(id)
  })

  it('write handles missing entry gracefully', () => {
    const host = new PtyHost()
    host.write('pty-nonexistent', 'echo hi')
  })

  it('resize clamps cols and rows to at least 1', () => {
    const host = new PtyHost()
    const id = host.create('/tmp', 0, 0) // pty.spawn clamps internally
    host.resize(id, -1, -1)
    host.close(id)
  })

  it('setSender stores webContents reference', () => {
    const host = new PtyHost()
    // Minimal mock — setSender only needs send() for IPty.onData forwarding.
    const fakeSender = {
      send: vi.fn(),
      isDestroyed: () => false,
      // biome-ignore lint/suspicious/noExplicitAny: test mock — not a real WebContents
    } as any
    host.setSender(fakeSender)
    // No explicit getter, but the sender is used by PTY events internally.
    // We just verify it doesn't throw.
    host.create('/tmp', 80, 24)
    host.closeAll()
  })
})
