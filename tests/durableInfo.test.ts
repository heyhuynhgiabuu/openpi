import { describe, expect, it } from 'vitest'
import { contextFill, sessionInfoMessage, statsMessage } from '../electron/pi/durableInfo'
import { computeStats } from '../electron/pi/durable/stats'

/**
 * Phase 8.3i: the pure parts behind get_stats / get_session_info on a durable session.
 */

const model = { id: 'm', name: 'M', provider: 'p', reasoning: false, contextWindow: 1000 }
const identity = { sessionId: 'sess', sessionFile: '/s.jsonl' }
const stats = {
  inputTokens: 1,
  outputTokens: 2,
  cacheReadTokens: 3,
  cacheWriteTokens: 4,
  cost: 0.5,
  messageCount: 6,
  lastAssistantText: null,
  contextTokens: 250,
}

describe('contextFill', () => {
  it('reports percent, tokens and window once a response has been seen', () => {
    expect(contextFill(model, 250)).toEqual({
      contextUsagePercent: 25,
      contextTokens: 250,
      contextWindow: 1000,
    })
  })

  it.each([
    ['no response yet', model, null],
    ['an unknown model', null, 250],
    ['a model without a context window', { ...model, contextWindow: 0 }, 250],
  ])('is all null for %s', (_name, source, tokens) => {
    expect(contextFill(source, tokens)).toEqual({
      contextUsagePercent: null,
      contextTokens: null,
      contextWindow: null,
    })
  })
})

describe('payloads', () => {
  const source = { model, identity, streaming: true }

  it('shapes get_stats like the SDK path, including streaming state', () => {
    expect(statsMessage('r1', source, stats)).toEqual({
      type: 'stats_result',
      requestId: 'r1',
      stats: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        cost: 0.5,
        contextUsagePercent: 25,
        contextTokens: 250,
        contextWindow: 1000,
        sessionFile: '/s.jsonl',
        sessionId: 'sess',
        isStreaming: true,
      },
    })
  })

  it('shapes get_session_info with the unsupported fields explicitly null', () => {
    const message = sessionInfoMessage('r2', source, stats)
    expect(message.info).toMatchObject({
      sessionFile: '/s.jsonl',
      sessionId: 'sess',
      model,
      messageCount: 6,
      contextUsagePercent: 25,
      sessionName: null,
      thinkingLevel: null,
    })
  })
})

describe('computeStats', () => {
  const usage = (input: number, cost: number) => ({
    input,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: input + 1,
    cost: { total: cost },
  })

  it('sums model and tool buckets of the ledger', () => {
    const result = computeStats(
      { models: { 'a/x': usage(10, 0.25), 'a/y': usage(5, 0.25) }, tools: { bash: usage(2, 0) } },
      [],
      3
    )
    expect(result).toMatchObject({ inputTokens: 17, outputTokens: 3, cost: 0.5, messageCount: 3 })
  })

  it('skips a bucket that does not look like usage instead of failing', () => {
    const result = computeStats({ models: { good: usage(4, 0), bad: 'nope' }, tools: {} }, [], 0)
    expect(result.inputTokens).toBe(4)
  })

  it('returns zeros for an empty or malformed ledger', () => {
    expect(computeStats({}, [], 0)).toMatchObject({ inputTokens: 0, cost: 0, contextTokens: null })
    expect(computeStats('garbage', [], 0)).toMatchObject({ inputTokens: 0, cost: 0 })
  })
})
