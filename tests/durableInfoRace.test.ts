import { describe, expect, it } from 'vitest'
import { answerInfoCommand, type InfoSource } from '../electron/pi/durableInfo'
import type { DurableStats } from '../electron/pi/durable/stats'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'

/**
 * The reply must describe the session as it is when the stats are ready, not as it was when the
 * command arrived: settings commands run concurrently with info commands.
 */

const STATS: DurableStats = {
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0,
  messageCount: 2,
  lastAssistantText: 'hi',
  contextTokens: 100,
  sessionName: null,
}

const model = (id: string, contextWindow: number) => ({
  id,
  name: id,
  provider: 'faux',
  reasoning: false,
  contextWindow,
})

describe('answerInfoCommand', () => {
  it.each(['get_stats', 'get_session_info'] as const)(
    '%s reads the session after the stats resolve',
    async (type) => {
      let release: () => void = () => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const source: InfoSource = {
        model: model('old', 1000),
        identity: { sessionId: 's', sessionFile: '/f' },
        streaming: false,
        sessionName: null,
        thinkingLevel: 'low',
      }
      const sent: SidecarMessage[] = []
      const harness = {
        stats: async () => {
          await gate
          return STATS
        },
      }
      const pending = answerInfoCommand(
        { type, requestId: 'r' },
        // A fresh snapshot per call, like the session's `view()`.
        () => ({ ...source }),
        harness,
        (m) => sent.push(m)
      )
      // A settings command lands while the stats are being read.
      source.model = model('new', 200)
      source.thinkingLevel = 'high'
      source.streaming = true
      release()
      await pending

      const reply = JSON.stringify(sent[0])
      if (type === 'get_session_info') {
        expect(reply).toContain('"new"')
        expect(reply).not.toContain('"old"')
      }
      // Context fill uses the new model's window (100 / 200), not the old one's.
      expect(reply).toContain('"contextWindow":200')
      expect(reply).toContain(
        type === 'get_stats' ? '"isStreaming":true' : '"thinkingLevel":"high"'
      )
    }
  )
})
