/**
 * Shipped-path verification: drives the REAL sidecar child process through the
 * REAL Pi agent loop with only the model boundary scripted.
 *
 * What runs for real: the bundled `electron/pi/sidecar.ts` entry, Pi's
 * extension loader, model registration/selection, the agent loop, Pi's own
 * `write` tool, and Pi's JSONL session persistence. What is scripted: one
 * provider (`tests/fixtures/scripted-provider-extension.js`) that emits a
 * deterministic tool call then a deterministic final text — no network.
 *
 * Isolation: the child runs with HOME/USERPROFILE pointed at a temp dir, so
 * `os.homedir()`-derived agent state (settings, trust, auth, sessions) lands
 * in the temp tree and the developer's real `~/.pi/agent` is never touched.
 */
import { fork, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
// Transitive dep of vite/electron-vite, declared in devDependencies for this
// test: reused so the test bundles the sidecar entry like the real build.
import { build as esbuildBuild } from 'esbuild'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import {
  SCRIPTED_FILE_CONTENT,
  SCRIPTED_FILE_PATH,
  SCRIPTED_FINAL_TEXT,
  SCRIPTED_PROMPT,
} from './fixtures/scripted-provider-extension.js'

// vitest runs with the repo root as cwd (`npm test`), and the bundled sidecar
// plus the extension fixture are resolved from there.
const REPO_ROOT = process.cwd()
const SIDECAR_ENTRY = path.join(REPO_ROOT, 'electron', 'pi', 'sidecar.ts')
const FIXTURE_PATH = path.join(REPO_ROOT, 'tests', 'fixtures', 'scripted-provider-extension.js')
// Bare-import resolution walks up from the bundle location, so it must stay
// inside the repo tree for `@earendil-works/*` imports to resolve. ESM like
// the real build: `pi-coding-agent` is ESM-only.
const BUNDLE = path.join(
  REPO_ROOT,
  'node_modules',
  '.cache',
  'openpi-shipped-path',
  'piSidecar.mjs'
)

type SessionEvent = { type: string; [key: string]: unknown }

let child: ChildProcess | null = null
let childStderr = ''
let tmpHome = ''
let workspace = ''
let untouchedBefore: Buffer | null = null
let sessionFile = ''
let events: SessionEvent[] = []
let messageOrder: string[] = []

function send(command: Record<string, unknown>): void {
  if (!child) throw new Error('sidecar child is not running')
  child.send(command)
}

type Waiter = {
  predicate: (message: SidecarMessage) => boolean
  resolve: (message: SidecarMessage) => void
  timer: ReturnType<typeof setTimeout>
}

const waiters: Waiter[] = []

/** Only messages arriving AFTER this call count — stale inbox entries must
 * not satisfy later waits (e.g. polling `get_session_info` after `set_model`). */
function waitFor(predicate: (message: SidecarMessage) => boolean, timeoutMs: number) {
  return new Promise<SidecarMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `timed out after ${timeoutMs}ms waiting for sidecar message.\nstderr: ${childStderr}`
        )
      )
    }, timeoutMs)
    waiters.push({ predicate, resolve, timer })
  })
}

function onMessage(message: SidecarMessage): void {
  if (message.type === 'session_event') {
    const event = message.event as SessionEvent
    events.push(event)
  }
  // Ordering evidence: the renderer resets conversation state on session_ready,
  // so diagnostics emitted before it would be discarded (regression guard).
  messageOrder.push(
    message.type === 'session_event'
      ? `event:${(message.event as SessionEvent).type}`
      : message.type
  )
  const index = waiters.findIndex((waiter) => waiter.predicate(message))
  if (index !== -1) {
    const [waiter] = waiters.splice(index, 1)
    clearTimeout(waiter?.timer)
    waiter?.resolve(message)
  }
}

/** Poll the real read path until `set_model` is visible to `get_session_info`. */
async function waitForScriptedModel(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    send({ type: 'get_session_info', requestId: `model-check-${deadline}` })
    const reply = await waitFor((message) => message.type === 'session_info_result', timeoutMs)
    const info = (reply as { info: { model: { provider: string } | null } }).info
    if (info.model?.provider === 'scripted') return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`model never became 'scripted'; stderr: ${childStderr}`)
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) =>
      part && typeof part === 'object' && part.type === 'text' && typeof part.text === 'string'
        ? part.text
        : ''
    )
    .join('')
}

beforeAll(async () => {
  // Bundle the shipped sidecar entry the same way electron-vite does (deps
  // external, ESM) so the child runs the real module graph under plain Node.
  fs.mkdirSync(path.dirname(BUNDLE), { recursive: true })
  await esbuildBuild({
    entryPoints: [SIDECAR_ENTRY],
    outfile: BUNDLE,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    target: 'node20',
    logLevel: 'silent',
  })

  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-shipped-home-'))
  // The workspace lives under the repo's cache dir so Pi's project extension
  // discovery (<cwd>/.pi/extensions) finds the fixture and the fixture's
  // `@earendil-works/pi-ai` import resolves against the repo's node_modules.
  const wsRoot = path.join(REPO_ROOT, 'node_modules', '.cache', 'openpi-shipped-path')
  fs.mkdirSync(wsRoot, { recursive: true })
  workspace = fs.mkdtempSync(path.join(wsRoot, 'workspace-'))
  const untouchedPath = path.join(workspace, 'untouched.txt')
  fs.writeFileSync(untouchedPath, 'untouched bytes — must stay byte-identical')
  untouchedBefore = fs.readFileSync(untouchedPath)

  // Project-scope extension: the same discovery + workspace-trust route a real
  // OpenPi user's project extensions take.
  const projectExtensions = path.join(workspace, '.pi', 'extensions')
  fs.mkdirSync(projectExtensions, { recursive: true })
  fs.copyFileSync(FIXTURE_PATH, path.join(projectExtensions, 'scripted-provider.js'))
  // A sibling that fails to load: the session must still start, and the
  // failure must surface as an extension_error event (asserted below).
  fs.copyFileSync(
    path.join(REPO_ROOT, 'tests', 'fixtures', 'broken-extension.js'),
    path.join(projectExtensions, 'broken.js')
  )

  child = fork(BUNDLE, [], {
    execPath: process.execPath,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      HOME: tmpHome,
      USERPROFILE: tmpHome,
      OPENPI_BRIDGE_APP: 'openpi',
      PI_OFFLINE: '1',
      PI_SKIP_VERSION_CHECK: '1',
    },
  })
  child.on('message', onMessage)
  child.stdout?.on('data', () => {}) // drain so a verbose child cannot fill the pipe
  child.stderr?.on('data', (chunk: Buffer) => {
    childStderr += chunk.toString()
  })
}, 120_000)

afterAll(async () => {
  if (child) {
    const exiting = new Promise<void>((resolve) => child?.once('exit', () => resolve()))
    try {
      send({ type: 'stop' })
    } catch {
      // child may already be gone
    }
    child.kill()
    // Cap the wait: exit is normally immediate; kill() above covers stragglers.
    await Promise.race([exiting, new Promise((resolve) => setTimeout(resolve, 1000))])
    child = null
  }
  for (const dir of [tmpHome, workspace]) {
    // maxRetries/retryDelay absorb Windows EBUSY/EPERM from closing handles.
    if (dir) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

describe('shipped path: sidecar → Pi agent loop → workspace', () => {
  it('writes the scripted file, leaves other bytes identical, and persists the real session tree', async () => {
    send({ type: 'start_session', cwd: workspace, workspaceTrusted: true, requestId: 's1' })
    const ready = await waitFor((message) => message.type === 'session_ready', 60_000)
    const payload = (ready as { payload: { sessionFile: string | null } }).payload
    expect(payload.sessionFile).toBeTruthy()
    sessionFile = payload.sessionFile ?? ''
    // Pi materializes the JSONL lazily — the path is authoritative, the file
    // appears with the first persisted entry; asserted after the turn below.
    expect(sessionFile.startsWith(tmpHome)).toBe(true)

    send({ type: 'set_model', provider: 'scripted', modelId: 'scripted-write' })
    await waitForScriptedModel(30_000)

    send({ type: 'prompt', text: SCRIPTED_PROMPT })
    await waitFor(
      (message) =>
        message.type === 'session_event' && (message.event as SessionEvent).type === 'agent_end',
      60_000
    )

    // ── The world: workspace bytes ──────────────────────────────────────
    const helloPath = path.join(workspace, SCRIPTED_FILE_PATH)
    expect(fs.readFileSync(helloPath, 'utf8')).toBe(SCRIPTED_FILE_CONTENT)
    const untouchedPath = path.join(workspace, 'untouched.txt')
    expect(Buffer.compare(fs.readFileSync(untouchedPath), untouchedBefore ?? Buffer.alloc(0))).toBe(
      0
    )
    expect(fs.readdirSync(workspace).sort()).toEqual(['.pi', SCRIPTED_FILE_PATH, 'untouched.txt'])

    // The agent loop really ran: start/end markers and the write tool card.
    expect(events.some((event) => event.type === 'agent_start')).toBe(true)
    const writeStart = events.find(
      (event) => event.type === 'tool_execution_start' && event.toolName === 'write'
    )
    expect(writeStart).toBeTruthy()

    // The broken sibling surfaces instead of vanishing; the scripted provider
    // (loaded from the same directory) still works.
    // SAFETY: the sidecar forwards extension_error events verbatim with
    // extensionPath/error string fields (sidecar.ts synthetic emission).
    const extError = events.find((event) => event.type === 'extension_error') as
      | { extensionPath?: string; error?: string }
      | undefined
    expect(extError?.extensionPath?.endsWith('broken.js')).toBe(true)
    expect(extError?.error).toContain('valid factory function')
    // …and arrives AFTER session_ready: the renderer resets conversation
    // state on ready, so a pre-ready diagnostic would never be visible.
    expect(messageOrder.indexOf('event:extension_error')).toBeGreaterThan(
      messageOrder.indexOf('session_ready')
    )

    // ── The truth: Pi's own JSONL session tree ─────────────────────────
    expect(fs.existsSync(sessionFile)).toBe(true)
    const entries = fs
      .readFileSync(sessionFile, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    const header = entries.find((entry) => entry.type === 'session')
    expect(header?.cwd).toBe(workspace)

    const tree = entries.filter(
      (
        entry
      ): entry is {
        id: string
        parentId: string | null
        type: string
        message?: Record<string, unknown>
      } => entry.type !== 'session'
    )
    expect(tree.length).toBeGreaterThan(0)
    expect(tree[0]?.parentId ?? null).toBe(null)
    for (let index = 1; index < tree.length; index += 1) {
      expect(tree[index]?.parentId).toBe(tree[index - 1]?.id)
    }

    const userEntry = tree.find(
      (entry) => entry.type === 'message' && entry.message?.role === 'user'
    )
    expect(contentToText(userEntry?.message?.content)).toBe(SCRIPTED_PROMPT)

    const assistantEntries = tree.filter(
      (entry) => entry.type === 'message' && entry.message?.role === 'assistant'
    )
    const withToolCall = assistantEntries.find((entry) =>
      Array.isArray(entry.message?.content)
        ? entry.message.content.some(
            (part) => part && typeof part === 'object' && part.type === 'toolCall'
          )
        : false
    )
    const toolCall = Array.isArray(withToolCall?.message?.content)
      ? withToolCall.message.content.find(
          (part) => part && typeof part === 'object' && part.type === 'toolCall'
        )
      : undefined
    expect(toolCall).toMatchObject({
      name: 'write',
      arguments: { path: SCRIPTED_FILE_PATH, content: SCRIPTED_FILE_CONTENT },
    })
    // The scripted provider is what answered: provider is stamped on the message.
    expect(withToolCall?.message?.provider).toBe('scripted')

    const toolResultEntry = tree.find(
      (entry) => entry.type === 'message' && entry.message?.role === 'toolResult'
    )
    expect(toolResultEntry?.message?.toolCallId).toBe(
      toolCall && typeof toolCall === 'object' && 'id' in toolCall ? toolCall.id : ''
    )
    expect(Boolean(toolResultEntry?.message?.isError)).toBe(false)

    const lastAssistant = assistantEntries[assistantEntries.length - 1]
    expect(contentToText(lastAssistant?.message?.content)).toBe(SCRIPTED_FINAL_TEXT)
  }, 120_000)
})
