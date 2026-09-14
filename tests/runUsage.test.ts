import { describe, expect, it } from 'vitest'
import { addTurnUsage, EMPTY_RUN_USAGE } from '../src/lib/runUsage'

function turnEnd(usage: unknown): unknown {
  return { type: 'turn_end', message: { role: 'assistant', usage }, toolResults: [] }
}

describe('run usage accumulator', () => {
  it('starts empty', () => {
    expect(EMPTY_RUN_USAGE).toEqual({
      turns: 0,
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
      cost: 0,
    })
  })

  it('adds one turn of provider usage', () => {
    const run = addTurnUsage(
      EMPTY_RUN_USAGE,
      turnEnd({
        input: 1_000,
        output: 200,
        cacheRead: 500,
        cacheWrite: 100,
        totalTokens: 1_800,
        cost: { total: 0.0123 },
      })
    )

    expect(run).toEqual({
      turns: 1,
      input: 1_000,
      output: 200,
      cacheRead: 500,
      cacheWrite: 100,
      total: 1_800,
      cost: 0.0123,
    })
  })

  it('accumulates across turns', () => {
    const first = addTurnUsage(
      EMPTY_RUN_USAGE,
      turnEnd({ input: 100, output: 10, totalTokens: 110, cost: { total: 0.001 } })
    )
    const second = addTurnUsage(
      first,
      turnEnd({ input: 200, output: 20, totalTokens: 220, cost: { total: 0.002 } })
    )

    expect(second.turns).toBe(2)
    expect(second.input).toBe(300)
    expect(second.output).toBe(30)
    expect(second.total).toBe(330)
    expect(second.cost).toBeCloseTo(0.003)
  })

  it('counts a turn whose provider reported no usage', () => {
    const run = addTurnUsage(EMPTY_RUN_USAGE, turnEnd(undefined))

    expect(run.turns).toBe(1)
    expect(run.total).toBe(0)
    expect(run.cost).toBe(0)
  })

  it('derives total from parts when totalTokens is absent', () => {
    const run = addTurnUsage(EMPTY_RUN_USAGE, turnEnd({ input: 10, output: 5, cacheRead: 2 }))

    expect(run.total).toBe(17)
  })

  it('accepts a numeric cost and ignores non-numeric values', () => {
    const numericCost = addTurnUsage(EMPTY_RUN_USAGE, turnEnd({ output: 5, cost: 0.004 }))
    expect(numericCost.cost).toBe(0.004)

    const malformed = addTurnUsage(
      EMPTY_RUN_USAGE,
      turnEnd({ input: 'lots', output: Number.NaN, totalTokens: Number.POSITIVE_INFINITY })
    )
    expect(malformed.input).toBe(0)
    expect(malformed.output).toBe(0)
    expect(malformed.total).toBe(0)
    expect(malformed.cost).toBe(0)
  })

  it('tolerates events without a message payload', () => {
    expect(addTurnUsage(EMPTY_RUN_USAGE, { type: 'turn_end' }).turns).toBe(1)
    expect(addTurnUsage(EMPTY_RUN_USAGE, null).turns).toBe(1)
    expect(addTurnUsage(EMPTY_RUN_USAGE, 'turn_end').turns).toBe(1)
  })

  it('parses the usage shape Pi writes into real session files', () => {
    // Copied from an assistant message in a real session JSONL: totalTokens is
    // authoritative and is not the sum of the parts once cache reads are involved.
    const run = addTurnUsage(
      EMPTY_RUN_USAGE,
      turnEnd({
        input: 347,
        output: 71,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        totalTokens: 13_986,
        cost: {
          input: 0.0000694,
          output: 0.00004686,
          cacheRead: 0.00054272,
          cacheWrite: 0,
          total: 0.00065898,
        },
      })
    )

    expect(run.total).toBe(13_986)
    expect(run.cost).toBeCloseTo(0.00065898)
  })
})
