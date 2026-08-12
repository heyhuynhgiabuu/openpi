import { describe, expect, it } from 'vitest'
import { createSidecarCommandQueue } from '../electron/pi/sidecarCommandQueue'

function settleQueue(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function deferred() {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve: () => resolve?.() }
}

describe('sidecar session replacement queue', () => {
  it('serializes replacements and holds commands that arrive during replacement', async () => {
    const events: string[] = []
    const first = deferred()
    const queue = createSidecarCommandQueue(async (command) => {
      events.push(`start:${command.type}`)
      if (command.type === 'start_session') await first.promise
      events.push(`end:${command.type}`)
    })

    const firstRun = queue({ type: 'start_session', cwd: '/one' })
    const secondRun = queue({ type: 'reload_session', requestId: 'reload-1' })
    const promptRun = queue({ type: 'prompt', text: 'continue' })

    await settleQueue()
    expect(events).toEqual(['start:start_session'])
    first.resolve()
    await Promise.all([firstRun, secondRun, promptRun])
    expect(events).toEqual([
      'start:start_session',
      'end:start_session',
      'start:reload_session',
      'end:reload_session',
      'start:prompt',
      'end:prompt',
    ])
  })

  it('allows replacement to abort a prompt that was already running', async () => {
    const events: string[] = []
    const prompt = deferred()
    const queue = createSidecarCommandQueue(async (command) => {
      events.push(`start:${command.type}`)
      if (command.type === 'prompt') await prompt.promise
      events.push(`end:${command.type}`)
    })

    const promptRun = queue({ type: 'prompt', text: 'work' })
    await settleQueue()
    const replacementRun = queue({ type: 'reload_session', requestId: 'reload-1' })
    await settleQueue()

    expect(events).toEqual(['start:prompt', 'start:reload_session', 'end:reload_session'])
    prompt.resolve()
    await Promise.all([promptRun, replacementRun])
  })

  it('allows provider prompt responses to unblock login during replacement', async () => {
    const events: string[] = []
    const login = deferred()
    const queue = createSidecarCommandQueue(async (command) => {
      events.push(`start:${command.type}`)
      if (command.type === 'login_provider') await login.promise
      if (command.type === 'resolve_provider_prompt') login.resolve()
      events.push(`end:${command.type}`)
    })

    const loginRun = queue({ type: 'login_provider', requestId: 'login-1', providerId: 'provider' })
    await settleQueue()
    const reloadRun = queue({ type: 'reload_session', requestId: 'reload-1' })
    const responseRun = queue({
      type: 'resolve_provider_prompt',
      providerId: 'provider',
      value: 'answer',
    })

    await Promise.all([loginRun, reloadRun, responseRun])
    expect(events).toContain('start:resolve_provider_prompt')
    expect(events.at(-1)).toBe('end:reload_session')
  })

  it('waits for an already-running result command before replacing its session', async () => {
    const events: string[] = []
    const bash = deferred()
    const queue = createSidecarCommandQueue(async (command) => {
      events.push(`start:${command.type}`)
      if (command.type === 'execute_bash') await bash.promise
      events.push(`end:${command.type}`)
    })

    const bashRun = queue({ type: 'execute_bash', requestId: 'bash-1', command: 'pwd' })
    await settleQueue()
    const replacementRun = queue({
      type: 'fork_session',
      requestId: 'fork-1',
      entryId: 'entry',
      workspaceTrusted: true,
    })
    await settleQueue()

    expect(events).toEqual(['start:execute_bash'])
    bash.resolve()
    await Promise.all([bashRun, replacementRun])
    expect(events).toEqual([
      'start:execute_bash',
      'end:execute_bash',
      'start:fork_session',
      'end:fork_session',
    ])
  })

  it('serializes stop behind an active replacement', async () => {
    const events: string[] = []
    const reload = deferred()
    const queue = createSidecarCommandQueue(async (command) => {
      events.push(`start:${command.type}`)
      if (command.type === 'reload_session') await reload.promise
      events.push(`end:${command.type}`)
    })

    const reloadRun = queue({ type: 'reload_session', requestId: 'reload-1' })
    const stopRun = queue({ type: 'stop' })
    await settleQueue()
    expect(events).toEqual(['start:reload_session'])

    reload.resolve()
    await Promise.all([reloadRun, stopRun])
    expect(events).toEqual(['start:reload_session', 'end:reload_session', 'start:stop', 'end:stop'])
  })
})
