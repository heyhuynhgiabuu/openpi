import { appendFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { prompt, sessionRoot, setup, useSessionRoot } from './helpers/durableSession'
import { answer, idOf, lines, readable } from './helpers/forkSession'

/**
 * Phase 8.4a: a durable session survives a restart. A new sidecar has only the exported file, so
 * the store it names in the header is the whole of its memory.
 */

useSessionRoot()

type T = Awaited<ReturnType<typeof setup>>
const readies = (t: T) =>
  t.sent.filter(
    (m): m is Extract<(typeof t.sent)[number], { type: 'session_ready' }> =>
      m.type === 'session_ready'
  )

/** Start a session, talk in it, and drop the factory: the "before a restart" half of a test. */
async function beforeRestart(answers: string[]): Promise<{
  file: string
  sessionId: string
  messageCount: number
}> {
  const first = await setup({ persistent: true, answers })
  await first.sessions.start('/work', { workspaceTrusted: false })
  await first.sessions.handleCommand(prompt('first'))
  await first.sessions.handleCommand(prompt('second'))
  await first.sessions.handleCommand({ type: 'get_session_info', requestId: 'i' })
  const info = first.sent.filter((m) => m.type === 'session_info_result').at(-1)
  const messageCount = info && 'info' in info ? info.info.messageCount : -1
  await first.sessions.stop()
  return {
    file: first.identity.sessionFile,
    sessionId: first.identity.sessionId,
    messageCount,
  }
}

describe('durable session resume', () => {
  it('reopens the store after a restart, with the conversation it had', async () => {
    const before = await beforeRestart(['one', 'two'])
    // The same file path and store, opened by a runtime that never saw the first session.
    const after = await setup({ persistent: true, answers: ['three'], sessionFile: before.file })

    expect(await after.sessions.resumeFrom('/work', before.file, false, 'open-1')).toBe(true)
    const [ready] = readies(after)
    // The request that asked to open this session gets its answer, or it waits for a timeout.
    expect(ready?.requestId).toBe('open-1')
    expect(ready?.payload).toMatchObject({
      sessionId: before.sessionId,
      sessionFile: before.file,
      sessionName: null,
    })

    await after.sessions.handleCommand({ type: 'get_session_info', requestId: 'i' })
    const info = after.sent.filter((m) => m.type === 'session_info_result').at(-1)
    expect(info && 'info' in info ? info.info.messageCount : -1).toBe(before.messageCount)

    // It continues the same file rather than starting a second history.
    await after.sessions.handleCommand(prompt('third'))
    const text = await readFile(before.file, 'utf8')
    expect(text.match(/"first"/g)).toHaveLength(1)
    expect(text).toContain('"third"')
    await after.sessions.stop()
  })

  it('says it cannot resume a file this runtime did not write', async () => {
    const after = await setup({ persistent: true })
    const sdkFile = join(sessionRoot(), 'sdk.jsonl')
    await after.sessions
      .resumeFrom('/work', join(sessionRoot(), 'missing.jsonl'), false)
      .then((resumed) => expect(resumed).toBe(false))
    // A v3 file with no durable marker: the SDK path's, not ours.
    const { writeFile } = await import('node:fs/promises')
    await writeFile(
      sdkFile,
      `${JSON.stringify({ type: 'session', version: 3, id: 'sdk-1' })}\n`,
      'utf8'
    )
    expect(await after.sessions.resumeFrom('/work', sdkFile, false)).toBe(false)
    expect(readies(after)).toHaveLength(0)
    await after.sessions.stop()
  })

  it('refuses a file another runtime appended to, so those turns are not dropped', async () => {
    const before = await beforeRestart(['one', 'two'])
    // What the SDK path does to a file it opens: it appends, keeping the header it was given.
    await appendFile(
      before.file,
      `${JSON.stringify({
        type: 'message',
        id: 'ffff0001',
        parentId: '00000000',
        timestamp: new Date().toISOString(),
        message: { role: 'user', content: 'SDK-TURN', timestamp: Date.now() },
      })}\n`,
      'utf8'
    )
    const after = await setup({ persistent: true, sessionFile: before.file })

    expect(await after.sessions.resumeFrom('/work', before.file, false)).toBe(false)
    expect(readies(after)).toHaveLength(0)
    // And the turn the other runtime wrote is still there.
    expect(await readFile(before.file, 'utf8')).toContain('SDK-TURN')
    await after.sessions.stop()
  })

  it('refuses to reopen a session whose store is gone instead of writing an empty one', async () => {
    const before = await beforeRestart(['one', 'two'])
    // A restart on a machine where the store was cleaned: the file is there, the store is not.
    await rm(join(sessionRoot(), 'store'), { recursive: true, force: true })
    const after = await setup({ persistent: true, sessionFile: before.file })

    await expect(after.sessions.resumeFrom('/work', before.file, false)).rejects.toThrow(
      /store for this session is missing/
    )
    // The session's history is untouched: nothing was written over it.
    const text = await readFile(before.file, 'utf8')
    expect(text).toContain('"first"')
    expect(text).toContain('"second"')
    expect(readies(after)).toHaveLength(0)
    await after.sessions.stop()
  })

  it('reopens a navigated session on the branch it was left on', async () => {
    let request = ''
    const first = await setup({ persistent: true, answers: ['a1', 'a2', 'a3'] })
    await first.sessions.start('/work', { workspaceTrusted: false })
    await first.sessions.handleCommand(prompt('q1'))
    await first.sessions.handleCommand(prompt('q2'))
    const a1 = idOf(await lines(first.identity.sessionFile), 'a1')
    await first.sessions.handleCommand({ type: 'navigate_tree', entryId: a1, requestId: 'n' })
    await first.sessions.handleCommand(prompt('q3'))
    await first.sessions.stop()

    const after = await setup({
      persistent: true,
      sessionFile: first.identity.sessionFile,
      responses: [
        async (context) => {
          request = readable(context.messages)
          return answer('a4')
        },
      ],
    })
    expect(await after.sessions.resumeFrom('/work', first.identity.sessionFile, false)).toBe(true)
    // The branch it moved to, not the abandoned one, and with every branch still in the file.
    await after.sessions.handleCommand(prompt('q4'))
    expect(request).toContain('q3')
    expect(request).not.toContain('q2')
    const file = await readFile(first.identity.sessionFile, 'utf8')
    expect(file).toContain('"q2"')
    await after.sessions.stop()
  })
})
