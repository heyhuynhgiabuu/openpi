import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import type { ResolvedModel } from '../electron/pi/durableSettings'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { latestSessionName, parseSessionFile } from '../electron/session/sessionEntries'
import { MODEL, prompt, setup, useSessionRoot } from './helpers/durableSession'

/**
 * Phase 8.3j: set_model, set_thinking and set_session_name on a durable session.
 */

useSessionRoot()

const OTHER: ResolvedModel = {
  info: { id: 'other', name: 'Other', provider: 'faux', reasoning: true, contextWindow: 2000 },
  thinkingLevels: ['off'],
}
const knownModels = { 'faux/other': OTHER }

async function info(t: Awaited<ReturnType<typeof setup>>, requestId: string) {
  await t.sessions.handleCommand({ type: 'get_session_info', requestId })
  const reply = t.sent
    .filter((m): m is Extract<SidecarMessage, { type: 'session_info_result' }> => {
      return m.type === 'session_info_result'
    })
    .at(-1)
  return reply?.info
}

describe('durable set_thinking', () => {
  it('starts at the harness level and reports it in session_ready', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(t.sent[0]).toMatchObject({ type: 'session_ready', payload: { thinkingLevel: 'off' } })
    } finally {
      await t.sessions.stop()
    }
  })

  it('applies a supported level, saves it as the default, and reports it', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(await t.sessions.handleCommand({ type: 'set_thinking', level: 'low' })).toBe(true)
      expect((await t.harnesses[0]?.agentState())?.thinkingLevel).toBe('low')
      expect(t.persisted).toEqual(['thinking:low'])
      expect((await info(t, 'i1'))?.thinkingLevel).toBe('low')
    } finally {
      await t.sessions.stop()
    }
  })

  it('refuses a level the model does not support, loudly and without saving it', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_thinking', level: 'ultra' })
      expect((await t.harnesses[0]?.agentState())?.thinkingLevel).toBe('off')
      expect(t.persisted).toEqual([])
      expect(t.logs.join('\n')).toContain("thinking level 'ultra' is not supported")
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps the change when saving the default fails, and says so', async () => {
    const t = await setup({ failPersist: true })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await expect(t.sessions.handleCommand({ type: 'set_thinking', level: 'high' })).resolves.toBe(
        true
      )
      expect((await t.harnesses[0]?.agentState())?.thinkingLevel).toBe('high')
      expect(t.logs.join('\n')).toContain('could not save the default thinking level: disk full')
    } finally {
      await t.sessions.stop()
    }
  })
})

describe('durable set_model', () => {
  it('switches to a known model, saves it, and reports it', async () => {
    const t = await setup({ knownModels })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'other' })
      expect((await t.harnesses[0]?.agentState())?.model).toEqual({
        provider: 'faux',
        modelId: 'other',
      })
      expect(t.persisted).toEqual(['model:faux/other'])
      expect((await info(t, 'i2'))?.model).toEqual(OTHER.info)
    } finally {
      await t.sessions.stop()
    }
  })

  it("uses the new model's supported thinking levels afterwards", async () => {
    const t = await setup({ knownModels })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'other' })
      // `OTHER` only supports 'off', so 'low' (fine for the first model) is now refused.
      await t.sessions.handleCommand({ type: 'set_thinking', level: 'low' })
      expect(t.logs.join('\n')).toContain("thinking level 'low' is not supported")
    } finally {
      await t.sessions.stop()
    }
  })

  it('ignores an unknown model, keeping the current one', async () => {
    const t = await setup({ knownModels })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_model', provider: 'nope', modelId: 'ghost' })
      expect((await t.harnesses[0]?.agentState())?.model).toMatchObject({ modelId: 'faux-1' })
      expect(t.persisted).toEqual([])
      expect((await info(t, 'i3'))?.model).toEqual(MODEL)
      expect(t.logs.join('\n')).toContain('unknown model nope/ghost')
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps the change when saving the default fails', async () => {
    const t = await setup({ knownModels, failPersist: true })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'other' })
      expect((await t.harnesses[0]?.agentState())?.model).toMatchObject({ modelId: 'other' })
      expect(t.logs.join('\n')).toContain('could not save the default model: disk full')
    } finally {
      await t.sessions.stop()
    }
  })
})

describe('durable settings ordering', () => {
  const DEEP: ResolvedModel = {
    info: { id: 'deep', name: 'Deep', provider: 'faux', reasoning: true, contextWindow: 4000 },
    thinkingLevels: ['off', 'low', 'high', 'xhigh'],
  }

  it('runs a thinking change after a model change that is still resolving', async () => {
    let open = () => {}
    const resolveGate = new Promise<void>((resolve) => {
      open = resolve
    })
    const t = await setup({ knownModels: { 'faux/deep': DEEP }, resolveGate })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      // The first model has no 'xhigh'; only the model being switched to does.
      const switching = t.sessions.handleCommand({
        type: 'set_model',
        provider: 'faux',
        modelId: 'deep',
      })
      const thinking = t.sessions.handleCommand({ type: 'set_thinking', level: 'xhigh' })
      await new Promise((resolve) => setTimeout(resolve, 50))
      open()
      await Promise.all([switching, thinking])

      expect(t.logs.join('\n')).not.toContain('not supported')
      expect((await t.harnesses[0]?.agentState())?.thinkingLevel).toBe('xhigh')
      expect(t.persisted).toEqual(['model:faux/deep', 'thinking:xhigh'])
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)

  it('does not let a command that rejects block the next one', async () => {
    const t = await setup({ failResolve: true })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await expect(
        t.sessions.handleCommand({ type: 'set_model', provider: 'faux', modelId: 'deep' })
      ).rejects.toThrow(/registry offline/)
      await t.sessions.handleCommand({ type: 'set_thinking', level: 'high' })
      expect((await t.harnesses[0]?.agentState())?.thinkingLevel).toBe('high')
    } finally {
      await t.sessions.stop()
    }
  }, 30_000)
})

describe('durable set_session_name', () => {
  it('names the session for the sidebar and for get_session_info', async () => {
    const t = await setup({ answers: ['an answer'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('a question'))
      t.sent.length = 0
      await t.sessions.handleCommand({ type: 'set_session_name', name: '  Refactor auth  ' })

      expect(t.types()).toContain('session_index_updated')
      expect((await info(t, 'i4'))?.sessionName).toBe('Refactor auth')

      // The sidebar's own reader sees the name in the exported JSONL v3 file.
      const parsed = parseSessionFile(t.identity.sessionFile)
      expect(latestSessionName(parsed.entries)).toBe('Refactor auth')
      expect(await readFile(t.identity.sessionFile, 'utf8')).toContain('"type":"session_info"')
    } finally {
      await t.sessions.stop()
    }
  })

  it('does not count the rename as a conversation message', async () => {
    const t = await setup({ answers: ['an answer'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('a question'))
      await t.sessions.handleCommand({ type: 'set_session_name', name: 'Named' })
      // user + assistant only: the name is an entry, not a message.
      expect((await info(t, 'i5'))?.messageCount).toBe(2)
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps the previous name when given an empty one', async () => {
    const t = await setup()
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'set_session_name', name: 'First' })
      await t.sessions.handleCommand({ type: 'set_session_name', name: '   ' })
      expect((await info(t, 'i6'))?.sessionName).toBe('First')
    } finally {
      await t.sessions.stop()
    }
  })
})
