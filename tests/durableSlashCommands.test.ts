import { describe, expect, it, vi } from 'vitest'
import { slashCommandsOf } from '../electron/pi/durable/commands'
import { handleResourceCommand } from '../electron/pi/resourceCommands'
import type { DurableCustomizations } from '../electron/pi/durable/customizations'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'

/**
 * The slash picker on a durable session. With no SDK session the handler used to answer `[]`, so the
 * composer showed no templates at all even though the harness had discovered them.
 */

function deps(options: {
  durable?: Array<{ name: string; description: string; argHint?: string }>
}): {
  sent: SidecarMessage[]
  call: () => Promise<void>
} {
  const sent: SidecarMessage[] = []
  const resourceDeps = {
    getCwd: () => '/work',
    // No SDK session: a durable one is what is serving.
    getSession: () => null,
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
    const skill = (name: string, slashOnly: boolean): DurableCustomizations['skills'][number] => ({
      name,
      description: `${name} skill`,
      filePath: `/skills/${name}/SKILL.md`,
      baseDir: `/skills/${name}`,
      body: `${name} body`,
      slashOnly,
    })
    const commands = slashCommandsOf({
      skills: [skill('manual', true), skill('review', false)],
      prompts: [
        {
          name: 'audit',
          description: 'Audit it',
          argumentHint: '<path>',
          filePath: '/prompts/audit.md',
          body: 'Audit $ARGUMENTS.',
        },
      ],
      diagnostics: [],
    })
    expect(commands).toEqual([
      { name: 'audit', description: 'Audit it', argHint: '<path>' },
      { name: 'skill:manual', description: 'manual skill' },
    ])
  })

  it('offers nothing when discovery found nothing', () => {
    expect(slashCommandsOf(undefined)).toEqual([])
  })
})

describe('the deps the sidecar builds', () => {
  it('asks the durable runtime for its commands, so the picker is not empty', async () => {
    // `sidecar.ts` hands these straight to `handleResourceCommand`. Deleting the durable half here
    // passes every other test in this file, so this is the seam that keeps the fix alive.
    const { durableSessions } = await import('../electron/pi/durableHost')
    const ask = vi
      .spyOn(durableSessions, 'promptCommands')
      .mockReturnValue([{ name: 'audit', description: 'Audit it' }])
    try {
      const { resourceCommandDeps } = await import('../electron/pi/resourceDeps')
      expect(resourceCommandDeps.getDurableCommands()).toEqual([
        { name: 'audit', description: 'Audit it' },
      ])
      expect(ask).toHaveBeenCalled()
    } finally {
      ask.mockRestore()
    }
  })
})

describe('the workspace the resource commands fall back to', () => {
  it("is the durable session's when no SDK session is serving", async () => {
    // Every resource request from main carries a cwd today, so this fallback is a backstop — which
    // is exactly the kind of line that gets deleted silently.
    const { durableSessions } = await import('../electron/pi/durableHost')
    const cwd = vi.spyOn(durableSessions, 'cwd').mockReturnValue('/durable-workspace')
    try {
      const { resourceCommandDeps } = await import('../electron/pi/resourceDeps')
      expect(resourceCommandDeps.getCwd()).toBe('/durable-workspace')
    } finally {
      cwd.mockRestore()
    }
  })
})
