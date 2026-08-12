import { createMemo, For, Show } from 'solid-js'
import type { UsageModelBucket, UsageSummary } from '../../lib/ipc'
import { formatCurrency, formatModelName } from '../../lib/sessionView'
import { DailyModelChart } from './DailyModelChart'
import { formatProviderLabel, formatTokenMetric } from './usageFormat'
import { findDeltaPct, formatDeltaPct, modelKey, pickModelColor } from './usageModelTrend'
import { modelPricingExtras } from './usagePricing'

interface Props {
  models: UsageModelBucket[]
  previousModels: UsageModelBucket[]
  dailyModels: UsageSummary['dailyModels']
  maxDays: number
  pinnedModelKey?: string | null
  onPinnedModelChange?: (key: string | null) => void
}

export function ModelUsagePanel(props: Props) {
  const totalTokens = createMemo(() =>
    props.models.reduce((sum, model) => sum + model.totalTokens, 0)
  )
  const previousByKey = createMemo(() => {
    const map = new Map<string, UsageModelBucket>()
    for (const model of props.previousModels) {
      map.set(modelKey(model.model, model.provider), model)
    }
    return map
  })
  const featured = createMemo(() => props.models.slice(0, 3))
  const rest = createMemo(() => props.models.slice(3))

  return (
    <div class="usage-panel">
      <div class="usage-panel-subsection">
        <h4 class="usage-subsection-title">Daily stack by model</h4>
        <DailyModelChart
          dailyModels={props.dailyModels ?? []}
          maxDays={props.maxDays ?? 90}
          pinnedModelKey={props.pinnedModelKey}
          onPinnedModelChange={props.onPinnedModelChange}
        />
      </div>
      <header class="usage-panel-head">
        <h3 class="usage-section-title">
          Top models<span class="usage-section-dot">.</span>
        </h3>
        <p class="usage-section-desc">
          Usage of models across your indexed sessions · {formatTokenMetric(totalTokens())} captured
        </p>
      </header>

      <Show
        when={props.models.length > 0}
        fallback={
          <div class="usage-models-placeholder">
            No model usage captured yet. Run a session and assistant turns will show up here.
          </div>
        }
      >
        <div class="usage-featured-grid">
          <For each={featured()}>
            {(model, index) => {
              const previous = previousByKey().get(modelKey(model.model, model.provider))
              const delta = findDeltaPct(model.totalTokens, previous?.totalTokens ?? 0)
              const { cacheSavings } = modelPricingExtras(model)
              const key = modelKey(model.model, model.provider)
              const color = pickModelColor(index(), key)
              const isPinned = props.pinnedModelKey === key
              const isDimmed = props.pinnedModelKey != null && !isPinned
              return (
                <button
                  type="button"
                  class={`usage-featured-card${isPinned ? ' is-pinned' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                  onMouseEnter={() => props.onPinnedModelChange?.(key)}
                  onMouseLeave={() => props.onPinnedModelChange?.(null)}
                >
                  <span class="usage-model-swatch" style={{ background: color }} />
                  <span class="usage-featured-rank">{String(index() + 1).padStart(2, '0')}</span>
                  <span class="usage-featured-name">
                    {formatModelName(model.model) || model.model || 'unknown'}
                  </span>
                  <span class="usage-featured-volume">{formatTokenMetric(model.totalTokens)}</span>
                  <span class="usage-featured-sub">
                    <Show when={formatProviderLabel(model.provider)}>
                      <span>{formatProviderLabel(model.provider)}</span>
                    </Show>
                    <span class={`usage-featured-delta is-${delta.state}`}>
                      {formatDeltaPct(delta)}
                    </span>
                    <Show when={(cacheSavings ?? 0) > 0}>
                      <span>saved {formatCurrency(cacheSavings ?? 0)}</span>
                    </Show>
                  </span>
                </button>
              )
            }}
          </For>
        </div>

        <Show when={rest().length > 0}>
          <div class="usage-rest-grid">
            <For each={rest()}>
              {(model, index) => {
                const previous = previousByKey().get(modelKey(model.model, model.provider))
                const delta = findDeltaPct(model.totalTokens, previous?.totalTokens ?? 0)
                const key = modelKey(model.model, model.provider)
                const color = pickModelColor(index() + 3, key)
                const isPinned = props.pinnedModelKey === key
                const isDimmed = props.pinnedModelKey != null && !isPinned
                return (
                  <button
                    type="button"
                    class={`usage-rest-card${isPinned ? ' is-pinned' : ''}${isDimmed ? ' is-dimmed' : ''}`}
                    onMouseEnter={() => props.onPinnedModelChange?.(key)}
                    onMouseLeave={() => props.onPinnedModelChange?.(null)}
                  >
                    <span class="usage-model-swatch" style={{ background: color }} />
                    <span class="usage-rest-rank">{String(index() + 4).padStart(2, '0')}</span>
                    <span class="usage-rest-name">
                      {formatModelName(model.model) || model.model || 'unknown'}
                    </span>
                    <span class="usage-rest-volume">{formatTokenMetric(model.totalTokens)}</span>
                    <span class={`usage-rest-delta is-${delta.state}`}>
                      {formatDeltaPct(delta)}
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
