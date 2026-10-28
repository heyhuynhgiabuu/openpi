import { existsSync, realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { convertToLlm, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'
import { bashText } from '../electron/pi/durable/bash'
import type { SidecarCommand, SidecarMessage } from '../electron/pi/sidecarTypes'
import { bashExecutionResultSchema } from '../src/lib/ipc'
import { prompt, sessionRoot, setup, useSessionRoot } from './helpers/durableSession'

/**
 * Phase 8.3n: `execute_bash` (the composer's `!` command) on a durable session: real processes,
 * the renderer's own result schema, and the real SDK reading the exported file back.
 */

useSessionRoot()

const bash = (command: string, excludeFromContext?: boolean): SidecarCommand => ({
  type: 'execute_bash',
  requestId: 'b1',
  command,
  excludeFromContext,
})

function lastResult(sent: SidecarMessage[]) {
  const message = sent.filter((m) => m.type === 'bash_result').at(-1)
  return bashExecutionResultSchema.parse(message && 'result' in message ? message.result : null)
}

async function session(answers?: string[]) {
  const t = await setup({ workspacePath: sessionRoot(), answers })
  await t.sessions.start('/work', { workspaceTrusted: false })
  return t
}

describe('durable execute_bash', () => {
  it('runs in the workspace and returns combined output and the exit code', async () => {
    const t = await session()
    try {
      await t.sessions.handleCommand(bash('pwd; echo oops >&2; exit 3'))
      const result = lastResult(t.sent)
      expect(result).toMatchObject({ exitCode: 3, cancelled: false, truncated: false })
      expect(result.output).toContain(realpathSync(sessionRoot()))
      expect(result.output).toContain('oops')
    } finally {
      await t.sessions.stop()
    }
  })

  it('strips terminal colour codes from the output', async () => {
    const t = await session()
    try {
      await t.sessions.handleCommand(bash("printf '\\033[31mred\\033[0m\\n'"))
      expect(lastResult(t.sent).output.trim()).toBe('red')
    } finally {
      await t.sessions.stop()
    }
  })

  it('strips a colour code that arrives split across two chunks', async () => {
    const t = await session()
    try {
      await t.sessions.handleCommand(bash("printf '\\033[3'; sleep 0.3; printf '1mred\\033[0m\\n'"))
      expect(lastResult(t.sent).output.trim()).toBe('red')
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps only the tail of long output, spilling the full text to a file', async () => {
    const t = await session()
    try {
      await t.sessions.handleCommand(bash('seq 1 5000'))
      const result = lastResult(t.sent)
      expect(result.truncated).toBe(true)
      expect(result.output).toContain('5000')
      expect(result.output).not.toMatch(/^1$/m)
      expect(result.fullOutputPath && existsSync(result.fullOutputPath)).toBe(true)
    } finally {
      await t.sessions.stop()
    }
  })

  it('shows the model what the user ran, unless excluded', async () => {
    const t = await session()
    try {
      const count = async () => {
        await t.sessions.handleCommand({ type: 'get_session_info', requestId: 'i' })
        const info = t.sent.filter((m) => m.type === 'session_info_result').at(-1)
        return info && 'info' in info ? info.info.messageCount : -1
      }
      expect(await count()).toBe(0)
      await t.sessions.handleCommand(bash('echo seen'))
      expect(await count()).toBe(1)
      await t.sessions.handleCommand(bash('echo hidden', true))
      expect(await count()).toBe(1)
    } finally {
      await t.sessions.stop()
    }
  })

  it('exports bashExecution messages that the real SDK reads back as the same context', async () => {
    const t = await session(['an answer'])
    try {
      await t.sessions.handleCommand(bash('echo seen; exit 2'))
      await t.sessions.handleCommand(bash('echo hidden', true))
      await t.sessions.handleCommand(prompt('a question'))

      const lines = (await readFile(t.identity.sessionFile, 'utf8'))
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { type: string; message?: { role: string; command?: string } })
      const ran = lines.filter((l) => l.message?.role === 'bashExecution')
      expect(ran.map((l) => l.message?.command)).toEqual(['echo seen; exit 2', 'echo hidden'])

      const context = SessionManager.open(
        t.identity.sessionFile,
        undefined,
        '/work'
      ).buildSessionContext()
      const llm = JSON.stringify(convertToLlm(context.messages))
      // The SDK's own conversion yields the text the durable model message carries.
      expect(llm).toContain(
        JSON.stringify(bashText(parsed('echo seen; exit 2', 'seen\n', 2))).slice(1, -1)
      )
      expect(llm).not.toContain('hidden')
    } finally {
      await t.sessions.stop()
    }
  })

  it('exports right after the command, with no prompt needed', async () => {
    const t = await session()
    try {
      await t.sessions.handleCommand(bash('echo alone'))
      expect(await readFile(t.identity.sessionFile, 'utf8')).toContain('bashExecution')
      expect(t.types()).toContain('session_index_updated')
    } finally {
      await t.sessions.stop()
    }
  })

  it('settles promptly when the session stops under a running command', async () => {
    const t = await session()
    const running = t.sessions.handleCommand(bash('sleep 30')).then(
      () => 'resolved',
      () => 'rejected'
    )
    await new Promise((resolve) => setTimeout(resolve, 300))
    const started = Date.now()
    await t.sessions.stop()
    await running
    expect(Date.now() - started).toBeLessThan(5000)
  })
})

function parsed(command: string, output: string, exitCode: number) {
  return { command, output, exitCode, cancelled: false, truncated: false, timestamp: 0 }
}
