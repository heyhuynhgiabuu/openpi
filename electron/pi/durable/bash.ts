import type { Context } from '@earendil-works/chord'
import { withCancel } from '@earendil-works/chord/context'
import { OutputBuffer } from '@earendil-works/chord/output'
import type { Conversation, EntryDraft } from '@earendil-works/pi-durable'
import type { ExecutionEnv } from '@earendil-works/pi-durable/env'
import { z } from 'zod'
import { createOutputCleaner } from './ansi'

/**
 * Phase 8.3n: the user's own shell commands (`execute_bash`, the `!` prefix in the composer) on a
 * durable session.
 *
 * Runs through the same execution environment as the model's `bash` tool, keeps the same output
 * window (the last 2000 lines or 50 KB), and records the run as an `openpi.bash` entry. Unless the
 * user excluded it, the entry also carries a model-visible message, so the model knows what the
 * user ran, as in the SDK path.
 */

/** Application entry kind; pi-durable reserves `pi.*`. */
export const BASH_KIND = 'openpi.bash'

const MAX_BYTES = 50 * 1024
const MAX_LINES = 2000

/** What the renderer's `bashExecutionResultSchema` accepts. */
export interface BashResult {
  output: string
  exitCode?: number
  cancelled: boolean
  truncated: boolean
  fullOutputPath?: string
}

/** The persisted form of one run: the result plus what was run and whether the model sees it. */
export const bashRecordSchema = z.object({
  command: z.string(),
  output: z.string(),
  exitCode: z.number().optional(),
  cancelled: z.boolean(),
  truncated: z.boolean(),
  fullOutputPath: z.string().optional(),
  excludeFromContext: z.boolean().optional(),
  timestamp: z.number(),
})
export type BashRecord = z.infer<typeof bashRecordSchema>

/** The text the model reads for a run; mirrors the SDK's `bashExecutionToText` (tested for parity). */
export function bashText(record: BashRecord): string {
  let text = `Ran \`${record.command}\`\n`
  text += record.output ? `\`\`\`\n${record.output}\n\`\`\`` : '(no output)'
  if (record.cancelled) text += '\n\n(command cancelled)'
  else if (record.exitCode !== undefined && record.exitCode !== 0) {
    text += `\n\nCommand exited with code ${record.exitCode}`
  }
  if (record.truncated && record.fullOutputPath) {
    text += `\n\n[Output truncated. Full output: ${record.fullOutputPath}]`
  }
  return text
}

export function bashEntryDraft(record: BashRecord): EntryDraft {
  const data: Record<string, string | number | boolean> = {
    command: record.command,
    output: record.output,
    cancelled: record.cancelled,
    truncated: record.truncated,
    timestamp: record.timestamp,
  }
  if (record.exitCode !== undefined) data.exitCode = record.exitCode
  if (record.fullOutputPath !== undefined) data.fullOutputPath = record.fullOutputPath
  if (record.excludeFromContext !== undefined) data.excludeFromContext = record.excludeFromContext
  const draft: EntryDraft = { kind: BASH_KIND, data }
  if (record.excludeFromContext === true) return draft
  return {
    ...draft,
    model: [
      {
        role: 'user',
        content: [{ type: 'text', text: bashText(record) }],
        timestamp: record.timestamp,
      },
    ],
  }
}

export interface BashRunner {
  run: (command: string, cwd: string) => Promise<BashResult>
  /** Cancel every running command (session shutdown). */
  cancelAll: () => void
}

export function createBashRunner(env: ExecutionEnv, ctx: Context): BashRunner {
  const running = new Set<() => void>()
  return {
    async run(command, cwd) {
      const output = new OutputBuffer({ maxBytes: MAX_BYTES, maxLines: MAX_LINES, retain: 'tail' })
      const cleaner = createOutputCleaner()
      const { context, cancel } = withCancel(ctx)
      running.add(cancel)
      try {
        const result = await env.exec(
          command,
          {
            cwd,
            onOutput: (text) => void output.push(cleaner.clean(text)),
            spill: { afterBytes: MAX_BYTES, afterLines: MAX_LINES },
          },
          context
        )
        output.push(cleaner.flush())
        output.end()
        const kept = output.snapshot()
        const text = kept.text
        const truncated = kept.droppedBytes > 0 || kept.droppedLines > 0
        if (result.ok) {
          const done: BashResult = {
            output: text,
            exitCode: result.value.exitCode,
            cancelled: false,
            truncated,
          }
          if (result.value.spillPath !== undefined) done.fullOutputPath = result.value.spillPath
          return done
        }
        // A command cancelled by the user keeps the output it produced; any other failure (the
        // shell could not start) is an error for the requester, not a result.
        if (result.error.code !== 'aborted') throw new Error(result.error.message)
        const cancelled: BashResult = { output: text, cancelled: true, truncated }
        if (result.error.spillPath !== undefined) cancelled.fullOutputPath = result.error.spillPath
        return cancelled
      } finally {
        running.delete(cancel)
      }
    },
    cancelAll() {
      for (const cancel of [...running]) cancel()
    },
  }
}

/** Run the user's command and record it in the conversation; resolves with the result. */
export async function runAndRecord(
  runner: BashRunner,
  conversation: Conversation,
  context: Context,
  command: string,
  cwd: string,
  excludeFromContext: boolean | undefined
): Promise<BashResult> {
  const result = await runner.run(command, cwd)
  const record: BashRecord = { ...result, command, timestamp: Date.now() }
  if (excludeFromContext !== undefined) record.excludeFromContext = excludeFromContext
  const submission = await conversation.submit(
    { type: 'write', entry: bashEntryDraft(record) },
    context
  )
  await submission.wait(context)
  return result
}
