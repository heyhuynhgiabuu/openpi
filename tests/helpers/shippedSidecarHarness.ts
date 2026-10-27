/**
 * Shared harness for the shipped-path codemode tests: bundles the real sidecar
 * entry like the electron-vite build, forks it as a child process, routes its
 * IPC messages to waiters, and owns the temp HOME and workspace.
 *
 * Only the model boundary is scripted: tests/fixtures/scripted-provider-extension.js
 * is installed as an extension (project or global, see `providerScope`), so the
 * provider is discovered through the same route a real extension takes.
 *
 * Isolation follows shippedPath.test.ts: HOME/USERPROFILE point at a fresh temp
 * dir, so the developer's real ~/.pi/agent is never touched.
 */
import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
// Transitive dep of vite/electron-vite, declared in devDependencies for this
// test: reused so the test bundles the sidecar entry like the real build.
import { build as esbuildBuild } from 'esbuild'
import type { SidecarMessage } from '../../electron/pi/sidecarTypes'
import {
  parseReply,
  readSessionEvent,
  sessionInfoReply,
  sessionReadyReply,
  type SessionEvent,
} from './shippedReplies'

export type { SessionEvent }

export interface SidecarHarnessOptions {
  /** Names the bundle and workspace cache dir. Test files use distinct names. */
  cacheName: string
  /** Written to <workspace>/.pi/settings.json when given. */
  projectSettings?: Record<string, unknown>
  /** Written to <HOME>/.pi/agent/settings.json when given. */
  globalSettings?: Record<string, unknown>
  /** Trust passed to start_session. Defaults to trusted. */
  workspaceTrusted?: boolean
  /**
   * Where the scripted provider is installed. `project` loads it from
   * <workspace>/.pi/extensions (trusted only); `global` from
   * <HOME>/.pi/agent/extensions, which loads regardless of trust.
   */
  providerScope?: 'project' | 'global'
}

export interface SidecarHarness {
  /** The child's HOME: session files must land under it. */
  home: string
  workspace: string
  /** Every session_event received so far, in arrival order. */
  events: SessionEvent[]
  /** Starts a session in the workspace at the harness trust level. Resolves with its session file, or null. */
  startSession(requestId: string, sessionFile?: string): Promise<string | null>
  /** Selects the scripted model and polls until get_session_info reports it. */
  selectScriptedModel(): Promise<void>
  /** Sends a prompt and resolves when the agent loop ends. */
  prompt(text: string): Promise<void>
  /** Reads get_session_info for the active session. */
  sessionInfo(requestId: string): Promise<{ messageCount: number }>
  /** Stops the child and removes the temp HOME and workspace. */
  dispose(): Promise<void>
}

const REPO_ROOT = process.cwd()
const SIDECAR_ENTRY = path.join(REPO_ROOT, 'electron', 'pi', 'sidecar.ts')
const FIXTURE_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'scripted-provider-extension.js')
const MODEL_READY_TIMEOUT_MS = 30_000
const REPLY_TIMEOUT_MS = 30_000
const READY_TIMEOUT_MS = 60_000
const AGENT_END_TIMEOUT_MS = 60_000

interface Waiter {
  predicate: (message: SidecarMessage) => boolean
  resolve: (message: SidecarMessage) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function bundleSidecar(bundle: string): Promise<void> {
  fs.mkdirSync(path.dirname(bundle), { recursive: true })
  await esbuildBuild({
    entryPoints: [SIDECAR_ENTRY],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node20',
    logLevel: 'silent',
  })
}

function writeJson(file: string, value: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value))
}

/** Lays out HOME and the workspace: the provider fixture and any settings files. */
function layoutFixtures(home: string, workspace: string, options: SidecarHarnessOptions): void {
  const providerDir =
    options.providerScope === 'global'
      ? path.join(home, '.pi', 'agent', 'extensions')
      : path.join(workspace, '.pi', 'extensions')
  fs.mkdirSync(providerDir, { recursive: true })
  fs.copyFileSync(FIXTURE_PATH, path.join(providerDir, 'scripted-provider.js'))
  if (options.projectSettings) {
    writeJson(path.join(workspace, '.pi', 'settings.json'), options.projectSettings)
  }
  if (options.globalSettings) {
    writeJson(path.join(home, '.pi', 'agent', 'settings.json'), options.globalSettings)
  }
}

/**
 * Bundles and forks the sidecar, then returns a handle. Messages that arrive
 * before a waiter is registered never satisfy it: stale inbox entries must not
 * answer later requests.
 */
export async function startSidecarHarness(options: SidecarHarnessOptions): Promise<SidecarHarness> {
  const workspaceTrusted = options.workspaceTrusted ?? true
  const cacheDir = path.join(
    REPO_ROOT,
    'node_modules',
    '.cache',
    `openpi-shipped-${options.cacheName}`
  )
  const bundle = path.join(cacheDir, 'piSidecar.mjs')
  // Bundle first: a failed build must not leave temp dirs behind.
  await bundleSidecar(bundle)

  // HOME and workspace both live under the repo cache: the fixture's
  // `@earendil-works/pi-ai` import resolves from the repo's node_modules only
  // when the extension sits inside the repo tree, wherever it is installed.
  // The real ~/.pi/agent is still never touched: HOME is a fresh temp dir.
  const home = fs.mkdtempSync(path.join(cacheDir, 'home-'))
  const workspace = fs.mkdtempSync(path.join(cacheDir, 'workspace-'))
  layoutFixtures(home, workspace, options)

  let childStderr = ''
  // First malformed session_event: fails pending and later waits with its detail.
  let protocolError: Error | null = null
  const waiters: Waiter[] = []
  const events: SessionEvent[] = []

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

  const send = (command: Record<string, unknown>): void => {
    child.send(command)
  }

  const waitFor = (predicate: Waiter['predicate'], timeoutMs: number) =>
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

  child.on('message', (message: SidecarMessage) => {
    try {
      if (message.type === 'session_event') events.push(readSessionEvent(message))
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

  let modelChecks = 0

  return {
    home,
    workspace,
    events,

    async startSession(requestId, sessionFile) {
      const command: Record<string, unknown> = {
        type: 'start_session',
        cwd: workspace,
        workspaceTrusted,
        requestId,
      }
      if (sessionFile) command.sessionFile = sessionFile
      send(command)
      const ready = await waitFor(
        (message) => message.type === 'session_ready' && message.requestId === requestId,
        READY_TIMEOUT_MS
      )
      return parseReply(sessionReadyReply, ready).payload.sessionFile
    },

    async selectScriptedModel() {
      send({ type: 'set_model', provider: 'scripted', modelId: 'scripted-write' })
      const deadline = Date.now() + MODEL_READY_TIMEOUT_MS
      while (Date.now() < deadline) {
        modelChecks += 1
        const requestId = `model-check-${modelChecks}`
        send({ type: 'get_session_info', requestId })
        const reply = await waitFor(
          (message) => message.type === 'session_info_result' && message.requestId === requestId,
          REPLY_TIMEOUT_MS
        )
        const { info } = parseReply(sessionInfoReply, reply)
        if (info.model?.provider === 'scripted') return
        await sleep(50)
      }
      throw new Error(`model never became 'scripted'; stderr: ${childStderr}`)
    },

    async prompt(text) {
      send({ type: 'prompt', text })
      await waitFor(
        (message) =>
          message.type === 'session_event' && readSessionEvent(message).type === 'agent_end',
        AGENT_END_TIMEOUT_MS
      )
    },

    async sessionInfo(requestId) {
      send({ type: 'get_session_info', requestId })
      const reply = await waitFor(
        (message) => message.type === 'session_info_result' && message.requestId === requestId,
        REPLY_TIMEOUT_MS
      )
      return parseReply(sessionInfoReply, reply).info
    },

    async dispose() {
      const exiting = new Promise<void>((resolve) => child.once('exit', () => resolve()))
      try {
        send({ type: 'stop' })
      } catch {
        // child may already be gone
      }
      child.kill()
      // Cap the wait: exit is normally immediate; kill() above covers stragglers.
      await Promise.race([exiting, sleep(1000)])
      // maxRetries/retryDelay absorb Windows EBUSY/EPERM from closing handles.
      for (const dir of [home, workspace]) {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    },
  }
}
