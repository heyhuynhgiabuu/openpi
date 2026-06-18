/**
 * piSidecarTypes.ts — Shared types for the Pi SDK sidecar process.
 *
 * These types define the IPC protocol between the Electron main process
 * (piSidecarHost.ts) and the sidecar child process (piSidecar.ts).
 *
 * Extracted from piSidecar.ts because they are imported by many modules
 * and keep the runtime sidecar module focused on implementation.
 */

export type SidecarCommand =
  | {
      type: 'start_session'
      cwd: string
      sessionFile?: string
      forkEntryId?: string
      requestId?: string
      workspaceTrusted?: boolean
    }
  | { type: 'prompt'; text: string; contextPrefix?: string }
  | { type: 'steer'; text: string; contextPrefix?: string }
  | { type: 'follow_up'; text: string; contextPrefix?: string }
  | { type: 'list_prompt_templates'; requestId: string; cwd?: string; workspaceTrusted?: boolean }
  | { type: 'list_slash_commands'; requestId: string; cwd?: string; workspaceTrusted?: boolean }
  | { type: 'list_skills'; requestId: string; cwd?: string; workspaceTrusted?: boolean }
  | {
      type: 'read_skill_file'
      requestId: string
      path: string
      cwd?: string
      workspaceTrusted?: boolean
    }
  | { type: 'abort' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking'; level: string }
  | { type: 'get_stats'; requestId: string }
  | { type: 'get_models'; requestId: string }
  | { type: 'execute_bash'; requestId: string; command: string; excludeFromContext?: boolean }
  | { type: 'set_session_name'; name: string }
  | { type: 'fork_session'; entryId: string; requestId?: string }
  | { type: 'compact'; customInstructions?: string; requestId: string }
  | { type: 'reload_session'; requestId: string }
  | { type: 'get_session_info'; requestId: string }
  | { type: 'copy_last_assistant_text'; requestId: string }
  | { type: 'get_settings'; requestId: string }
  | { type: 'save_settings'; scope: 'global' | 'project'; settings: Record<string, unknown> }
  | { type: 'get_default_project_trust'; requestId: string }
  | { type: 'set_default_project_trust'; defaultProjectTrust: 'ask' | 'always' | 'never' }
  | { type: 'get_providers'; requestId: string }
  | { type: 'set_provider_key'; provider: string; apiKey: string }
  | { type: 'remove_provider_key'; provider: string }
  | { type: 'invalidate_models' }
  | { type: 'login_provider'; requestId: string; providerId: string }
  | { type: 'logout_provider'; providerId: string }
  | { type: 'resolve_provider_prompt'; providerId: string; value: string }
  | {
      type: 'extension_ui_response'
      id: string
      cancelled?: boolean
      confirmed?: boolean
      value?: string
    }
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
  | { type: 'session_info_result'; requestId: string; info: SessionInfoPayload }
  | { type: 'last_assistant_text_result'; requestId: string; text: string | null }
  | { type: 'settings_result'; requestId: string; result: unknown }
  | { type: 'providers_result'; requestId: string; providers: unknown[] }
  | {
      type: 'default_project_trust_result'
      requestId: string
      defaultProjectTrust: 'ask' | 'always' | 'never'
    }
  | { type: 'prompt_templates_result'; requestId: string; prompts: unknown[] }
  | { type: 'slash_commands_result'; requestId: string; commands: unknown[] }
  | { type: 'skills_result'; requestId: string; skills: unknown[] }
  | { type: 'skill_file_result'; requestId: string; content: string | null }
  | { type: 'provider_login_event'; requestId: string; event: unknown }
  | { type: 'output_append'; line: { level: string; text: string; ts: number } }
  | {
      type: 'extension_ui_request'
      request: import('../../src/lib/extensionUiTypes').ExtensionUiRequest
    }
  | { type: 'error'; requestId?: string; message: string }
  | { type: 'stopped' }

export type SessionReadyPayload = {
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

export type SessionInfoPayload = {
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
  messageCount: number
  contextUsagePercent: number | null
  contextTokens: number | null
  contextWindow: number | null
}
