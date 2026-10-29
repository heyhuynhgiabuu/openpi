import { describe, expect, it } from 'vitest'
import { slashCommandsOf } from '../electron/pi/durable/commands'
import { handleResourceCommand } from '../electron/pi/resourceCommands'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'

/**
 * The slash picker on a durable session. With no SDK session the handler used to answer `[]`, so the
 * composer showed no templates at all even though the harness had discovered them.
 */

function deps(options: {
  session?: unknown
  durable?: Array<{ name: string; description: string; argHint?: string }>
}): {
  sent: SidecarMessage[]
  call: () => Promise<void>
} {
  const sent: SidecarMessage[] = []
  const resourceDeps = {
    getCwd: () => '/work',
    getSession: () => (options.session ?? null) as never,
    getResourceLoader: () => Promise.reject(new Error('not used here')),
    send: (message: SidecarMessage) => sent.push(message),
    getDurableCommands: options.durable ? () => options.durable : undefined,
  }
  return {
    sent,
    call: () =>
      handleResourceCommand(
        { type: 'list_slash_commands', requestId: 'r1', cwd: '/work', workspaceTrusted: false },
        resourceDeps
      ),
  }
}

describe('the slash picker with a durable session serving', () => {
  it('offers what the harness discovered, with its argument hints', async () => {
    const { sent, call } = deps({
      durable: [
        { name: 'review', description: 'Review the diff', argHint: '<path>' },
        { name: 'skill:manual', description: 'Typed-only skill' },
      ],
    })
    await call()
    expect(sent).toEqual([
      {
        type: 'slash_commands_result',
        requestId: 'r1',
        commands: [
          { name: 'review', description: 'Review the diff', source: 'prompt', argHint: '<path>' },
          { name: 'skill:manual', description: 'Typed-only skill', source: 'prompt' },
        ],
      },
    ])
  })

  it('answers an empty list when no runtime offers anything, rather than failing', async () => {
    const { sent, call } = deps({})
    await call()
    expect(sent).toEqual([{ type: 'slash_commands_result', requestId: 'r1', commands: [] }])
  })
})

describe('what the durable harness offers as slash commands', () => {
  it('lists prompt templates and the slash-only skills, and only those skills', () => {
    const commands = slashCommandsOf({
      skills: [
        { name: 'manual', description: 'typed only', slashOnly: true },
        { name: 'review', description: 'model-invocable', slashOnly: false },
      ],
      prompts: [{ name: 'audit', description: 'Audit it', argumentHint: '<path>' }],
      extensions: [],
      diagnostics: [],
    } as unknown as Parameters<typeof slashCommandsOf>[0])
    expect(commands).toEqual([
      { name: 'audit', description: 'Audit it', argHint: '<path>' },
      { name: 'skill:manual', description: 'typed only' },
    ])
  })

  it('offers nothing when discovery found nothing', () => {
    expect(slashCommandsOf(undefined)).toEqual([])
  })
})
