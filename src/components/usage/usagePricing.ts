import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import type { UsageModelBucket } from '../../lib/ipc'

/** USD per 1M tokens (pi-ai model catalog). */
export type TokenRates = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

const M = 1_000_000
let pricingCatalog: Map<string, Map<string, TokenRates>> | null = null

function getPricingCatalog(): Map<string, Map<string, TokenRates>> {
  if (pricingCatalog) return pricingCatalog

  pricingCatalog = new Map()
  for (const provider of getBuiltinProviders()) {
    const models = new Map<string, TokenRates>()
    for (const model of getBuiltinModels(provider)) {
      models.set(model.id, model.cost)
    }
    pricingCatalog.set(provider, models)
  }
  return pricingCatalog
}

export function warmUsagePricingCatalog(): void {
  getPricingCatalog()
}

export function resolveTokenRatesSync(modelId: string, provider?: string): TokenRates | null {
  const id = modelId.trim()
  if (!id) return null

  const catalog = getPricingCatalog()
  const candidates: Array<{ provider: string; id: string }> = []
  if (provider) {
    candidates.push({ provider, id })
    if (!id.includes('/')) candidates.push({ provider, id: `${provider}/${id}` })
  }
  for (const catalogProvider of catalog.keys()) {
    candidates.push({ provider: catalogProvider, id })
    if (id.includes('/')) {
      const tail = id.split('/').pop()
      if (tail) candidates.push({ provider: catalogProvider, id: tail })
    }
  }

  const seen = new Set<string>()
  for (const candidate of candidates) {
    const key = `${candidate.provider}:${candidate.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const rates = catalog.get(candidate.provider)?.get(candidate.id)
    if (rates) return rates
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
  for (const model of models) {
    const rates = resolveTokenRatesSync(model.model, model.provider)
    const savings = estimateCacheSavingsUsd(model, rates)
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
  const rates = resolveTokenRatesSync(model.model, model.provider)
  return {
    estimatedBill: estimateModelBillUsd(model, rates),
    cacheSavings: estimateCacheSavingsUsd(model, rates),
  }
}
