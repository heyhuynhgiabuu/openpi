import { describe, expect, it } from 'vitest'
import { estimateCacheSavingsUsd, estimateModelBillUsd } from '../src/components/usage/usagePricing'

const rates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

describe('usagePricing', () => {
  it('estimates bill from token parts', () => {
    const bill = estimateModelBillUsd(
      {
        model: 'x',
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      rates
    )
    expect(bill).toBeCloseTo(3)
  })

  it('estimates cache savings as input rate minus cache read rate', () => {
    const saved = estimateCacheSavingsUsd({ cacheReadTokens: 1_000_000 }, rates)
    expect(saved).toBeCloseTo(2.7)
  })
})
