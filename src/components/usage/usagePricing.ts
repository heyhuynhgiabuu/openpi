import type { TokenRates, UsageModelBucket } from '../../lib/ipc'

const M = 1_000_000

export function estimateModelBillUsd(
  row: Pick<
    UsageModelBucket,
    'model' | 'provider' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
  >,
  rates: TokenRates | null
): number | null {
  if (!rates) return null
  return (
    (row.inputTokens * rates.input +
      row.outputTokens * rates.output +
      row.cacheReadTokens * rates.cacheRead +
      row.cacheWriteTokens * rates.cacheWrite) /
    M
  )
}

/** Full input price minus cache-read price on cached tokens. */
export function estimateCacheSavingsUsd(
  row: Pick<UsageModelBucket, 'cacheReadTokens'>,
  rates: TokenRates | null
): number | null {
  if (!rates || row.cacheReadTokens <= 0) return null
  const full = (row.cacheReadTokens * rates.input) / M
  const cached = (row.cacheReadTokens * rates.cacheRead) / M
  const saved = full - cached
  return saved > 0 ? saved : 0
}

export function sumCacheSavingsForModels(models: UsageModelBucket[]): number | null {
  let total = 0
  let any = false
  for (const model of models) {
    const savings = estimateCacheSavingsUsd(model, model.rates ?? null)
    if (savings != null) {
      total += savings
      any = true
    }
  }
  return any ? total : null
}

export function modelPricingExtras(model: UsageModelBucket): {
  estimatedBill: number | null
  cacheSavings: number | null
} {
  const rates = model.rates ?? null
  return {
    estimatedBill: estimateModelBillUsd(model, rates),
    cacheSavings: estimateCacheSavingsUsd(model, rates),
  }
}
