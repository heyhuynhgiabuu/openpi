import { z } from 'zod'
import type { SessionEvent } from './ipc'

const nestedCallEnvelopeSchema = z.object({
  type: z.enum(['tool_execution_start', 'tool_execution_update', 'tool_execution_end']),
  parentToolCallId: z.string().min(1),
})

/**
 * Pi runs a tool's own calls (`ctx.executeTool`, e.g. a codemode script's
 * `tools.write`) through the tool pipeline and emits `tool_execution_*` events
 * for them with `parentToolCallId` and a child id `<parent id>/<n>`. Those calls
 * are not transcript tool calls and append no session entry; the calling tool's
 * card is the only one the transcript (and a resumed session) shows.
 */
export function isNestedToolEvent(event: SessionEvent): boolean {
  return nestedCallEnvelopeSchema.safeParse(event).success
}
