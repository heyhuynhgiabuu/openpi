import { z } from 'zod'

/** Pi RPC extension UI request (see pi-coding-agent/docs/rpc.md). */
export const extensionUiRequestSchema = z.discriminatedUnion('method', [
  z.object({
    id: z.string(),
    method: z.literal('confirm'),
    title: z.string(),
    message: z.string().optional(),
    timeout: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    method: z.literal('select'),
    title: z.string(),
    options: z.array(z.string()),
    timeout: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    method: z.literal('input'),
    title: z.string(),
    placeholder: z.string().optional(),
    timeout: z.number().optional(),
  }),
  z.object({
    id: z.string(),
    method: z.literal('editor'),
    title: z.string(),
    prefill: z.string().optional(),
    timeout: z.number().optional(),
  }),
])

export type ExtensionUiRequest = z.infer<typeof extensionUiRequestSchema>

export const extensionUiResponseSchema = z
  .object({
    id: z.string(),
    cancelled: z.boolean().optional(),
    confirmed: z.boolean().optional(),
    value: z.string().optional(),
  })
  .strict()

export type ExtensionUiResponse = z.infer<typeof extensionUiResponseSchema>

export const resolveExtensionUiResponseSchema = extensionUiResponseSchema
