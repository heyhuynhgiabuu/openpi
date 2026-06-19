import { getModel, getProviders } from '@earendil-works/pi-ai'
import type { UsageModelBucket } from '../../lib/ipc'

/** USD per 1M tokens (pi-ai model catalog). */
export type TokenRates = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const M = 1_000_000

export function warmUsagePricingCatalog(): void {
  getProviders()
}

export function resolveTokenRatesSync(modelId: string, provider?: string): TokenRates | null {
  const id = modelId.trim()
  if (!id) return null

  const candidates: Array<{ provider: string; id: string }> = []
  if (provider) {
    candidates.push({ provider, id })
    if (!id.includes('/')) candidates.push({ provider, id: `${provider}/${id}` })
  }
  for (const p of getProviders()) {
    candidates.push({ provider: p, id })
    if (id.includes('/')) {
      const tail = id.split('/').pop()
      if (tail) candidates.push({ provider: p, id: tail })
    }
  }

  const seen = new Set<string>()
  for (const c of candidates) {
    const key = `${c.provider}:${c.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const model = getModel(c.provider as Parameters<typeof getModel>[0], c.id as never)
    if (model?.cost) return model.cost
  }
  return null
}

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
  for (const m of models) {
    const rates = resolveTokenRatesSync(m.model, m.provider)
    const s = estimateCacheSavingsUsd(m, rates)
    if (s != null) {
      total += s
      any = true
    }
  }
  return any ? total : null
}

export function modelPricingExtras(model: UsageModelBucket): {
  estimatedBill: number | null
  cacheSavings: number | null
} {
  const rates = resolveTokenRatesSync(model.model, model.provider)
  return {
    estimatedBill: estimateModelBillUsd(model, rates),
    cacheSavings: estimateCacheSavingsUsd(model, rates),
  }
}
