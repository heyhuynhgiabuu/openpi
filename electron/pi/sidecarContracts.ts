import { z } from 'zod'
import { extensionUiRequestSchema, extensionUiResponseSchema } from '../../src/lib/extensionUiTypes'
import {
  outputLineSchema,
  providerLoginEventSchema,
  sessionEventSchema,
  sessionInfoSchema,
  sessionReadySchema,
  sessionStatsSchema,
} from '../../src/lib/ipc'

const requestIdSchema = z.string().min(1)
const requiredUnknownSchema = z
  .custom<NonNullable<unknown>>((value) => value !== undefined)
  .nullable()
const optionalContextSchema = { contextPrefix: z.string().optional() }
const optionalWorkspaceSchema = {
  cwd: z.string().min(1).optional(),
  workspaceTrusted: z.boolean().optional(),
}

export const sidecarCommandSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('start_session'),
      cwd: z.string().min(1),
      sessionFile: z.string().min(1).optional(),
      forkEntryId: z.string().min(1).optional(),
      requestId: requestIdSchema.optional(),
      workspaceTrusted: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('prompt'), text: z.string(), ...optionalContextSchema }).strict(),
  z.object({ type: z.literal('steer'), text: z.string(), ...optionalContextSchema }).strict(),
  z.object({ type: z.literal('follow_up'), text: z.string(), ...optionalContextSchema }).strict(),
  z
    .object({
      type: z.literal('list_prompt_templates'),
      requestId: requestIdSchema,
      ...optionalWorkspaceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('list_slash_commands'),
      requestId: requestIdSchema,
      ...optionalWorkspaceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('list_skills'),
      requestId: requestIdSchema,
      ...optionalWorkspaceSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('read_skill_file'),
      requestId: requestIdSchema,
      path: z.string().min(1),
      ...optionalWorkspaceSchema,
    })
    .strict(),
  z.object({ type: z.literal('abort') }).strict(),
  z.object({ type: z.literal('set_model'), provider: z.string(), modelId: z.string() }).strict(),
  z.object({ type: z.literal('set_thinking'), level: z.string() }).strict(),
  z.object({ type: z.literal('get_stats'), requestId: requestIdSchema }).strict(),
  z.object({ type: z.literal('get_models'), requestId: requestIdSchema }).strict(),
  z
    .object({
      type: z.literal('execute_bash'),
      requestId: requestIdSchema,
      command: z.string(),
      excludeFromContext: z.boolean().optional(),
    })
    .strict(),
  z.object({ type: z.literal('set_session_name'), name: z.string() }).strict(),
  z
    .object({
      type: z.literal('fork_session'),
      entryId: z.string().min(1),
      workspaceTrusted: z.boolean(),
      requestId: requestIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('compact'),
      customInstructions: z.string().optional(),
      requestId: requestIdSchema,
    })
    .strict(),
  z.object({ type: z.literal('reload_session'), requestId: requestIdSchema }).strict(),
  z.object({ type: z.literal('get_session_info'), requestId: requestIdSchema }).strict(),
  z.object({ type: z.literal('copy_last_assistant_text'), requestId: requestIdSchema }).strict(),
  z.object({ type: z.literal('get_settings'), requestId: requestIdSchema }).strict(),
  z
    .object({
      type: z.literal('save_settings'),
      scope: z.enum(['global', 'project']),
      settings: z.record(z.unknown()),
    })
    .strict(),
  z.object({ type: z.literal('get_default_project_trust'), requestId: requestIdSchema }).strict(),
  z
    .object({
      type: z.literal('set_default_project_trust'),
      defaultProjectTrust: z.enum(['ask', 'always', 'never']),
    })
    .strict(),
  z.object({ type: z.literal('get_providers'), requestId: requestIdSchema }).strict(),
  z
    .object({
      type: z.literal('set_provider_key'),
      requestId: requestIdSchema,
      provider: z.string().min(1),
      apiKey: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal('remove_provider_key'),
      requestId: requestIdSchema,
      provider: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal('invalidate_models') }).strict(),
  z
    .object({
      type: z.literal('login_provider'),
      requestId: requestIdSchema,
      providerId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('logout_provider'),
      requestId: requestIdSchema,
      providerId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('resolve_provider_prompt'),
      providerId: z.string().min(1),
      value: z.string(),
    })
    .strict(),
  extensionUiResponseSchema.extend({ type: z.literal('extension_ui_response') }).strict(),
  z.object({ type: z.literal('stop') }).strict(),
])

export const sidecarMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z
    .object({
      type: z.literal('session_ready'),
      requestId: requestIdSchema.optional(),
      payload: sessionReadySchema,
    })
    .strict(),
  z.object({ type: z.literal('session_event'), event: sessionEventSchema }).strict(),
  z
    .object({
      type: z.literal('session_error'),
      requestId: requestIdSchema.optional(),
      message: z.string(),
      code: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal('session_index_updated') }).strict(),
  z
    .object({
      type: z.literal('stats_result'),
      requestId: requestIdSchema,
      stats: sessionStatsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('models_result'),
      requestId: requestIdSchema,
      models: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('bash_result'),
      requestId: requestIdSchema,
      result: requiredUnknownSchema,
    })
    .strict(),
  z.object({ type: z.literal('compact_result'), requestId: requestIdSchema }).strict(),
  z
    .object({
      type: z.literal('session_info_result'),
      requestId: requestIdSchema,
      info: sessionInfoSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('last_assistant_text_result'),
      requestId: requestIdSchema,
      text: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('settings_result'),
      requestId: requestIdSchema,
      result: requiredUnknownSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('providers_result'),
      requestId: requestIdSchema,
      providers: z.array(z.unknown()),
    })
    .strict(),
  z.object({ type: z.literal('provider_mutation_result'), requestId: requestIdSchema }).strict(),
  z
    .object({
      type: z.literal('default_project_trust_result'),
      requestId: requestIdSchema,
      defaultProjectTrust: z.enum(['ask', 'always', 'never']),
    })
    .strict(),
  z
    .object({
      type: z.literal('prompt_templates_result'),
      requestId: requestIdSchema,
      prompts: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('slash_commands_result'),
      requestId: requestIdSchema,
      commands: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('skills_result'),
      requestId: requestIdSchema,
      skills: z.array(z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('skill_file_result'),
      requestId: requestIdSchema,
      content: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.literal('provider_login_event'),
      requestId: requestIdSchema,
      event: providerLoginEventSchema,
    })
    .strict(),
  z.object({ type: z.literal('output_append'), line: outputLineSchema }).strict(),
  z.object({ type: z.literal('extension_ui_request'), request: extensionUiRequestSchema }).strict(),
  z
    .object({
      type: z.literal('error'),
      requestId: requestIdSchema.optional(),
      message: z.string(),
    })
    .strict(),
  z.object({ type: z.literal('stopped') }).strict(),
])
