/**
 * Provider-level aggregation of per-model usage buckets: rolls model rows up
 * to their provider group and ranks by token volume.
 */

import type { UsageModelBucket } from '../../lib/ipc'
import { cacheHitRate, formatProviderLabel } from './usageFormat'

export type ProviderBucket = UsageModelBucket & { model: string }

export function aggregateProviders(models: UsageModelBucket[]): ProviderBucket[] {
  const map = new Map<string, ProviderBucket>()
  for (const row of models) {
    const key = providerGroupKey(row.provider)
    const label = formatProviderLabel(row.provider) || 'Unknown'
    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        model: label,
        provider: row.provider,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        cacheReadTokens: row.cacheReadTokens,
        cacheWriteTokens: row.cacheWriteTokens,
        totalTokens: row.totalTokens,
        durationMs: row.durationMs,
        cost: row.cost,
        turnCount: row.turnCount,
        sessionCount: row.sessionCount,
        cacheHitRate: null,
      })
      continue
    }
    existing.inputTokens += row.inputTokens
    existing.outputTokens += row.outputTokens
    existing.cacheReadTokens += row.cacheReadTokens
    existing.cacheWriteTokens += row.cacheWriteTokens
    existing.totalTokens += row.totalTokens
    existing.durationMs += row.durationMs
    existing.cost += row.cost
    existing.turnCount += row.turnCount
    existing.sessionCount = Math.max(existing.sessionCount, row.sessionCount)
    existing.cacheHitRate = cacheHitRate(existing.inputTokens, existing.cacheReadTokens)
  }
  return [...map.values()].sort((a, b) => b.totalTokens - a.totalTokens)
}

export function providerGroupKey(provider: string | undefined): string {
  const p = provider?.trim().toLowerCase()
  return p || '__unknown__'
}
