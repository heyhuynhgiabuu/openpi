/**
 * Example: confirm before mutating tools (write / edit).
 * Copy to ~/.pi/agent/extensions/openpi-edit-confirm.ts and /reload.
 *
 * Requires OpenPi extension UI bridge (ctx.ui.confirm → desktop modal).
 */
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { isToolCallEventType } from '@earendil-works/pi-coding-agent'

const MUTATING = new Set(['write', 'edit', 'apply_patch', 'patch', 'multiedit'])

export default function (pi: ExtensionAPI) {
  pi.on('tool_call', async (event, ctx) => {
    if (!MUTATING.has(event.toolName)) return

    let detail = event.toolName
    if (isToolCallEventType('write', event)) {
      detail = `write ${event.input.path}`
    } else if (isToolCallEventType('edit', event)) {
      detail = `edit ${event.input.path}`
    }

    const ok = await ctx.ui.confirm('Allow file change?', detail, { timeout: 120_000 })
    if (!ok) return { block: true, reason: 'User declined in OpenPi' }
  })
}
