import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { answer, readable } from './helpers/forkSession'
import { prompt, sessionRoot, setup, useSessionRoot, waitFor } from './helpers/durableSession'

/**
 * Wiring between the durable session factory and the harness it drives. Each piece is unit-tested
 * elsewhere; these are the seams where a broken connection would leave every such test green —
 * `send()` expanding before submitting, the factory exposing the harness's slash commands, and a
 * restore reopening with the session's own trust.
 */

useSessionRoot()

describe('wiring between the durable session and its harness', () => {
  it('expands a slash prompt exactly once, through the real harness', async () => {
    // A template whose body starts with another known command: `/ship` renders `/deploy --prod`,
    // and the model must read that body rather than the `deploy` template substituted into it.
    // Both templates are really discovered, so the actual expander runs wherever it runs — and this
    // fails if `harness.prompt` expands what `renderInput` already did.
    const agentDir = join(sessionRoot(), 'agent')
    await mkdir(join(agentDir, 'prompts'), { recursive: true })
    await writeFile(
      join(agentDir, 'prompts', 'deploy.md'),
      '---\ndescription: d\n---\nDEPLOY BODY\n'
    )
    await writeFile(
      join(agentDir, 'prompts', 'ship.md'),
      '---\ndescription: s\n---\n/deploy --prod\n'
    )
    const seen: string[] = []
    const t = await setup({
      userAgentDir: agentDir,
      // Discovery needs a workspace too: without one it returns nothing, by design.
      workspacePath: sessionRoot(),
      responses: [
        (context: { messages: readonly { role: string }[] }) => {
          seen.push(readable(context.messages))
          return answer('ok')
        },
        answer('ok'),
      ],
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      const harness = t.harnesses[0]
      // Straight at the harness, so this is about expansion and not about the queueing layer.
      await harness?.prompt(harness.renderInput('/ship'))
      expect(seen.join('\n')).toContain('/deploy --prod')
      expect(seen.join('\n')).not.toContain('DEPLOY BODY')
    } finally {
      await t.sessions.stop()
    }
  })

  it('expands a steered template exactly once too', async () => {
    // The same double-expansion could come back on `queue` (`harness.queue`), so the twin of the
    // prompt test: `/ship` renders `/deploy --prod`, and the model must read that body.
    const agentDir = join(sessionRoot(), 'agent')
    await mkdir(join(agentDir, 'prompts'), { recursive: true })
    await writeFile(
      join(agentDir, 'prompts', 'deploy.md'),
      '---\ndescription: d\n---\nDEPLOY BODY\n'
    )
    await writeFile(
      join(agentDir, 'prompts', 'ship.md'),
      '---\ndescription: s\n---\n/deploy --prod\n'
    )
    const seen: string[] = []
    const t = await setup({
      userAgentDir: agentDir,
      workspacePath: sessionRoot(),
      responses: [
        (context: { messages: readonly { role: string }[] }) => {
          seen.push(readable(context.messages))
          return answer('ok')
        },
        answer('ok'),
        answer('ok'),
      ],
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand({ type: 'steer', text: '/ship' })
      await waitFor(() => seen.length > 0, 'the steered run')
      expect(seen.join('\n')).toContain('/deploy --prod')
      expect(seen.join('\n')).not.toContain('DEPLOY BODY')
    } finally {
      await t.sessions.stop()
    }
  })

  it('expands through the harness on the send path, not just in the harness', async () => {
    // `send()` is the only caller of `promptOnce`, so if it stops expanding, every `/template`
    // prompt is refused and steer/follow-up templates reach the model as literal text — with every
    // unit test still green.
    const t = await setup({ answers: ['ok'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
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
    // The factory is what `sidecar.ts` asks, so a gap between it and the harness is a gap in the
    // picker — invisible to a test of either piece alone.
    const t = await setup({ answers: ['ok'] })
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
    // Trust is per workspace and decides whether that workspace's MCP servers start, so a restore
    // must reopen with this session's value rather than whatever request happened to fail.
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
      // Both directions matter: an untrusted workspace must not come back trusted, which is the
      // escalation the fix is about. A test that only ever sees `true` cannot tell a real read
      // from a hardcoded one.
      await t.sessions.start('/work', { workspaceTrusted: false })
      expect(t.sessions.reopenable()?.workspaceTrusted).toBe(false)
    } finally {
      await t.sessions.stop()
    }
  })
})

describe('the picker pipeline, end to end', () => {
  it('lists a discovered template through the real harness, not just a stub', async () => {
    // Three pieces in a row: discovery → harness.promptCommands → factory.promptCommands, which is
    // what `sidecar.ts` asks. Testing any one of them alone leaves the other two free to break.
    const agentDir = join(sessionRoot(), 'agent')
    await mkdir(join(agentDir, 'prompts'), { recursive: true })
    await writeFile(
      join(agentDir, 'prompts', 'audit.md'),
      '---\ndescription: Audit it\n---\nAUDIT\n'
    )
    const t = await setup({ userAgentDir: agentDir, workspacePath: sessionRoot(), answers: ['ok'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      expect(t.sessions.promptCommands()).toEqual([
        { name: 'audit', description: 'Audit it', argHint: undefined },
      ])
    } finally {
      await t.sessions.stop()
    }
  })
})
