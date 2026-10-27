/**
 * Process half of the shipped-path harness: forks the bundled sidecar, logs
 * what it sends, and resolves waiters against that traffic.
 *
 * Two kinds of wait exist, and the difference matters for ordering assertions:
 * - `waitFor` only sees messages that arrive after it is called: a stale inbox
 *   entry must never answer a later request.
 * - `waitForEvent` / `waitForError` also scan the log from an index the caller
 *   took earlier, so an event that lands between "send a command" and "start
 *   waiting" is not lost. The scan and the registration run in one tick, so no
 *   message can slip between them.
 */
import { fork, type ChildProcess } from 'node:child_process'
import { sidecarMessageSchema } from '../../electron/pi/sidecarContracts'
import type { SidecarCommand, SidecarMessage } from '../../electron/pi/sidecarTypes'
import { readSessionEvent, type SessionEvent } from './shippedReplies'

/** An `error` message the sidecar sent: a command it could not run. */
export interface SidecarError {
  requestId?: string
  message: string
}

export interface SidecarTransport {
  /** Every session_event received so far, in arrival order. */
  events: SessionEvent[]
  /** Every `error` message received so far, in arrival order. */
  errors: SidecarError[]
  stderr(): string
  send(command: SidecarCommand): void
  /** Resolves with the first message from now on that matches. */
  waitFor(
    predicate: (message: SidecarMessage) => boolean,
    timeoutMs: number
  ): Promise<SidecarMessage>
  /** Resolves with the first event at or after log index `since` that matches. */
  waitForEvent(
    predicate: (event: SessionEvent) => boolean,
    since: number,
    timeoutMs: number
  ): Promise<SessionEvent>
  /** Resolves with the first sidecar error at or after log index `since`. */
  waitForError(since: number, timeoutMs: number): Promise<SidecarError>
  /** Asks the child to stop, then kills it. */
  stop(): Promise<void>
}

interface Waiter {
  predicate: (message: SidecarMessage) => boolean
  resolve: (message: SidecarMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Forks the bundle with HOME pointed at `home`; the sidecar entry is the real one. */
export function startTransport(bundle: string, home: string): SidecarTransport {
  let childStderr = ''
  // First malformed session_event: fails pending and later waits with its detail.
  let protocolError: Error | null = null
  const waiters: Waiter[] = []
  const events: SessionEvent[] = []
  const errors: SidecarError[] = []

  const child: ChildProcess = fork(bundle, [], {
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      OPENPI_BRIDGE_APP: 'openpi',
      PI_OFFLINE: '1',
      PI_SKIP_VERSION_CHECK: '1',
    },
  })

  const send = (command: SidecarCommand): void => {
    child.send(command)
  }

  const waitFor: SidecarTransport['waitFor'] = (predicate, timeoutMs) =>
    new Promise<SidecarMessage>((resolve, reject) => {
      if (protocolError) {
        reject(protocolError)
        return
      }
      const timer = setTimeout(() => {
        reject(
          new Error(
            `timed out after ${timeoutMs}ms waiting for sidecar message.\nstderr: ${childStderr}`
          )
        )
      }, timeoutMs)
      waiters.push({ predicate, resolve, reject, timer })
    })

  child.on('message', (raw: unknown) => {
    const parsed = sidecarMessageSchema.safeParse(raw)
    if (!parsed.success) {
      protocolError = new Error(`malformed sidecar message: ${parsed.error.message}`)
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer)
        waiter.reject(protocolError)
      }
      return
    }
    const message: SidecarMessage = parsed.data
    try {
      if (message.type === 'session_event') events.push(readSessionEvent(message))
      if (message.type === 'error') {
        errors.push({ requestId: message.requestId, message: message.message })
      }
      const index = waiters.findIndex((waiter) => waiter.predicate(message))
      if (index !== -1) {
        const [waiter] = waiters.splice(index, 1)
        clearTimeout(waiter?.timer)
        waiter?.resolve(message)
      }
    } catch (error) {
      protocolError = error instanceof Error ? error : new Error(String(error))
      for (const waiter of waiters.splice(0)) {
        clearTimeout(waiter.timer)
        waiter.reject(protocolError)
      }
    }
  })
  child.stdout?.on('data', () => {}) // drain so a verbose child cannot fill the pipe
  child.stderr?.on('data', (chunk: Buffer) => {
    childStderr += chunk.toString()
  })

  return {
    events,
    errors,
    stderr: () => childStderr,
    send,
    waitFor,

    async waitForEvent(predicate, since, timeoutMs) {
      const logged = events.slice(since).find(predicate)
      if (logged) return logged
      const message = await waitFor(
        (candidate) => candidate.type === 'session_event' && predicate(readSessionEvent(candidate)),
        timeoutMs
      )
      return readSessionEvent(message)
    },

    async waitForError(since, timeoutMs) {
      const logged = errors[since]
      if (logged) return logged
      const message = await waitFor((candidate) => candidate.type === 'error', timeoutMs)
      if (message.type !== 'error') throw new Error('waiter matched a non-error message')
      return { requestId: message.requestId, message: message.message }
    },

    async stop() {
      const exiting = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      try {
        send({ type: 'stop' })
      } catch {
        // child may already be gone
      }
      child.kill()
      // Cap the wait: exit is normally immediate; kill() above covers stragglers.
      await Promise.race([exiting, sleep(1000)])
    },
  }
}
