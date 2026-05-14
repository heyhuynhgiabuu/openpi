/**
 * piSidecar.ts — Pi SDK agent runtime running in a sidecar child process.
 *
 * Isolates all Pi SDK memory from the main process. Main stays ≤100 MB;
 * Pi SDK (sessions, models, resource loading) lives here and can grow freely.
 *
 * Communication: typed JSON messages over process.parentPort.
 * All heavy imports (Pi SDK, resource loader) happen inside this file only.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent'
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SidecarCommand =
  | {
      type: 'start_session'
      cwd: string
      sessionFile?: string
      forkEntryId?: string
      requestId?: string
      workspaceTrusted?: boolean
    }
  | { type: 'prompt'; text: string }
  | { type: 'steer'; text: string }
  | { type: 'follow_up'; text: string }
  | { type: 'abort' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking'; level: string }
  | { type: 'get_stats'; requestId: string }
  | { type: 'get_models'; requestId: string }
  | { type: 'execute_bash'; requestId: string; command: string; excludeFromContext?: boolean }
  | { type: 'set_session_name'; name: string }
  | { type: 'fork_session'; entryId: string; requestId?: string }
  | { type: 'get_settings'; requestId: string }
  | { type: 'save_settings'; scope: 'global' | 'project'; settings: Record<string, unknown> }
  | { type: 'get_providers'; requestId: string }
  | { type: 'set_provider_key'; provider: string; apiKey: string }
  | { type: 'remove_provider_key'; provider: string }
  | { type: 'invalidate_models' }
  | { type: 'login_provider'; requestId: string; providerId: string }
  | { type: 'logout_provider'; providerId: string }
  | { type: 'resolve_provider_prompt'; providerId: string; value: string }
  | { type: 'stop' }

export type SidecarMessage =
  | { type: 'ready' }
  | { type: 'session_ready'; requestId?: string; payload: SessionReadyPayload }
  | { type: 'session_event'; event: Record<string, unknown> }
  | { type: 'session_error'; requestId?: string; message: string; code?: string }
  | { type: 'session_index_updated' }
  | { type: 'stats_result'; requestId: string; stats: Record<string, unknown> }
  | { type: 'models_result'; requestId: string; models: unknown[] }
  | { type: 'bash_result'; requestId: string; result: unknown }
  | { type: 'settings_result'; requestId: string; result: unknown }
  | { type: 'providers_result'; requestId: string; providers: unknown[] }
  | { type: 'provider_login_event'; requestId: string; event: unknown }
  | { type: 'output_append'; line: { level: string; text: string; ts: number } }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'stopped' }

type SessionReadyPayload = {
  cwd: string
  sessionFile: string | null
  sessionId: string | null
  sessionName: string | null
  model: {
    id: string
    name: string
    provider: string
    reasoning: boolean
    contextWindow: number
  } | null
  thinkingLevel: string | null
}

// ─── State ─────────────────────────────────────────────────────────────────────

type SessionState = {
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
  cwd: string
  unsubscribe: () => void
}

let state: SessionState | null = null
let _authStorage: ReturnType<typeof AuthStorage.create> | null = null
let _modelRegistry: ReturnType<typeof ModelRegistry.create> | null = null
let _cachedResourceLoader: {
  cwd: string
  workspaceTrusted: boolean
  loader: InstanceType<typeof DefaultResourceLoader>
} | null = null
const _pendingOAuthPrompts = new Map<string, (v: string) => void>()

// ─── Port ─────────────────────────────────────────────────────────────────────

type ParentPort = {
  postMessage(msg: unknown): void
  on(event: 'message', listener: (message: unknown) => void): void
}

function createParentPort(): ParentPort | null {
  const electronParentPort = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (electronParentPort) return electronParentPort

  if (typeof process.send !== 'function') return null
  return {
    postMessage(msg: unknown): void {
      process.send?.(msg)
    },
    on(_event: 'message', listener: (message: unknown) => void): void {
      process.on('message', listener)
    },
  }
}

const maybeParentPort = createParentPort()
if (!maybeParentPort) {
  process.stderr.write('[piSidecar] No parent port — must run as utilityProcess or Node fork\n')
  process.exit(1)
}
const parentPort: ParentPort = maybeParentPort

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(msg: SidecarMessage): void {
  parentPort.postMessage(msg)
}

function getAgentDir(): string {
  return path.join(os.homedir(), '.pi', 'agent')
}

function getAuthStorage() {
  const agentDir = getAgentDir()
  _authStorage ??= AuthStorage.create(path.join(agentDir, 'auth.json'))
  return _authStorage
}

function getModelRegistry() {
  _modelRegistry ??= ModelRegistry.create(getAuthStorage(), path.join(getAgentDir(), 'models.json'))
  return _modelRegistry
}

function invalidateModelRegistry(): void {
  _modelRegistry = null
}

function outputLine(level: 'info' | 'warn' | 'error', text: string): void {
  send({ type: 'output_append', line: { level, text, ts: Date.now() } })
}

// ─── Session management ────────────────────────────────────────────────────────

async function startSession(
  cwd: string,
  opts: {
    sessionFile?: string
    forkEntryId?: string
    requestId?: string
    workspaceTrusted?: boolean
  } = {}
): Promise<void> {
  // Dispose previous session
  if (state) {
    state.unsubscribe()
    state.session.dispose()
    state = null
  }

  const agentDir = getAgentDir()
  const authStorage = getAuthStorage()
  const modelRegistry = getModelRegistry()
  const fileSettingsManager = SettingsManager.create(cwd, agentDir)
  const workspaceTrusted = opts.workspaceTrusted ?? false
  const settingsManager = workspaceTrusted
    ? fileSettingsManager
    : SettingsManager.inMemory(fileSettingsManager.getGlobalSettings())
  let sessionManager = opts.sessionFile
    ? SessionManager.open(opts.sessionFile, undefined, cwd)
    : SessionManager.create(cwd)

  if (opts.sessionFile && opts.forkEntryId) {
    const branchedSessionFile = sessionManager.createBranchedSession(opts.forkEntryId)
    if (branchedSessionFile) {
      sessionManager = SessionManager.open(branchedSessionFile, undefined, cwd)
    }
  }

  // Cache resource loader per workspace — avoid re-reading all skills/themes on every session switch
  if (
    !_cachedResourceLoader ||
    _cachedResourceLoader.cwd !== cwd ||
    _cachedResourceLoader.workspaceTrusted !== workspaceTrusted
  ) {
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: !workspaceTrusted,
      // Extensions are executable Node.js code. In untrusted workspaces OpenPi
      // uses global settings only and disables extension loading until the user
      // grants workspace trust from the desktop UI.
    })
    // loader.reload() installs packages listed in settings via `npm install -g`.
    // A missing or private npm package (e.g. one still in development) causes npm
    // to exit non-zero, which throws here and kills the entire session startup.
    // Per the Pi SDK, packages supply optional resources (skills, prompts, themes,
    // extensions); they must not block core session functionality. Catch, warn, continue.
    try {
      await loader.reload()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      outputLine(
        'warn',
        `[packages] One or more Pi packages failed to install and were skipped: ${msg}`
      )
      outputLine(
        'warn',
        '[packages] Check ~/.pi/agent/settings.json — remove or fix broken "packages" entries, or set "npmCommand" to point to your npm binary.'
      )
    }
    _cachedResourceLoader = { cwd, workspaceTrusted, loader }
  }

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager,
    authStorage,
    modelRegistry,
    settingsManager,
    resourceLoader: _cachedResourceLoader.loader,
  })

  const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    send({ type: 'session_event', event: event as Record<string, unknown> })

    const ev = event as {
      type: string
      success?: boolean
      finalError?: string
      errorMessage?: string
      message?: string
    }

    if (ev.type === 'agent_end') {
      send({ type: 'session_index_updated' })
    }

    if (ev.type === 'extension_error') {
      outputLine('error', `[extension] ${String(ev.message ?? 'extension error')}`)
    }

    if (ev.type === 'auto_retry_end' && ev.success === false) {
      outputLine('warn', `[retry] ${ev.finalError ?? 'Auto-retry failed'}`)
    }

    if (ev.type === 'compaction_end' && ev.errorMessage) {
      outputLine('error', `[compaction] ${ev.errorMessage}`)
    }
  })

  state = { session, cwd, unsubscribe }

  const model = session.model as
    | { id: string; name: string; provider: string; reasoning?: boolean; contextWindow?: number }
    | undefined

  const payload: SessionReadyPayload = {
    cwd,
    sessionFile: session.sessionFile ?? null,
    sessionId: session.sessionId ?? null,
    sessionName: opts.sessionFile ? null : null, // main process resolves display name from SQLite
    model: model
      ? {
          id: model.id,
          name: model.name,
          provider: model.provider,
          reasoning: model.reasoning ?? false,
          contextWindow: model.contextWindow ?? 0,
        }
      : null,
    thinkingLevel: (session.thinkingLevel as string | undefined) ?? null,
  }

  send({ type: 'session_ready', requestId: opts.requestId, payload })
}

// ─── Command handler ────────────────────────────────────────────────────────────

parentPort.on('message', (message) => {
  const cmd = (
    message && typeof message === 'object' && 'data' in message
      ? (message as { data: unknown }).data
      : message
  ) as SidecarCommand
  void handleCommand(cmd).catch((err) => {
    send({
      type: 'error',
      requestId: cmd && typeof cmd === 'object' && 'requestId' in cmd ? cmd.requestId : undefined,
      message: err instanceof Error ? err.message : String(err),
    })
  })
})

async function handleCommand(cmd: SidecarCommand): Promise<void> {
  switch (cmd.type) {
    case 'start_session': {
      try {
        await startSession(cmd.cwd, {
          sessionFile: cmd.sessionFile,
          forkEntryId: cmd.forkEntryId,
          requestId: cmd.requestId,
          workspaceTrusted: cmd.workspaceTrusted,
        })
      } catch (err) {
        send({
          type: 'session_error',
          requestId: cmd.requestId,
          message: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }

    case 'prompt': {
      if (!state) return
      await state.session.prompt(cmd.text)
      break
    }

    case 'steer': {
      if (!state) return
      await state.session.steer(cmd.text)
      break
    }

    case 'follow_up': {
      if (!state) return
      await state.session.followUp(cmd.text)
      break
    }

    case 'abort': {
      if (!state) return
      await state.session.abort()
      break
    }

    case 'execute_bash': {
      if (!state) {
        send({ type: 'bash_result', requestId: cmd.requestId, result: null })
        return
      }
      const result = await state.session.executeBash(cmd.command, undefined, {
        excludeFromContext: cmd.excludeFromContext,
      })
      send({ type: 'bash_result', requestId: cmd.requestId, result })
      break
    }

    case 'set_model': {
      if (!state) return
      const model = getModelRegistry().find(cmd.provider, cmd.modelId)
      if (!model) return
      await state.session.setModel(model)
      break
    }

    case 'set_thinking': {
      if (!state) return
      state.session.setThinkingLevel(
        cmd.level as Parameters<typeof state.session.setThinkingLevel>[0]
      )
      break
    }

    case 'set_session_name': {
      if (!state) return
      state.session.setSessionName(cmd.name)
      break
    }

    case 'fork_session': {
      if (!state) return
      await startSession(state.cwd, {
        sessionFile: state.session.sessionFile ?? undefined,
        forkEntryId: cmd.entryId,
        requestId: cmd.requestId,
      })
      break
    }

    case 'get_stats': {
      if (!state) {
        send({
          type: 'stats_result',
          requestId: cmd.requestId,
          stats: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            cost: 0,
            contextUsagePercent: null,
            sessionFile: null,
            sessionId: null,
            isStreaming: false,
          },
        })
        return
      }
      const agent = state.session.agent
      type AssistantMsg = {
        role: string
        usage?: {
          input?: number
          output?: number
          cacheRead?: number
          cacheWrite?: number
          inputTokens?: number
          outputTokens?: number
          cacheReadTokens?: number
          cacheWriteTokens?: number
          cost?: { total?: number } | number
        }
      }
      const msgs: AssistantMsg[] =
        (agent as unknown as { state?: { messages?: AssistantMsg[] } }).state?.messages ?? []
      let inputTokens = 0,
        outputTokens = 0,
        cacheReadTokens = 0,
        cacheWriteTokens = 0,
        cost = 0
      for (const m of msgs) {
        if (m.role !== 'assistant') continue
        inputTokens += m.usage?.input ?? m.usage?.inputTokens ?? 0
        outputTokens += m.usage?.output ?? m.usage?.outputTokens ?? 0
        cacheReadTokens += m.usage?.cacheRead ?? m.usage?.cacheReadTokens ?? 0
        cacheWriteTokens += m.usage?.cacheWrite ?? m.usage?.cacheWriteTokens ?? 0
        const usageCost = m.usage?.cost
        cost += typeof usageCost === 'number' ? usageCost : (usageCost?.total ?? 0)
      }
      send({
        type: 'stats_result',
        requestId: cmd.requestId,
        stats: {
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
          cost,
          contextUsagePercent: state.session.getContextUsage()?.percent ?? null,
          sessionFile: state.session.sessionFile ?? null,
          sessionId: state.session.sessionId ?? null,
          isStreaming:
            (agent as unknown as { state?: { isStreaming?: boolean } }).state?.isStreaming ?? false,
        },
      })
      break
    }

    case 'get_models': {
      const models = await getModelRegistry().getAvailable()
      const mapped = (
        models as Array<{
          id: string
          name: string
          provider: string
          reasoning?: boolean
          contextWindow?: number
        }>
      ).map((m) => ({
        id: m.id,
        name: m.name,
        provider: m.provider,
        reasoning: m.reasoning ?? false,
        contextWindow: m.contextWindow ?? 0,
      }))
      send({ type: 'models_result', requestId: cmd.requestId, models: mapped })
      break
    }

    case 'get_settings': {
      const agentDir = getAgentDir()
      const settingsManager = state
        ? SettingsManager.create(state.cwd, agentDir)
        : SettingsManager.create(agentDir, agentDir)
      const global = settingsManager.getGlobalSettings()
      const project = state ? settingsManager.getProjectSettings() : {}
      const effective = { ...global, ...project }
      send({
        type: 'settings_result',
        requestId: cmd.requestId,
        result: { global, project, effective },
      })
      break
    }

    case 'save_settings': {
      const agentDir = getAgentDir()
      const settingsPath =
        cmd.scope === 'global'
          ? path.join(agentDir, 'settings.json')
          : path.join(state?.cwd ?? agentDir, '.pi', 'settings.json')
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
      fs.writeFileSync(settingsPath, `${JSON.stringify(cmd.settings, null, 2)}\n`, 'utf-8')
      // Reload resource loader cache after settings change
      _cachedResourceLoader = null
      break
    }

    case 'get_providers': {
      const registry = getModelRegistry()
      const allModels = registry.getAll() as Array<{ provider: string }>
      const providerModelCounts = new Map<string, number>()
      for (const m of allModels) {
        providerModelCounts.set(m.provider, (providerModelCounts.get(m.provider) ?? 0) + 1)
      }
      const providers = []
      for (const [providerId, count] of providerModelCounts) {
        const status = registry.getProviderAuthStatus(providerId)
        const displayName = registry.getProviderDisplayName(providerId)
        const cred = getAuthStorage().get(providerId)
        const credentialType =
          cred?.type === 'oauth'
            ? 'oauth'
            : cred?.type === 'api_key'
              ? 'api_key'
              : status.source === 'environment'
                ? 'env'
                : undefined
        providers.push({
          id: providerId,
          displayName,
          configured: status.configured,
          modelCount: count,
          source: status.source,
          credentialType,
        })
      }
      send({ type: 'providers_result', requestId: cmd.requestId, providers })
      break
    }

    case 'set_provider_key': {
      getAuthStorage().set(cmd.provider, { type: 'api_key', key: cmd.apiKey })
      invalidateModelRegistry()
      break
    }

    case 'remove_provider_key': {
      getAuthStorage().remove(cmd.provider)
      invalidateModelRegistry()
      break
    }

    case 'invalidate_models': {
      invalidateModelRegistry()
      break
    }

    case 'login_provider': {
      try {
        await getAuthStorage().login(cmd.providerId, {
          onAuth: ({ url, instructions }: { url: string; instructions?: string }) => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'auth', url, instructions },
            })
          },
          onProgress: (message: string) => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'progress', message },
            })
          },
          onPrompt: (prompt: {
            message: string
            placeholder?: string
            allowEmpty?: boolean
          }): Promise<string> => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'prompt', ...prompt },
            })
            return new Promise<string>((resolve) => {
              _pendingOAuthPrompts.set(cmd.providerId, resolve)
            })
          },
          onSelect: (selectPrompt: {
            message: string
            options: { id: string; label: string }[]
          }): Promise<string | undefined> => {
            send({
              type: 'provider_login_event',
              requestId: cmd.requestId,
              event: { type: 'select', ...selectPrompt },
            })
            return new Promise<string | undefined>((resolve) => {
              _pendingOAuthPrompts.set(cmd.providerId, (v) => resolve(v || undefined))
            })
          },
        })
        invalidateModelRegistry()
        send({ type: 'provider_login_event', requestId: cmd.requestId, event: { type: 'success' } })
      } catch (err) {
        send({
          type: 'provider_login_event',
          requestId: cmd.requestId,
          event: { type: 'error', message: err instanceof Error ? err.message : String(err) },
        })
      }
      break
    }

    case 'logout_provider': {
      getAuthStorage().logout(cmd.providerId)
      invalidateModelRegistry()
      break
    }

    case 'resolve_provider_prompt': {
      const resolver = _pendingOAuthPrompts.get(cmd.providerId)
      if (resolver) {
        resolver(cmd.value)
        _pendingOAuthPrompts.delete(cmd.providerId)
      }
      break
    }

    case 'stop': {
      if (state) {
        state.unsubscribe()
        state.session.dispose()
        state = null
      }
      send({ type: 'stopped' })
      setTimeout(() => process.exit(0), 100)
      break
    }
  }
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

send({ type: 'ready' })
