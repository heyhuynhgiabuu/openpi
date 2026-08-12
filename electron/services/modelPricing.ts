import { getBuiltinModels, getBuiltinProviders } from '@earendil-works/pi-ai/providers/all'
import type { TokenRates } from '../../src/lib/ipc'

let pricingCatalog: Map<string, Map<string, TokenRates>> | null = null

function getPricingCatalog(): Map<string, Map<string, TokenRates>> {
  if (pricingCatalog) return pricingCatalog
  pricingCatalog = new Map()
  for (const provider of getBuiltinProviders()) {
    const models = new Map<string, TokenRates>()
    for (const model of getBuiltinModels(provider)) models.set(model.id, model.cost)
    pricingCatalog.set(provider, models)
  }
  return pricingCatalog
}

export function resolveTokenRates(modelId: string, provider?: string): TokenRates | null {
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
