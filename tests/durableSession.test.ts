import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { importSessionFile } from '../electron/pi/durable/importer'
import { MODEL, prompt, sessionRoot, setup, useSessionRoot } from './helpers/durableSession'

/**
 * Phase 8.3f: the durable session behind the sidecar protocol. Real harness, faux provider, real
 * export + importer; only the sidecar's parent port is replaced by a recording `send`.
 */

useSessionRoot()

describe('durable session start', () => {
  it('sends session_ready first, and nothing before a run, with the session identity', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: true, requestId: 'req-1' })
    try {
      const ready = t.sent[0]
      expect(ready).toMatchObject({
        type: 'session_ready',
        requestId: 'req-1',
        payload: {
          cwd: '/work',
          sessionId: 'sess-1',
          sessionFile: t.identity.sessionFile,
          model: MODEL,
        },
      })
      // The renderer resets conversation state on ready: nothing may be sent before it, and a
      // freshly attached feed has nothing to say until a run starts (the snapshot only seeds the
      // translator and is not forwarded).
      expect(t.sent).toHaveLength(1)
      expect(t.sessions.isActive()).toBe(true)
    } finally {
      await t.sessions.stop()
    }
  })

  it('does not stay active when the harness cannot open', async () => {
    const t = await setup({ failOpen: true })
    await expect(t.sessions.start('/work', { workspaceTrusted: false })).rejects.toThrow(
      /no default model/
    )
    expect(t.sessions.isActive()).toBe(false)
    expect(t.types()).not.toContain('session_ready')
  })

  it('replaces a previous durable session instead of leaking it', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(t.harnesses).toHaveLength(2)
      expect(t.types().filter((type) => type === 'session_ready')).toHaveLength(2)
    } finally {
      await t.sessions.stop()
    }
  })
})

describe('durable session prompt', () => {
  it('runs the prompt, streams the renderer vocabulary, and exports a readable session file', async () => {
    const t = await setup({ answers: ['the durable answer'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(await t.sessions.handleCommand(prompt('hello there'))).toBe(true)

      const eventTypes = t.sent
        .filter((m) => m.type === 'session_event')
        .map((m) => (m.type === 'session_event' ? String(m.event.type) : ''))
      expect(eventTypes).toContain('agent_start')
      expect(eventTypes).toContain('agent_end')
      expect(t.types()).toContain('session_index_updated')

      const imported = await importSessionFile(t.identity.sessionFile)
      expect(imported.invalid).toBe(false)
      const text = JSON.stringify(imported.messages)
      expect(text).toContain('hello there')
      expect(text).toContain('the durable answer')
      const header = (await readFile(t.identity.sessionFile, 'utf8')).split('\n', 1)[0] ?? ''
      expect(JSON.parse(header)).toMatchObject({ id: 'sess-1', cwd: '/work', version: 3 })
    } finally {
      await t.sessions.stop()
    }
  })

  it('prefixes the context the way the SDK path does', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('  the question  ', ' background '))
      const imported = await importSessionFile(t.identity.sessionFile)
      expect(JSON.stringify(imported.messages)).toContain('background\\n\\nthe question')
    } finally {
      await t.sessions.stop()
    }
  })

  it('reports a command nothing answers instead of sending it to the model', async () => {
    const t = await setup({ answers: ['should not be asked'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('/compact'))
      // Reported in the transcript, as the SDK path does, and the model never sees it.
      const warning = t.sent.find(
        (m) => m.type === 'session_event' && m.event.type === 'message_start'
      )
      expect(JSON.stringify(warning)).toContain('/compact is not available')
      // No run started, so the text was never sent to the model as a literal prompt.
      expect(t.sent.some((m) => m.type === 'session_event' && m.event.type === 'agent_start')).toBe(
        false
      )
    } finally {
      await t.sessions.stop()
    }
  })

  it('expands a slash prompt through the harness before the model sees it', async () => {
    const t = await setup({ answers: ['ok'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      // Stand in for the harness's expander: the prompt must reach it, and what it returns is what
      // the model reads.
      const harness = t.harnesses[0]
      const expand = vi.fn(() => 'EXPANDED BODY')
      if (harness) harness.renderInput = expand
      await t.sessions.handleCommand(prompt('/ship now'))
      expect(expand).toHaveBeenCalledWith('/ship now')
      expect(JSON.stringify(t.sent)).toContain('EXPANDED BODY')
    } finally {
      await t.sessions.stop()
    }
  })

  it('offers its harness commands for the picker, and nothing once stopped', async () => {
    const t = await setup({ answers: ['ok'] })
    // The factory is what `sidecar.ts` asks, so a gap between it and the harness is a gap in the
    // picker. `durableSessions.promptCommands()` delegates to the running harness.
    expect(t.sessions.promptCommands()).toEqual([])
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      const harness = t.harnesses[0]
      if (harness) harness.promptCommands = () => [{ name: 'ship', description: 'Ship it' }]
      expect(t.sessions.promptCommands()).toEqual([{ name: 'ship', description: 'Ship it' }])
    } finally {
      await t.sessions.stop()
    }
    expect(t.sessions.promptCommands()).toEqual([])
  })

  it('reports its own trust for a restore, alongside the identity it reopens', async () => {
    // Trust is per workspace, so a restore must reopen with this session's value rather than the
    // one from whatever request failed; it decides whether that workspace's MCP servers start.
    const t = await setup({ answers: ['ok'] })
    expect(t.sessions.reopenable()).toBeUndefined()
    await t.sessions.start('/work', { workspaceTrusted: true })
    try {
      expect(t.sessions.reopenable()).toEqual({
        sessionId: 'sess-1',
        sessionFile: t.identity.sessionFile,
        startedAt: '2026-10-27T00:00:00.000Z',
        workspaceTrusted: true,
      })
      // A different request's trust must not change what this session reports.
      await t.sessions.start('/work', { workspaceTrusted: false })
      expect(t.sessions.reopenable()?.workspaceTrusted).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps the run result when the export fails, and says so', async () => {
    const sessionFile = join(sessionRoot(), 'foreign.jsonl')
    await writeFile(
      sessionFile,
      '{"type":"session","version":3,"id":"someone-else","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/x"}\n',
      'utf8'
    )
    const t = await setup({ sessionFile })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await expect(t.sessions.handleCommand(prompt('hi'))).resolves.toBe(true)
      expect(t.logs.join('\n')).toContain('session export failed')
      expect(t.types()).not.toContain('session_index_updated')
    } finally {
      await t.sessions.stop()
    }
  })
})

describe('durable command routing', () => {
  it('hands non-session commands back to the existing handlers', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(await t.sessions.handleCommand({ type: 'get_models', requestId: 'r' })).toBe(false)
      expect(await t.sessions.handleCommand({ type: 'get_settings', requestId: 'r' })).toBe(false)
      expect(await t.sessions.handleCommand({ type: 'start_session', cwd: '/work' })).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })

  it('does nothing at all when no durable session is active', async () => {
    const t = await setup()
    for (const cmd of [prompt('hi'), { type: 'abort' } as const, { type: 'stop' } as const]) {
      expect(await t.sessions.handleCommand(cmd)).toBe(false)
    }
    expect(t.sent).toEqual([])
  })

  it('stops the durable session on stop and lets the SDK handler finish the shutdown', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    expect(await t.sessions.handleCommand({ type: 'stop' })).toBe(false)
    expect(t.sessions.isActive()).toBe(false)
  })
})
