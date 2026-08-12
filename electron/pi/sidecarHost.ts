/**
 * piSidecarHost.ts — Thin bridge between Electron main and the Pi SDK sidecar.
 *
 * Main process stays Pi-SDK-free. All Pi SDK memory lives in the sidecar child process.
 * Main receives typed SidecarMessage events and routes them to renderer or handles locally.
 */

import { type ChildProcess, fork, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, type UtilityProcess, utilityProcess } from 'electron'
import type { SidecarCommand, SidecarMessage } from './sidecar'
import { sidecarCommandSchema, sidecarMessageSchema } from './sidecarContracts'

const currentDir = path.dirname(fileURLToPath(import.meta.url))

const SIDECAR_PATH = path.join(currentDir, 'piSidecar.js')
const SIDECAR_SERVICE_NAME = 'openpi-pi-sidecar'
const RESTART_DELAY_MS = 1500
const MAX_RESTARTS = 3

type SidecarProcess = UtilityProcess | ChildProcess

type PendingRequest = {
  resolve: (msg: SidecarMessage) => void
  reject: (err: Error) => void
  timeout: NodeJS.Timeout
  expectedTypes: ReadonlySet<SidecarMessage['type']>
}

function expectedResponseTypes(command: SidecarCommand): ReadonlySet<SidecarMessage['type']> {
  switch (command.type) {
    case 'start_session':
    case 'reload_session':
    case 'fork_session':
      return new Set(['session_ready'])
    case 'get_stats':
      return new Set(['stats_result'])
    case 'get_models':
      return new Set(['models_result'])
    case 'execute_bash':
      return new Set(['bash_result'])
    case 'compact':
      return new Set(['compact_result'])
    case 'get_session_info':
      return new Set(['session_info_result'])
    case 'copy_last_assistant_text':
      return new Set(['last_assistant_text_result'])
    case 'get_settings':
      return new Set(['settings_result'])
    case 'get_default_project_trust':
      return new Set(['default_project_trust_result'])
    case 'get_providers':
      return new Set(['providers_result'])
    case 'set_provider_key':
    case 'remove_provider_key':
    case 'logout_provider':
      return new Set(['provider_mutation_result'])
    case 'login_provider':
      return new Set(['provider_login_event'])
    case 'list_prompt_templates':
      return new Set(['prompt_templates_result'])
    case 'list_slash_commands':
      return new Set(['slash_commands_result'])
    case 'list_skills':
      return new Set(['skills_result'])
    case 'read_skill_file':
      return new Set(['skill_file_result'])
    default:
      throw new Error(`Sidecar command does not support request correlation: ${command.type}`)
  }
}

function isUtilityProcess(child: SidecarProcess): child is UtilityProcess {
  return 'postMessage' in child
}

function findNodeExecutable(): string | null {
  // In the packaged app every module (including the Pi SDK) lives inside
  // app.asar. Standalone node cannot read ASAR archives, so the sidecar
  // would fail to require('@earendil-works/pi-coding-agent') and crash
  // immediately. Electron's utilityProcess has native ASAR support, so
  // always use it when packaged.
  if (app.isPackaged) return null

  // In development, prefer regular Node so user extensions with native
  // dependencies (e.g. better-sqlite3 in DCP) use the system-Node ABI
  // they were installed/rebuilt for.
  const candidates = [process.env.OPENPI_NODE_EXECUTABLE, 'node'].filter(
    (candidate): candidate is string => Boolean(candidate)
  )

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-e', 'process.exit(process.versions.electron ? 1 : 0)'], {
      encoding: 'utf-8',
      timeout: 3000,
    })
    if (result.status === 0) return candidate
  }

  return null
}

function requestIdFromUnknown(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || !('requestId' in value)) return undefined
  return typeof value.requestId === 'string' ? value.requestId : undefined
}

function sendToSidecar(child: SidecarProcess, command: SidecarCommand): void {
  const parsedCommand = sidecarCommandSchema.parse(command)
  if (isUtilityProcess(child)) {
    child.postMessage(parsedCommand)
    return
  }
  child.send(parsedCommand)
}

export class PiSidecarHost {
  private child: SidecarProcess | null = null
  private readonly onMessage: (msg: SidecarMessage) => void
  private readonly onCrash: () => void
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private restartCount = 0
  private stopping = false
  /** Partial-line buffers: chunks may split across line boundaries. */
  private _stdoutBuf = ''
  private _stderrBuf = ''

  constructor(opts: {
    onMessage: (msg: SidecarMessage) => void
    onCrash: () => void
  }) {
    this.onMessage = opts.onMessage
    this.onCrash = opts.onCrash
  }

  /** PID of the sidecar child process, or undefined before spawn. */
  get workerPid(): number | undefined {
    return this.child?.pid
  }

  start(): void {
    this.stopping = false
    this.restartCount = 0
    this.spawnChild()
  }

  private spawnChild(): void {
    const nodeExecutable = findNodeExecutable()
    // Let the openpi-bridge extension identify itself as OpenPi
    const bridgeEnv = { ...process.env, OPENPI_BRIDGE_APP: 'openpi' }
    const child: SidecarProcess = nodeExecutable
      ? fork(SIDECAR_PATH, [], {
          execPath: nodeExecutable,
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          env: bridgeEnv,
        })
      : utilityProcess.fork(SIDECAR_PATH, [], {
          serviceName: SIDECAR_SERVICE_NAME,
          stdio: 'pipe',
          env: bridgeEnv,
        })

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(`[piSidecar] ${chunk.toString('utf8').trimEnd()}\n`)
      // Accumulate until a newline boundary so partial chunks don't produce
      // truncated log entries in the Output pane.
      this._stdoutBuf += chunk.toString('utf8')
      const parts = this._stdoutBuf.split('\n')
      this._stdoutBuf = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        this.onMessage({
          type: 'output_append',
          line: { level: 'info', text: `[sidecar] ${line}`, ts: Date.now() },
        })
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[piSidecar] ${chunk.toString('utf8').trimEnd()}\n`)
      this._stderrBuf += chunk.toString('utf8')
      const parts = this._stderrBuf.split('\n')
      this._stderrBuf = parts.pop() ?? ''
      for (const line of parts) {
        if (!line.trim()) continue
        this.onMessage({
          type: 'output_append',
          line: { level: 'error', text: `[sidecar] ${line}`, ts: Date.now() },
        })
      }
    })

    child.on('message', (msg: unknown) => {
      const parsedMessage = sidecarMessageSchema.safeParse(msg)
      if (!parsedMessage.success) {
        const requestId = requestIdFromUnknown(msg)
        const pending = requestId ? this.pendingRequests.get(requestId) : undefined
        if (requestId && pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(requestId)
          pending.reject(new Error('Pi sidecar returned a malformed response'))
        }
        this.onMessage({
          type: 'output_append',
          line: { level: 'error', text: '[sidecar] rejected malformed message', ts: Date.now() },
        })
        return
      }
      const message = parsedMessage.data
      const requestId = 'requestId' in message ? message.requestId : undefined
      if (requestId) {
        const pending = this.pendingRequests.get(requestId)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(requestId)
          if (message.type === 'error' || message.type === 'session_error') {
            pending.reject(new Error(message.message))
          } else if (!pending.expectedTypes.has(message.type)) {
            pending.reject(
              new Error(`Pi sidecar returned ${message.type} for an incompatible request`)
            )
          } else {
            pending.resolve(message)
          }
          return
        }
        if (
          message.type === 'session_ready' ||
          message.type === 'session_error' ||
          message.type === 'error'
        ) {
          this.onMessage({
            type: 'output_append',
            line: {
              level: 'warn',
              text: '[sidecar] ignored an orphaned session replacement result',
              ts: Date.now(),
            },
          })
          return
        }
      }
      this.onMessage(message)
    })

    ;(child as unknown as { on(event: 'exit', listener: (code: number | null) => void): void }).on(
      'exit',
      (code) => {
        this.child = null
        for (const pending of this.pendingRequests.values()) {
          clearTimeout(pending.timeout)
          pending.reject(new Error(`Pi sidecar exited with code ${code}`))
        }
        this.pendingRequests.clear()
        // Flush any partial line remaining in the buffers at process exit.
        for (const [buf, level] of [
          [this._stdoutBuf, 'info' as const],
          [this._stderrBuf, 'error' as const],
        ] as const) {
          if (buf.trim()) {
            this.onMessage({
              type: 'output_append',
              line: { level, text: `[sidecar] ${buf}`, ts: Date.now() },
            })
          }
        }
        this._stdoutBuf = ''
        this._stderrBuf = ''
        if (this.stopping) return
        const exitMsg = `[sidecar] process exited with code ${code ?? 'null'}`
        process.stderr.write(`[piSidecarHost] sidecar exited with code ${code}\n`)
        this.onMessage({
          type: 'output_append',
          line: { level: 'error', text: exitMsg, ts: Date.now() },
        })
        if (this.restartCount < MAX_RESTARTS) {
          this.restartCount++
          const retryMsg = `[sidecar] restarting (attempt ${this.restartCount}/${MAX_RESTARTS}) in ${RESTART_DELAY_MS}ms…`
          this.onMessage({
            type: 'output_append',
            line: { level: 'warn', text: retryMsg, ts: Date.now() },
          })
          setTimeout(() => {
            if (!this.stopping) this.spawnChild()
          }, RESTART_DELAY_MS)
        } else {
          this.onMessage({
            type: 'output_append',
            line: {
              level: 'error',
              text: '[sidecar] max restarts reached — giving up',
              ts: Date.now(),
            },
          })
          this.onCrash()
        }
      }
    )

    this.child = child
  }

  send(command: SidecarCommand): void {
    if (this.child) sendToSidecar(this.child, command)
  }

  request<T extends SidecarMessage>(
    command: SidecarCommand & { requestId: string },
    timeoutMs = 60_000
  ): Promise<T> {
    if (!this.child) return Promise.reject(new Error('Pi sidecar is not running'))

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(command.requestId)
        reject(new Error(`Pi sidecar request timed out: ${command.type}`))
      }, timeoutMs)

      this.pendingRequests.set(command.requestId, {
        resolve: (msg) => resolve(msg as T),
        reject,
        timeout,
        expectedTypes: expectedResponseTypes(command),
      })
      sendToSidecar(this.child!, command)
    })
  }

  stop(): Promise<void> {
    this.stopping = true
    if (!this.child) return Promise.resolve()

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.child?.kill()
        resolve()
      }, 4000)

      const cleanup = (msg: unknown) => {
        const parsedMessage = sidecarMessageSchema.safeParse(msg)
        if (parsedMessage.success && parsedMessage.data.type === 'stopped') {
          clearTimeout(timeout)
          resolve()
        }
      }

      this.child!.on('message', cleanup)
      sendToSidecar(this.child!, { type: 'stop' } satisfies SidecarCommand)
    })
  }
}
