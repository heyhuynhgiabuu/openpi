import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TranscriptContext } from '@earendil-works/pi-ai'
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDurableHarness } from '../electron/pi/durable/harness'

/**
 * Phase 8.2a/8.2b end-to-end: the parity extensions are installed in the real Harness, so a skill
 * reaches the model as prompt context and the policy gate blocks a hard-protected write.
 * The faux provider's response factory receives the request context, which is what we assert on.
 */

let root = ''
let agentDir = ''
let workspacePath = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-parity-'))
  agentDir = join(root, 'agent')
  workspacePath = join(root, 'workspace')
  await mkdir(agentDir, { recursive: true })
  await mkdir(workspacePath, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function fauxSetup() {
  const faux = fauxProvider()
  const contexts: TranscriptContext[] = []
  return {
    faux,
    contexts,
    registerProviders: (models: { setProvider: (provider: typeof faux.provider) => void }) => {
      models.setProvider(faux.provider)
    },
    model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
  }
}

describe('durable parity extensions end-to-end', () => {
  it('delivers a discovered skill to the model as prompt context', async () => {
    const skillDir = join(agentDir, 'skills', 'review')
    await mkdir(skillDir, { recursive: true })
    await writeFile(
      join(skillDir, 'SKILL.md'),
      '---\nname: review\ndescription: Review a diff carefully\n---\n\nREVIEW-SKILL-BODY\n',
      'utf-8'
    )
    const setup = fauxSetup()
    setup.faux.setResponses([
      (context) => {
        setup.contexts.push(context)
        return fauxAssistantMessage([fauxText('done')], { stopReason: 'stop' as const })
      },
    ])
    const harness = await openDurableHarness({
      backend: 'memory',
      model: setup.model,
      registerProviders: setup.registerProviders,
      userAgentDir: agentDir,
      workspacePath,
    })
    try {
      await harness.prompt('hello')
      expect(setup.contexts.length).toBeGreaterThan(0)
      expect(JSON.stringify(setup.contexts)).toContain('REVIEW-SKILL-BODY')
    } finally {
      await harness.close()
    }
  })

  it('blocks a hard-protected write through the installed policy hook', async () => {
    const setup = fauxSetup()
    setup.faux.setResponses([
      fauxAssistantMessage(
        [
          {
            type: 'toolCall',
            id: 'call-1',
            name: 'write',
            arguments: { path: '~/.ssh/id_rsa', content: 'x' },
          } as never,
        ],
        { stopReason: 'toolUse' as const }
      ),
      (context) => {
        setup.contexts.push(context)
        return fauxAssistantMessage([fauxText('done')], { stopReason: 'stop' as const })
      },
    ])
    const harness = await openDurableHarness({
      backend: 'memory',
      model: setup.model,
      registerProviders: setup.registerProviders,
      workspacePath,
    })
    try {
      await harness.prompt('write the key')
      // The blocked tool result is what the model sees on its next request.
      const second = setup.contexts.at(-1)
      expect(JSON.stringify(second ?? {})).toContain('desktop policy')
    } finally {
      await harness.close()
    }
  })
})

describe('durable harness event feed', () => {
  it('exposes the renderer feed through the adapter', async () => {
    const setup = fauxSetup()
    setup.faux.setResponses([
      (context) => {
        setup.contexts.push(context)
        return fauxAssistantMessage([fauxText('adapter streams')], { stopReason: 'stop' as const })
      },
    ])
    const harness = await openDurableHarness({
      backend: 'memory',
      model: setup.model,
      registerProviders: setup.registerProviders,
      workspacePath,
    })
    const seen: string[] = []
    const stop = await harness.watchEvents((event) => {
      seen.push(String(event.type))
    })
    try {
      await harness.prompt('hello')
      expect(seen[0]).toBe('snapshot')
      // The adapter speaks the renderer's vocabulary, not pi-durable's.
      expect(seen).toContain('agent_start')
      expect(seen).toContain('message_end')
    } finally {
      await stop()
      await harness.close()
    }
  })
})
