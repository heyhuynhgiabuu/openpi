import { z } from 'zod'

/**
 * Prefix that turns a ctx.ui.input placeholder into a pre-apply review request.
 * Pi's extension UI only carries strings, so `.pi/extensions/openpi-preapply-review/index.ts`
 * smuggles its payload through the input placeholder and the sidecar (below)
 * replaces the text box with the renderer's hunk review. Keep both literals in sync.
 */
export const PREAPPLY_REVIEW_MARKER = 'openpi-preapply-review:'

/** One entry of Pi's edit tool `edits[]`, as the review dialog shows it. */
export const preapplyHunkSchema = z.object({
  diff: z.string(),
  removed: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
})

export const preapplyReviewSchema = z.object({
  path: z.string(),
  summary: z.string(),
  hunks: z.array(preapplyHunkSchema).min(1),
})

export type PreapplyHunk = z.infer<typeof preapplyHunkSchema>
export type PreapplyReview = z.infer<typeof preapplyReviewSchema>

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
  z.object({
    id: z.string(),
    method: z.literal('preapply_review'),
    title: z.string(),
    review: preapplyReviewSchema,
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
    /** Approved hunk indexes of a preapply_review request. */
    approved: z.array(z.number().int().nonnegative()).optional(),
    /** The user asked to skip review for the rest of the turn. */
    remember: z.boolean().optional(),
  })
  .strict()

export type ExtensionUiResponse = z.infer<typeof extensionUiResponseSchema>

export const resolveExtensionUiResponseSchema = extensionUiResponseSchema
