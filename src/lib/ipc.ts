/**
 * IPC channel definitions and Zod schemas.
 * All payloads crossing the preload boundary are validated here.
 * Renderer imports types only — never imports electron or node builtins.
 */
import { z } from 'zod'

// ─── Channel names ─────────────────────────────────────────────────────────

export const IPC = {
  // renderer → main (invoke)
  GET_APP_INFO: 'openpi:get-app-info',
  PICK_WORKSPACE: 'openpi:pick-workspace',
  SESSION_PROMPT: 'openpi:session-prompt',
  SESSION_STEER: 'openpi:session-steer',
  SESSION_FOLLOW_UP: 'openpi:session-follow-up',
  SESSION_BASH: 'openpi:session-bash',
  SESSION_ABORT: 'openpi:session-abort',
  GET_MODELS: 'openpi:get-models',
  SET_MODEL: 'openpi:set-model',
  SET_THINKING: 'openpi:set-thinking',
  GET_SESSION_STATS: 'openpi:get-session-stats',
  GET_WORKSPACES: 'openpi:get-workspaces',
  GET_SESSIONS: 'openpi:get-sessions',
  GET_SESSION_MESSAGES: 'openpi:get-session-messages',
  OPEN_SESSION: 'openpi:open-session',
  NEW_SESSION: 'openpi:new-session',
  GET_GIT_BRANCH: 'openpi:get-git-branch',
  GET_WORKSPACE_SUMMARY: 'openpi:get-workspace-summary',
  SET_WORKSPACE_TRUST: 'openpi:set-workspace-trust',
  WORKBENCH_CONTEXT_UPDATE: 'openpi:workbench-context-update',
  WORKBENCH_CONTEXT_GET: 'openpi:workbench-context-get',
  CHECK_PATH_PROTECTION: 'openpi:check-path-protection',
  GET_DIAGNOSTICS_BUNDLE: 'openpi:get-diagnostics-bundle',
  GET_CUSTOMIZATIONS: 'openpi:get-customizations',
  INSTALL_PACKAGE: 'openpi:install-package',
  REMOVE_PACKAGE: 'openpi:remove-package',
  SET_SESSION_NAME: 'openpi:set-session-name',
  FORK_SESSION: 'openpi:fork-session',
  GET_SESSION_TREE: 'openpi:get-session-tree',

  // PTY terminal (renderer → main)
  PTY_CREATE: 'openpi:pty-create',
  PTY_WRITE: 'openpi:pty-write',
  PTY_RESIZE: 'openpi:pty-resize',
  PTY_CLOSE: 'openpi:pty-close',

  // Preferences
  GET_PREF: 'openpi:get-pref',
  SET_PREF: 'openpi:set-pref',
  PLAY_SOUND_EFFECT: 'openpi:play-sound-effect',
  CHECK_PI_UPDATE: 'openpi:check-pi-update',
  INSTALL_PI_UPDATE: 'openpi:install-pi-update',

  // App self-update (renderer → main / main → renderer)
  APP_UPDATE_CHECK: 'openpi:app-update-check',
  APP_UPDATE_OPEN_RELEASE: 'openpi:app-update-open-release',
  APP_UPDATE_INSTALL: 'openpi:app-update-install',
  APP_UPDATE_STATUS: 'openpi:app-update-status',
  GET_CHANGELOG: 'openpi:get-changelog',

  // Git source control (renderer → main)
  GIT_STATUS: 'openpi:git-status',
  GIT_DIFF: 'openpi:git-diff',
  GIT_STAGE: 'openpi:git-stage',
  GIT_UNSTAGE: 'openpi:git-unstage',
  GIT_COMMIT: 'openpi:git-commit',
  GIT_DISCARD: 'openpi:git-discard',
  GIT_SYNC: 'openpi:git-sync',
  GIT_REFS: 'openpi:git-refs',
  GIT_CHECKOUT_BRANCH: 'openpi:git-checkout-branch',
  GIT_CREATE_BRANCH: 'openpi:git-create-branch',
  GIT_STASH_APPLY: 'openpi:git-stash-apply',
  GIT_STASH_POP: 'openpi:git-stash-pop',
  GIT_STASH_DROP: 'openpi:git-stash-drop',
  GIT_HISTORY: 'openpi:git-history',
  GIT_COMMIT_DIFF: 'openpi:git-commit-diff',
  GIT_REMOTE_URL: 'openpi:git-remote-url',
  GIT_FILE_TREE: 'openpi:git-file-tree',
  GIT_PANEL_MOUNTED: 'openpi:git-panel-mounted',
  GIT_GENERATE_COMMIT_MSG: 'openpi:git-generate-commit-msg',
  // main → renderer
  AGENT_CHANGED_FILES: 'openpi:agent-changed-files',
  READ_FILE: 'openpi:read-file',
  WRITE_FILE: 'openpi:write-file',
  DELETE_FILE: 'openpi:delete-file',
  FORMAT_FILE: 'openpi:format-file',
  SET_EXTENSION_ENABLED: 'openpi:set-extension-enabled',
  GET_FIRST_RUN: 'openpi:get-first-run',
  SEARCH_FILE_CONTENTS: 'openpi:search-file-contents',
  LIST_PROMPT_TEMPLATES: 'openpi:list-prompt-templates',
  FFF_FILE_SEARCH: 'openpi:fff-file-search',
  FFF_GREP: 'openpi:fff-grep',
  // Settings
  GET_SETTINGS: 'openpi:get-settings',
  SAVE_SETTINGS: 'openpi:save-settings',
  OPEN_EXTERNAL: 'openpi:open-external',
  READ_THEME_COLORS: 'openpi:read-theme-colors',
  READ_THEME_TOKENS: 'openpi:read-theme-tokens',
  ARCHIVE_SESSIONS: 'openpi:archive-sessions',
  LIST_ARCHIVED_SESSIONS: 'openpi:list-archived-sessions',
  UNARCHIVE_SESSIONS: 'openpi:unarchive-sessions',
  DELETE_SESSIONS: 'openpi:delete-sessions',
  LIST_SKILLS: 'openpi:list-skills',
  READ_SKILL_FILE: 'openpi:read-skill-file',
  LIST_DIRECTORY: 'openpi:list-directory',

  GET_PROVIDERS: 'openpi:get-providers',
  SET_PROVIDER_KEY: 'openpi:set-provider-key',
  REMOVE_PROVIDER_KEY: 'openpi:remove-provider-key',
  LOGIN_PROVIDER: 'openpi:login-provider',
  LOGOUT_PROVIDER: 'openpi:logout-provider',
  PROVIDER_LOGIN_EVENT: 'openpi:provider-login-event',
  RESOLVE_PROVIDER_PROMPT: 'openpi:resolve-provider-prompt',
  GET_CUSTOM_PROVIDERS: 'openpi:get-custom-providers',
  ADD_CUSTOM_PROVIDER: 'openpi:add-custom-provider',
  REMOVE_CUSTOM_PROVIDER: 'openpi:remove-custom-provider',

  // main → renderer (on)
  SESSION_EVENT: 'openpi:session-event',
  SESSION_READY: 'openpi:session-ready',
  SESSION_ERROR: 'openpi:session-error',
  SESSION_INDEX_UPDATED: 'openpi:session-index-updated',
  SEND_PROMPT: 'openpi:send-prompt',
  PTY_DATA: 'openpi:pty-data',
  PTY_EXIT: 'openpi:pty-exit',
  OUTPUT_APPEND: 'openpi:output-append',
  GET_OUTPUT_BUFFER: 'openpi:get-output-buffer',
  GIT_STATUS_CHANGED: 'openpi:git-status-changed',
  FILE_TREE_CHANGED: 'openpi:file-tree-changed',
  REMOTE_SESSION_STATUS: 'openpi:remote-session-status',
  REMOTE_SESSION_UPDATE: 'openpi:remote-session-update',
  GOAL_UPDATE: 'openpi:goal-update',
  PLAN_UPDATE: 'openpi:plan-update',
} as const

// ─── Invoke payloads ────────────────────────────────────────────────────────

export const pickWorkspaceResultSchema = z.object({
  cancelled: z.boolean(),
  path: z.string().optional(),
})
export type PickWorkspaceResult = z.infer<typeof pickWorkspaceResultSchema>

export const appInfoSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  releaseChannel: z.string().min(1).nullable(),
})
export type AppInfo = z.infer<typeof appInfoSchema>

export const sessionPromptSchema = z.object({
  text: z.string().min(1).max(100_000),
  contextPrefix: z.string().min(1).max(100_000).optional(),
})
export type SessionPrompt = z.infer<typeof sessionPromptSchema>

export const sessionBashSchema = z.object({
  command: z.string().min(1).max(100_000),
  excludeFromContext: z.boolean().optional(),
})
export type SessionBash = z.infer<typeof sessionBashSchema>

export const bashExecutionResultSchema = z.object({
  output: z.string(),
  exitCode: z.number().optional(),
  cancelled: z.boolean(),
  truncated: z.boolean(),
  fullOutputPath: z.string().optional(),
})
export type BashExecutionResult = z.infer<typeof bashExecutionResultSchema>

export const setModelSchema = z.object({
  provider: z.string(),
  modelId: z.string(),
})
export type SetModel = z.infer<typeof setModelSchema>

export const setThinkingSchema = z.object({
  level: z.string(),
})
export type SetThinking = z.infer<typeof setThinkingSchema>

export const sessionListOptionsSchema = z
  .object({
    query: z.string().max(500).optional(),
    sortBy: z.enum(['created', 'updated']).optional(),
    groupBy: z.enum(['workspace', 'time']).optional(),
    showRecent: z.boolean().optional(),
    recentDays: z.number().int().positive().max(365).optional(),
    workspacePath: z.string().min(1).optional(),
    limit: z.number().int().positive().max(500).optional(),
    offset: z.number().int().nonnegative().max(100_000).optional(),
  })
  .optional()
  .default({})
export type SessionListOptions = z.infer<typeof sessionListOptionsSchema>

export const openSessionSchema = z.object({
  path: z.string().min(1),
})
export type OpenSession = z.infer<typeof openSessionSchema>

export const sessionMessagesRequestSchema = z.object({
  path: z.string().min(1),
  /** Maximum rendered messages to return. Main caps this defensively. */
  limit: z.number().int().positive().max(500).optional(),
  /** Return the page immediately before this rendered message entry id. */
  beforeEntryId: z.string().min(1).optional(),
})
export type SessionMessagesRequest = z.infer<typeof sessionMessagesRequestSchema>

export const newSessionSchema = z
  .object({
    cwd: z.string().min(1).optional(),
  })
  .optional()
  .default({})
export type NewSession = z.infer<typeof newSessionSchema>

export const gitBranchSchema = z.object({
  cwd: z.string().min(1),
})
export type GitBranchRequest = z.infer<typeof gitBranchSchema>

export const sessionStatsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  cost: z.number(),
  contextUsagePercent: z.number().nullable(),
  sessionFile: z.string().nullable(),
  sessionId: z.string().nullable(),
  isStreaming: z.boolean(),
})
export type SessionStats = z.infer<typeof sessionStatsSchema>

// ─── Workspace + session index ─────────────────────────────────────────────

export const workspaceInfoSchema = z.object({
  path: z.string(),
  displayName: z.string(),
  lastOpenedAt: z.string().nullable(),
  sessionCount: z.number(),
})
export type WorkspaceInfo = z.infer<typeof workspaceInfoSchema>

export const sessionListItemSchema = z.object({
  path: z.string(),
  id: z.string(),
  cwd: z.string(),
  workspacePath: z.string(),
  workspaceName: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  messageCount: z.number(),
  firstMessage: z.string(),
  parentSessionPath: z.string().nullable(),
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  cost: z.number(),
  entryCount: z.number(),
  branchCount: z.number(),
  lastModel: z.string(),
  active: z.boolean(),
})
export type SessionListItem = z.infer<typeof sessionListItemSchema>

export const gitBranchInfoSchema = z.object({
  branch: z.string().nullable(),
})
export type GitBranchInfo = z.infer<typeof gitBranchInfoSchema>

export const workspaceSummaryRequestSchema = z.object({
  cwd: z.string().min(1),
})
export type WorkspaceSummaryRequest = z.infer<typeof workspaceSummaryRequestSchema>

export const workspaceSummaryInfoSchema = z.object({
  cwd: z.string(),
  displayName: z.string(),
  branch: z.string().nullable(),
  lastModifiedAt: z.string().nullable(),
})
export type WorkspaceSummaryInfo = z.infer<typeof workspaceSummaryInfoSchema>

export const workspaceTrustRequestSchema = z.object({
  cwd: z.string().min(1),
  trusted: z.boolean(),
})
export type WorkspaceTrustRequest = z.infer<typeof workspaceTrustRequestSchema>

export const workspaceTrustResultSchema = z.object({
  cwd: z.string(),
  trusted: z.boolean(),
  trustedAt: z.string().nullable(),
})
export type WorkspaceTrustResult = z.infer<typeof workspaceTrustResultSchema>

export const pathProtectionRequestSchema = z.object({
  path: z.string().min(1),
  workspacePath: z.string().nullable().optional(),
})
export type PathProtectionRequest = z.infer<typeof pathProtectionRequestSchema>

export const pathProtectionResultSchema = z.object({
  protected: z.boolean(),
  level: z.enum(['hard', 'soft', 'scope']).nullable(),
  rule: z.string().nullable(),
  reason: z.string().nullable(),
})
export type PathProtectionResult = z.infer<typeof pathProtectionResultSchema>

export const diagnosticsBundleSchema = z.object({
  generatedAt: z.string(),
  app: z.record(z.unknown()),
  runtime: z.record(z.unknown()),
  workspace: z.record(z.unknown()),
  sidecar: z.record(z.unknown()),
  resources: z.record(z.unknown()).nullable(),
  git: z.record(z.unknown()).nullable(),
  database: z.record(z.unknown()),
  notes: z.array(z.string()),
})
export type DiagnosticsBundle = z.infer<typeof diagnosticsBundleSchema>

// ─── Customizations inventory ───────────────────────────────────────────────

export const customizationTypeSchema = z.enum([
  'extensions',
  'skills',
  'prompts',
  'themes',
  'packages',
])
export type CustomizationType = z.infer<typeof customizationTypeSchema>

export const customizationScopeSchema = z.enum(['user', 'project', 'temporary'])
export type CustomizationScope = z.infer<typeof customizationScopeSchema>

export const customizationOriginSchema = z.enum(['top-level', 'package', 'settings'])
export type CustomizationOrigin = z.infer<typeof customizationOriginSchema>

export const resourceRiskLevelSchema = z.enum(['low', 'medium', 'high'])
export type ResourceRiskLevel = z.infer<typeof resourceRiskLevelSchema>

export const customizationItemSchema = z.object({
  id: z.string(),
  type: customizationTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  argumentHint: z.string().optional(),
  path: z.string().nullable(),
  scope: customizationScopeSchema,
  origin: customizationOriginSchema,
  source: z.string(),
  enabled: z.boolean(),
  packageSource: z.string().optional(),
  warning: z.string().optional(),
  /** ISO timestamp of the resource file's last modification, when available */
  lastModifiedAt: z.string().nullable().optional(),
  /** Risk classification: extensions/packages that run arbitrary code are 'high' */
  riskLevel: resourceRiskLevelSchema.optional(),
})
export type CustomizationItem = z.infer<typeof customizationItemSchema>

export const customizationDiagnosticSchema = z.object({
  type: z.enum(['error', 'warning', 'info']),
  message: z.string(),
  path: z.string().optional(),
  scope: customizationScopeSchema.optional(),
})
export type CustomizationDiagnostic = z.infer<typeof customizationDiagnosticSchema>

export const workbenchContextSchema = z.object({
  visibleFile: z.string().nullable(),
  visibleFileAbs: z.string().nullable(),
  terminalOutput: z.string().nullable(),
})
export type WorkbenchContextPayload = z.infer<typeof workbenchContextSchema>

export const setExtensionEnabledRequestSchema = z.object({
  /** Unique extension ID (matching CustomizationItem.id) */
  id: z.string().min(1),
  /** Whether the extension should be enabled */
  enabled: z.boolean(),
})
export type SetExtensionEnabledRequest = z.infer<typeof setExtensionEnabledRequestSchema>

export const customizationsInventorySchema = z.object({
  cwd: z.string().nullable(),
  workspaceTrusted: z.boolean(),
  items: z.array(customizationItemSchema),
  diagnostics: z.array(customizationDiagnosticSchema),
})
export type CustomizationsInventory = z.infer<typeof customizationsInventorySchema>

export const packageOperationRequestSchema = z.object({
  source: z.string().trim().min(1).max(2_000),
  scope: z.enum(['user', 'project']),
})
export type PackageOperationRequest = z.infer<typeof packageOperationRequestSchema>

export const packageOperationResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
})
export type PackageOperationResult = z.infer<typeof packageOperationResultSchema>

export const sessionHistoryToolCardSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
  output: z.string(),
  isError: z.boolean(),
  streaming: z.boolean(),
})
export type SessionHistoryToolCard = z.infer<typeof sessionHistoryToolCardSchema>

export const sessionHistoryMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  thinking: z.string().optional(),
  toolCards: z.array(sessionHistoryToolCardSchema),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheReadTokens: z.number().optional(),
  cacheWriteTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  durationMs: z.number().optional(),
  cost: z.number().optional(),
  streaming: z.boolean().optional(),
  /** Display name of the model that produced this message */
  modelName: z.string().optional(),
})
export type SessionHistoryMessage = z.infer<typeof sessionHistoryMessageSchema>

export const sessionHistoryPageSchema = z.object({
  messages: z.array(sessionHistoryMessageSchema),
  hasMoreBefore: z.boolean(),
  nextBeforeEntryId: z.string().nullable(),
  limit: z.number(),
})
export type SessionHistoryPage = z.infer<typeof sessionHistoryPageSchema>

export const remoteSessionUpdateSchema = sessionHistoryPageSchema.extend({
  sessionFile: z.string(),
  updatedAt: z.number(),
})
export type RemoteSessionUpdate = z.infer<typeof remoteSessionUpdateSchema>

export const goalUpdateSchema = z.object({
  objective: z.string().nullable(),
  status: z.string().nullable(),
  tokensUsed: z.number(),
  tokenBudget: z.number().nullable(),
  timeUsedSeconds: z.number(),
  timestamp: z.number(),
})
export type GoalUpdate = z.infer<typeof goalUpdateSchema>

export const planItemStatusSchema = z.enum(['pending', 'in_progress', 'completed'])
export const planItemSchema = z.object({
  step: z.string().min(1),
  status: planItemStatusSchema,
})
export const planUpdateSchema = z.object({
  plan: z.array(planItemSchema),
  timestamp: z.number(),
})
export type PlanUpdate = z.infer<typeof planUpdateSchema>

// ─── Provider info ───────────────────────────────────────────────────────────

export const providerInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  configured: z.boolean(),
  modelCount: z.number(),
  source: z.string().optional(),
  credentialType: z.enum(['api_key', 'oauth', 'env', 'other']).optional(),
})
export type ProviderInfo = z.infer<typeof providerInfoSchema>

// OAuth login event streamed from main → renderer during login flow
export type ProviderLoginEvent =
  | { type: 'auth'; url: string; instructions?: string }
  | { type: 'progress'; message: string }
  | { type: 'prompt'; message: string; placeholder?: string; allowEmpty?: boolean }
  | { type: 'select'; message: string; options: { id: string; label: string }[] }
  | { type: 'success' }
  | { type: 'error'; message: string }

export const setProviderKeySchema = z.object({
  provider: z.string().min(1),
  apiKey: z.string().min(1),
})
export type SetProviderKey = z.infer<typeof setProviderKeySchema>

export const removeProviderKeySchema = z.object({
  provider: z.string().min(1),
})
export type RemoveProviderKey = z.infer<typeof removeProviderKeySchema>

export const loginProviderSchema = z.object({
  providerId: z.string().min(1),
})
export type LoginProvider = z.infer<typeof loginProviderSchema>

export const logoutProviderSchema = z.object({
  providerId: z.string().min(1),
})
export type LogoutProvider = z.infer<typeof logoutProviderSchema>

export const resolveProviderPromptSchema = z.object({
  providerId: z.string().min(1),
  value: z.string(),
})
export type ResolveProviderPrompt = z.infer<typeof resolveProviderPromptSchema>

// ─── Custom provider ─────────────────────────────────────────────────────────

/** Valid provider ID: lowercase letters, numbers, hyphens, underscores; must start with letter/digit */
export const CUSTOM_PROVIDER_ID_RE = /^[a-z0-9][a-z0-9_-]*$/

export const customProviderModelSchema = z.object({
  /** Model identifier sent to the API */
  id: z.string().min(1, 'Model ID is required'),
  /** Human-readable display name (falls back to id when omitted) */
  name: z.string().optional(),
})
export type CustomProviderModel = z.infer<typeof customProviderModelSchema>

export const customProviderSchema = z.object({
  /** Provider identifier — written as the key in models.json */
  id: z
    .string()
    .regex(CUSTOM_PROVIDER_ID_RE, 'Lowercase letters, numbers, hyphens, or underscores'),
  /** Optional human-readable name shown in model selector */
  name: z.string().optional(),
  /** OpenAI-compatible base URL (e.g. https://api.myprovider.com/v1) */
  baseUrl: z.string().url('Must be a valid URL'),
  /** API key — stored in models.json; leave empty to rely on headers or env vars */
  apiKey: z.string().optional(),
  /** At least one model must be declared */
  models: z.array(customProviderModelSchema).min(1, 'Add at least one model'),
  /** Optional extra request headers (key → value) */
  headers: z.record(z.string(), z.string()).optional(),
})
export type CustomProvider = z.infer<typeof customProviderSchema>

export const removeCustomProviderSchema = z.object({
  id: z.string().min(1),
})
export type RemoveCustomProvider = z.infer<typeof removeCustomProviderSchema>

/** Summary of a custom provider as stored in models.json */
export const customProviderInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  modelCount: z.number(),
  hasApiKey: z.boolean(),
})
export type CustomProviderInfo = z.infer<typeof customProviderInfoSchema>

// ─── Model info ─────────────────────────────────────────────────────────────

export const modelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  reasoning: z.boolean(),
  contextWindow: z.number(),
})
export type ModelInfo = z.infer<typeof modelInfoSchema>

// ─── SESSION_READY payload ───────────────────────────────────────────────────

export const sessionReadySchema = z.object({
  cwd: z.string(),
  sessionFile: z.string().nullable(),
  sessionId: z.string().nullable(),
  sessionName: z.string().nullable(),
  model: modelInfoSchema.nullable(),
  thinkingLevel: z.string().nullable(),
})
export type SessionReady = z.infer<typeof sessionReadySchema>

// ─── SESSION_EVENT payload ───────────────────────────────────────────────────
// We forward Pi's AgentSessionEvent over IPC as a plain JSON object.
// The renderer receives it as-is and discriminates on `type`.

export const sessionEventSchema = z
  .object({
    type: z.string(),
  })
  .passthrough()
export type SessionEvent = z.infer<typeof sessionEventSchema>

// ─── SESSION_ERROR payload ───────────────────────────────────────────────────

export const sessionErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
})
export type SessionError = z.infer<typeof sessionErrorSchema>

// ─── Session name ────────────────────────────────────────────────────────────

export const setSessionNameSchema = z.object({
  name: z.string().min(1).max(200),
})
export type SetSessionName = z.infer<typeof setSessionNameSchema>

export const forkSessionSchema = z.object({
  entryId: z.string().min(1),
})
export type ForkSession = z.infer<typeof forkSessionSchema>

// ─── Session tree ────────────────────────────────────────────────────────────

export const TREE_ENTRY_TYPES = [
  'message',
  'compaction',
  'branch_summary',
  'label',
  'model_change',
  'session_info',
  'thinking_level_change',
] as const
export type TreeEntryType = (typeof TREE_ENTRY_TYPES)[number]

/** A single node in the session tree — maps to one JSONL entry (minus session header). */
export const treeEntryNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  type: z.enum(TREE_ENTRY_TYPES),
  timestamp: z.string(),
  /** Human-readable one-line summary for display in the tree view. */
  summary: z.string().optional(),
  /** Compaction: tokens freed. */
  tokensBefore: z.number().optional(),
  /** Compaction: why it triggered. */
  compactionReason: z.string().optional(),
  /** Label: the entry this label is attached to. */
  targetId: z.string().optional(),
  /** Message: user/assistant. */
  role: z.enum(['user', 'assistant']).optional(),
  /** Message: first ~80 chars of content. */
  contentPreview: z.string().optional(),
  /** Model change: the model id. */
  modelId: z.string().optional(),
  /** Session info: display name. */
  name: z.string().optional(),
})
export type TreeEntryNode = z.infer<typeof treeEntryNodeSchema>

/** Metadata about a branching point in the session tree. */
export const forkPointSchema = z.object({
  entryId: z.string(),
  /** Leaf IDs of all child branches from this fork point. */
  childLeaves: z.array(z.string()),
  branchCount: z.number().int(),
})
export type ForkPoint = z.infer<typeof forkPointSchema>

/** One branch = a linear path from root entry to a leaf entry. */
export const branchSchema = z.object({
  leafId: z.string(),
  /** Entries ordered from root to leaf. */
  nodes: z.array(treeEntryNodeSchema),
})
export type Branch = z.infer<typeof branchSchema>

export const sessionTreeRequestSchema = z.object({
  path: z.string().min(1),
})
export type SessionTreeRequest = z.infer<typeof sessionTreeRequestSchema>

export const sessionTreeResponseSchema = z.object({
  sessionPath: z.string(),
  branches: z.array(branchSchema),
  forkPoints: z.array(forkPointSchema),
  activeLeafId: z.string().nullable(),
})
export type SessionTreeResponse = z.infer<typeof sessionTreeResponseSchema>

// ─── PTY schemas ────────────────────────────────────────────────────────────

export const ptyCreateSchema = z.object({
  cwd: z.string(),
  cols: z.number().int().min(1).max(512),
  rows: z.number().int().min(1).max(256),
})
export type PtyCreate = z.infer<typeof ptyCreateSchema>

export const ptyWriteSchema = z.object({
  id: z.string(),
  data: z.string(),
})
export type PtyWrite = z.infer<typeof ptyWriteSchema>

export const ptyResizeSchema = z.object({
  id: z.string(),
  cols: z.number().int().min(1).max(512),
  rows: z.number().int().min(1).max(256),
})
export type PtyResize = z.infer<typeof ptyResizeSchema>

export const ptyCloseSchema = z.object({ id: z.string() })
export type PtyClose = z.infer<typeof ptyCloseSchema>

// PTY event payloads (main → renderer)
export const ptyDataSchema = z.object({ id: z.string(), data: z.string() })
export type PtyData = z.infer<typeof ptyDataSchema>

export const ptyExitSchema = z.object({ id: z.string(), code: z.number() })
export type PtyExit = z.infer<typeof ptyExitSchema>

// ─── Output log ─────────────────────────────────────────────────────────────

export const outputLineSchema = z.object({
  level: z.enum(['info', 'warn', 'error']),
  text: z.string(),
  ts: z.number(),
})
export type OutputLine = z.infer<typeof outputLineSchema>

// ─── Preferences ────────────────────────────────────────────────────────────

export const getPrefSchema = z.object({ key: z.string().min(1).max(100) })
export type GetPref = z.infer<typeof getPrefSchema>

export const setPrefSchema = z.object({
  key: z.string().min(1).max(100),
  value: z.string().max(10_000),
})
export type SetPref = z.infer<typeof setPrefSchema>

export const playSoundEffectSchema = z.object({
  sound: z.string().min(1).max(50),
})
export type PlaySoundEffectRequest = z.infer<typeof playSoundEffectSchema>

export const piUpdateCheckResultSchema = z.object({
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  packageName: z.string().nullable(),
  updateAvailable: z.boolean(),
  checkedAt: z.string(),
  error: z.string().nullable(),
})
export type PiUpdateCheckResult = z.infer<typeof piUpdateCheckResultSchema>

export const piUpdateInstallResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
})
export type PiUpdateInstallResult = z.infer<typeof piUpdateInstallResultSchema>

// ─── Git source control schemas ──────────────────────────────────────────────────

export const gitChangedFileSchema = z.object({
  path: z.string(),
  /** Single character git status code */
  status: z.enum(['M', 'A', 'D', 'R', '?', 'U']),
  /** True if this change is in the staging index */
  staged: z.boolean(),
  added: z.number(),
  removed: z.number(),
})
export type GitChangedFile = z.infer<typeof gitChangedFileSchema>

export const gitOperationSchema = z.enum(['none', 'merge', 'rebase', 'cherry-pick'])
export type GitOperation = z.infer<typeof gitOperationSchema>

export const gitStatusResultSchema = z.object({
  branch: z.string(),
  upstream: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  isDetached: z.boolean(),
  hasConflicts: z.boolean(),
  operation: gitOperationSchema,
  stashCount: z.number(),
  totalAdded: z.number(),
  totalRemoved: z.number(),
  files: z.array(gitChangedFileSchema),
})
export type GitStatusResult = z.infer<typeof gitStatusResultSchema>

export const gitFileDiffSchema = z.object({
  path: z.string(),
  /** Raw unified diff string from `git diff` — consumed directly by @pierre/diffs PatchDiff */
  rawPatch: z.string(),
  totalAdded: z.number(),
  totalRemoved: z.number(),
  isNew: z.boolean(),
  isDeleted: z.boolean(),
})
export type GitFileDiff = z.infer<typeof gitFileDiffSchema>

export const gitDiffRequestSchema = z.object({ path: z.string() })
export type GitDiffRequest = z.infer<typeof gitDiffRequestSchema>

export const gitStageSchema = z.object({ path: z.string() })
export type GitStageRequest = z.infer<typeof gitStageSchema>

export const gitUnstageSchema = z.object({ path: z.string() })
export type GitUnstageRequest = z.infer<typeof gitUnstageSchema>

export const gitCommitSchema = z.object({
  /** File paths to stage and commit (never empty) */
  paths: z.array(z.string()).min(1),
  message: z.string().min(1),
  push: z.boolean().default(false),
  amend: z.boolean().default(false),
  signoff: z.boolean().default(false),
})
export type GitCommitRequest = z.infer<typeof gitCommitSchema>

export const gitDiscardSchema = z.object({ path: z.string() })
export type GitDiscardRequest = z.infer<typeof gitDiscardSchema>

export const gitSyncActionSchema = z.enum(['fetch', 'pull', 'pull-rebase', 'push'])
export type GitSyncAction = z.infer<typeof gitSyncActionSchema>

export const gitSyncSchema = z.object({ action: gitSyncActionSchema })
export type GitSyncRequest = z.infer<typeof gitSyncSchema>

export const gitSyncResultSchema = z.object({
  ok: z.boolean(),
  action: gitSyncActionSchema,
  output: z.string(),
})
export type GitSyncResult = z.infer<typeof gitSyncResultSchema>

export const gitBranchRefSchema = z.object({
  name: z.string(),
  label: z.string(),
  commit: z.string(),
  current: z.boolean(),
  remote: z.boolean(),
})
export type GitBranchRef = z.infer<typeof gitBranchRefSchema>

export const gitStashEntrySchema = z.object({
  index: z.number(),
  hash: z.string(),
  message: z.string(),
  date: z.string(),
})
export type GitStashEntry = z.infer<typeof gitStashEntrySchema>

export const gitRefsResultSchema = z.object({
  branches: z.array(gitBranchRefSchema),
  stashes: z.array(gitStashEntrySchema),
})
export type GitRefsResult = z.infer<typeof gitRefsResultSchema>

export const gitCheckoutBranchSchema = z.object({ branch: z.string().min(1) })
export type GitCheckoutBranchRequest = z.infer<typeof gitCheckoutBranchSchema>

export const gitCheckoutBranchResultSchema = z.object({
  ok: z.boolean(),
  branch: z.string(),
  output: z.string(),
})
export type GitCheckoutBranchResult = z.infer<typeof gitCheckoutBranchResultSchema>

export const gitCreateBranchSchema = z.object({
  name: z.string().min(1).max(200),
})
export type GitCreateBranchRequest = z.infer<typeof gitCreateBranchSchema>

export const gitStashActionSchema = z.object({
  index: z.number().int().nonnegative(),
})
export type GitStashActionRequest = z.infer<typeof gitStashActionSchema>

export const gitCreateBranchResultSchema = z.object({
  ok: z.boolean(),
  name: z.string(),
  output: z.string(),
})
export type GitCreateBranchResult = z.infer<typeof gitCreateBranchResultSchema>

export const gitStashActionResultSchema = z.object({
  ok: z.boolean(),
  output: z.string(),
})
export type GitStashActionResult = z.infer<typeof gitStashActionResultSchema>

export const gitHistoryCommitSchema = z.object({
  hash: z.string(),
  shortHash: z.string(),
  parentHashes: z.array(z.string()),
  message: z.string(),
  date: z.string(),
  authorName: z.string(),
  authorEmail: z.string(),
  refs: z.string(),
  graph: z.string(), // ASCII graph line from git log --graph (kept for backwards compat)
  stats: z.string(), // File change stats from git show --stat
})
export type GitHistoryCommit = z.infer<typeof gitHistoryCommitSchema>

/**
 * A single cell in the commit graph at a column position.
 */
export const gitGraphColumnSchema = z.object({
  col: z.number(),
  char: z.string(), // '*', '|', '/', '\\', ' ', '.', '-', '_'
})
export type GitGraphColumn = z.infer<typeof gitGraphColumnSchema>

/**
 * A row in the commit graph — corresponds to one output line from `git log --graph`.
 * commitHash is present for commit rows, absent for graph-only continuation rows.
 */
export const gitGraphRowSchema = z.object({
  columns: z.array(gitGraphColumnSchema),
  commitHash: z.string().optional(),
})
export type GitGraphRow = z.infer<typeof gitGraphRowSchema>

export const gitHistoryRequestSchema = z
  .object({
    query: z.string().optional().default(''),
    limit: z.number().int().min(1).max(200).optional().default(100),
  })
  .optional()
  .default({})
export type GitHistoryRequest = z.infer<typeof gitHistoryRequestSchema>

export const gitHistoryResultSchema = z.object({
  commits: z.array(gitHistoryCommitSchema),
  graphRows: z.array(gitGraphRowSchema),
})
export type GitHistoryResult = z.infer<typeof gitHistoryResultSchema>

export const gitCommitDiffRequestSchema = z.object({
  hash: z.string().min(1),
  path: z.string().optional(),
})
export type GitCommitDiffRequest = z.infer<typeof gitCommitDiffRequestSchema>

export const generateCommitMessageResultSchema = z.object({
  message: z.string(),
})
export type GenerateCommitMessageResult = z.infer<typeof generateCommitMessageResultSchema>

// ─── File tree schema ──────────────────────────────────────────────────

/** Recursive type — validated with z.lazy() */
export type FileTreeNode = {
  name: string
  /** Path relative to workspace root */
  path: string
  isDir: boolean
  children?: FileTreeNode[]
}

export const fileTreeNodeSchema: z.ZodType<FileTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    isDir: z.boolean(),
    children: z.array(fileTreeNodeSchema).optional(),
  })
)

export const fileTreeResultSchema = z.object({
  rootName: z.string(),
  children: z.array(fileTreeNodeSchema),
})
export type FileTreeResult = z.infer<typeof fileTreeResultSchema>

// ─── Content search schemas ─────────────────────────────────────────────────

export const searchFileContentsRequestSchema = z.object({
  query: z.string().max(1000),
  matchCase: z.boolean(),
  wholeWord: z.boolean(),
  useRegex: z.boolean(),
})
export type SearchFileContentsRequest = z.infer<typeof searchFileContentsRequestSchema>

export const contentMatchSchema = z.object({
  /** 1-based line number */
  lineNumber: z.number().int().positive(),
  /** The full matching line text (un-trimmed) */
  text: z.string(),
  /** [start, end] inclusive index pairs for highlighted regions within `text` */
  ranges: z.array(z.tuple([z.number(), z.number()])),
})
export type ContentMatch = z.infer<typeof contentMatchSchema>

export const fileContentHitSchema = z.object({
  /** Workspace-relative file path */
  path: z.string(),
  matches: z.array(contentMatchSchema),
})
export type FileContentHit = z.infer<typeof fileContentHitSchema>

// ─── File content ───────────────────────────────────────────────────────────

export const readFileRequestSchema = z.object({
  /** Path relative to workspace cwd — validated against cwd in Electron main */
  path: z.string().min(1),
})
export type ReadFileRequest = z.infer<typeof readFileRequestSchema>

export const writeFileRequestSchema = z.object({
  /** Path relative to workspace cwd — validated against cwd in Electron main */
  path: z.string().min(1),
  content: z.string(),
})
export type WriteFileRequest = z.infer<typeof writeFileRequestSchema>

export const deleteFileRequestSchema = z.object({
  /** Path relative to workspace cwd — validated against cwd in Electron main */
  path: z.string().min(1),
})
export type DeleteFileRequest = z.infer<typeof deleteFileRequestSchema>

export const deleteFileResultSchema = z.object({
  trashed: z.boolean(),
})
export type DeleteFileResult = z.infer<typeof deleteFileResultSchema>

export const fileContentSchema = z.object({
  content: z.string(),
  /** Byte size of the file */
  size: z.number(),
  /** True when file was larger than the read limit and content was cut */
  truncated: z.boolean(),
})
export type FileContent = z.infer<typeof fileContentSchema>

// ─── Format file (Biome) ───────────────────────────────────────────────────────

export const formatFileRequestSchema = z.object({
  /** Path relative to workspace cwd */
  path: z.string().min(1),
})
export type FormatFileRequest = z.infer<typeof formatFileRequestSchema>

// ─── Theme colors (for swatch rendering) ──────────────────────────────────────

export const themeColorsSchema = z.object({
  accent: z.string().nullable().optional(),
  border: z.string().nullable().optional(),
  userMessageBg: z.string().nullable().optional(),
  toolSuccessBg: z.string().nullable().optional(),
  toolErrorBg: z.string().nullable().optional(),
  syntaxKeyword: z.string().nullable().optional(),
  syntaxString: z.string().nullable().optional(),
  mdHeading: z.string().nullable().optional(),
})
export type ThemeColors = z.infer<typeof themeColorsSchema>

// Full resolved theme tokens (vars palette + semantic colors) — for applying to OpenPi UI
export const themeTokensSchema = z.object({
  /** Raw palette vars resolved to hex, e.g. { crust: '#11111b', base: '#1e1e2e', ... } */
  vars: z.record(z.string()),
  /** Semantic color keys resolved to hex, e.g. { accent: '#cba6f7', success: '#a6e3a1', ... } */
  colors: z.record(z.string()),
})
export type ThemeTokens = z.infer<typeof themeTokensSchema>

// ─── Prompt templates (slash command completions) ──────────────────────────

export const promptTemplateSchema = z.object({
  /** Filename stem used as the slash command — e.g. 'review' → /review */
  name: z.string(),
  description: z.string(),
  /** Optional argument hint from frontmatter, e.g. "[file or path]" */
  argHint: z.string().optional(),
})
export type PromptTemplate = z.infer<typeof promptTemplateSchema>

// ─── fff file search ────────────────────────────────────────────────────

export const fffFileSearchRequestSchema = z.object({
  query: z.string(),
  pageSize: z.number().int().positive().max(1000).optional(),
  cwd: z.string().min(1),
})
export type FffFileSearchRequest = z.infer<typeof fffFileSearchRequestSchema>

export const fffFileResultSchema = z.object({
  relativePath: z.string(),
  fileName: z.string(),
  dir: z.string(),
})
export type FffFileResult = z.infer<typeof fffFileResultSchema>

// ─── fff grep ───────────────────────────────────────────────────────────

export const fffGrepRequestSchema = z.object({
  query: z.string(),
  mode: z.enum(['plain', 'regex', 'fuzzy']).optional(),
  smartCase: z.boolean().optional(),
  maxMatchesPerFile: z.number().int().positive().max(50).optional(),
  timeBudgetMs: z.number().int().positive().max(10_000).optional(),
  cwd: z.string().min(1),
})
export type FffGrepRequest = z.infer<typeof fffGrepRequestSchema>

// ─── Pi settings ───────────────────────────────────────────────────────────

export const piSettingsSchema = z.record(z.string(), z.unknown())
export type PiSettings = z.infer<typeof piSettingsSchema>

export const settingsResultSchema = z.object({
  global: piSettingsSchema,
  project: piSettingsSchema,
  effective: piSettingsSchema,
  globalPath: z.string(),
  projectPath: z.string().nullable(),
})
export type SettingsResult = z.infer<typeof settingsResultSchema>

export const saveSettingsSchema = z.object({
  scope: z.enum(['global', 'project']),
  settings: piSettingsSchema,
})
export type SaveSettingsRequest = z.infer<typeof saveSettingsSchema>

// ─── Archive sessions ──────────────────────────────────────────────────────

// ─── Archived sessions ─────────────────────────────────────────────

export const archivedSessionItemSchema = z.object({
  archivedPath: z.string(),
  originalPath: z.string(),
  workspaceName: z.string(),
  /** File mtime in ms */
  archivedAt: z.number(),
})
export type ArchivedSessionItem = z.infer<typeof archivedSessionItemSchema>

// ─── Skills ─────────────────────────────────────────────────────────

export const skillItemSchema = z.object({
  /** Skill directory name (matches SKILL.md 'name' frontmatter) */
  name: z.string(),
  description: z.string(),
  /** Absolute path to the skill directory */
  path: z.string(),
  scope: z.enum(['user', 'project']),
  tags: z.array(z.string()),
})
export type SkillItem = z.infer<typeof skillItemSchema>

export const readSkillFileRequestSchema = z.object({
  path: z.string().min(1),
})
export type ReadSkillFileRequest = z.infer<typeof readSkillFileRequestSchema>

// ─── Directory listing ─────────────────────────────────────────────────────

export const listDirectoryRequestSchema = z.object({
  /** Path relative to workspace cwd */
  path: z.string().min(1),
})
export type ListDirectoryRequest = z.infer<typeof listDirectoryRequestSchema>

export const directoryEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
})
export type DirectoryEntry = z.infer<typeof directoryEntrySchema>
export const listDirectoryResultSchema = z.array(directoryEntrySchema)
export type ListDirectoryResult = z.infer<typeof listDirectoryResultSchema>

export const unarchiveSessionsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
})
export type UnarchiveSessionsRequest = z.infer<typeof unarchiveSessionsRequestSchema>

export const archiveSessionsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
})
export type ArchiveSessionsRequest = z.infer<typeof archiveSessionsRequestSchema>

export const archiveSessionsResultSchema = z.object({
  archived: z.number(),
  skipped: z.number(),
})
export type ArchiveSessionsResult = z.infer<typeof archiveSessionsResultSchema>

export const deleteSessionsRequestSchema = z.object({
  paths: z.array(z.string().min(1)).min(1),
})
export type DeleteSessionsRequest = z.infer<typeof deleteSessionsRequestSchema>

export const deleteSessionsResultSchema = z.object({
  deleted: z.number(),
  failed: z.number(),
})
export type DeleteSessionsResult = z.infer<typeof deleteSessionsResultSchema>

export const fffGrepMatchSchema = z.object({
  relativePath: z.string(),
  fileName: z.string(),
  lineNumber: z.number(),
  lineContent: z.string(),
  matchRanges: z.array(z.tuple([z.number(), z.number()])),
})
export type FffGrepMatch = z.infer<typeof fffGrepMatchSchema>

// ─── App self-update ─────────────────────────────────────────────────────────

export const appUpdateStatusSchema = z.object({
  state: z.enum(['idle', 'checking', 'available', 'up-to-date', 'error']),
  currentVersion: z.string(),
  latestVersion: z.string().nullable(),
  releaseUrl: z.string().nullable(),
  checkedAt: z.string().nullable(),
  error: z.string().nullable(),
})
export type AppUpdateStatus = z.infer<typeof appUpdateStatusSchema>
