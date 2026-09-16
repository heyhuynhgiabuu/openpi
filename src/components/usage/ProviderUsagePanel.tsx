/**
 * Market-share panel: provider share chart plus per-provider cards with
 * volume, share, and estimated cache savings.
 */

import { createMemo, createSignal, For, Show } from 'solid-js'
import type { UsageModelBucket, UsageSummary } from '../../lib/ipc'
import { formatCurrency } from '../../lib/sessionView'
import { ProviderShareChart } from './ProviderShareChart'
import type { ProviderBucket } from './usageAggregates'
import { providerGroupKey } from './usageAggregates'
import { formatSharePct, formatTokenMetric } from './usageFormat'
import { modelPricingExtras } from './usagePricing'
import { providerChartColor } from './usageProviderTrend'

export function ProviderUsagePanel(props: {
  providers: ProviderBucket[]
  dailyModels: UsageSummary['dailyModels']
  maxTrendWeeks: number
  allModels: UsageModelBucket[]
}) {
  const totalTokens = createMemo(() =>
    props.providers.reduce((sum, row) => sum + row.totalTokens, 0)
  )

  const [activeProviderKey, setActiveProviderKey] = createSignal<string | null>(null)

  const providerSavings = createMemo(() => {
    const map = new Map<string, number>()
    for (const m of props.allModels) {
      const key = providerGroupKey(m.provider)
      const { cacheSavings } = modelPricingExtras(m)
      if (cacheSavings == null) continue
      map.set(key, (map.get(key) ?? 0) + cacheSavings)
    }
    return map
  })

  return (
    <div class="usage-panel">
      <header class="usage-panel-head">
        <h3 class="usage-section-title">
          Market share<span class="usage-section-dot">.</span>
        </h3>
        <p class="usage-section-desc">
          Token share by provider in this range · {formatTokenMetric(totalTokens())} total
        </p>
      </header>
      <div class="usage-panel-subsection">
        <h4 class="usage-subsection-title">Share over time</h4>
        <ProviderShareChart
          dailyModels={props.dailyModels}
          maxWeeks={props.maxTrendWeeks}
          activeProviderKey={activeProviderKey()}
          onActiveProviderChange={setActiveProviderKey}
        />
      </div>
      <Show
        when={props.providers.length > 0}
        fallback={
          <div class="usage-models-placeholder">
            No provider breakdown yet. Assistant turns with model metadata will appear after
            sessions are indexed.
          </div>
        }
      >
        <div class="usage-provider-grid">
          <For each={props.providers}>
            {(row, index) => {
              const share = totalTokens() > 0 ? (row.totalTokens / totalTokens()) * 100 : 0
              const pk = providerGroupKey(row.provider)
              const color = providerChartColor(pk, index())
              const savings = providerSavings().get(pk)
              const isActive = activeProviderKey() === pk
              const isDimmed = activeProviderKey() != null && !isActive
              return (
                <button
                  type="button"
                  class={`usage-provider-card${isActive ? ' is-pinned' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                  onPointerEnter={(event) => {
                    if (event.pointerType === 'touch') return
                    setActiveProviderKey(pk)
                  }}
                  onPointerLeave={() => setActiveProviderKey(null)}
                >
                  <span class="usage-provider-swatch" style={{ background: color }} />
                  <span class="usage-provider-rank">{String(index() + 1).padStart(2, '0')}</span>
                  <span class="usage-provider-name">{row.model}</span>
                  <span class="usage-provider-volume">{formatTokenMetric(row.totalTokens)}</span>
                  <span class="usage-provider-share">{formatSharePct(share)}</span>
                  <Show when={(savings ?? 0) > 0}>
                    <span class="usage-provider-saving">saved {formatCurrency(savings ?? 0)}</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
