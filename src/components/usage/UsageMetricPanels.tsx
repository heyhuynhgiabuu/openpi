/**
 * The four hero metric panels of the usage dashboard: activity, cache ratio,
 * spend, and per-session load. All inputs arrive as accessors from the card.
 */

import { For, Show } from 'solid-js'
import { formatCacheHitRate, formatCostPerSession, formatRangeSpan } from './usageFormat'
import { formatCurrency } from '../../lib/sessionView'
import { formatTokenMetric } from './usageFormat'

export interface UsageRangeTotals {
  totalTokens: number
  inputTokens: number
  cacheReadTokens: number
  turns: number
  sessions: number
  cost: number
}

export function UsageMetricPanels(props: {
  rangeTotals: () => UsageRangeTotals
  rangeSessionCount: () => number
  rangeDateSpan: () => string
  rangeCacheHitRate: () => number | null
  rangeCacheSavingsUsd: () => number | null
  tokensPerSession: () => number | null
}) {
  return (
    <div class="usage-metric-grid">
      <article class="usage-metric-panel">
        <header class="usage-metric-panel-head">
          <h3 class="usage-section-title">
            Activity<span class="usage-section-dot">.</span>
          </h3>
          <p class="usage-section-desc">Captured tokens in this range.</p>
        </header>
        <p class="usage-metric-hero">{formatTokenMetric(props.rangeTotals().totalTokens)}</p>
        <dl class="usage-metric-kv">
          <div>
            <dt>Turns</dt>
            <dd>{props.rangeTotals().turns.toLocaleString()}</dd>
          </div>
          <div>
            <dt>Sessions</dt>
            <dd>{props.rangeSessionCount().toLocaleString()}</dd>
          </div>
        </dl>
        <p class="usage-metric-foot">{props.rangeDateSpan()}</p>
      </article>

      <article class="usage-metric-panel">
        <header class="usage-metric-panel-head">
          <h3 class="usage-section-title">
            Cache ratio<span class="usage-section-dot">.</span>
          </h3>
          <p class="usage-section-desc">Share of billed input served from cache.</p>
        </header>
        <p class="usage-metric-hero">
          {props.rangeCacheHitRate() != null ? formatCacheHitRate(props.rangeCacheHitRate()) : '—'}
        </p>
        <dl class="usage-metric-kv">
          <div>
            <dt>Cached</dt>
            <dd>{formatTokenMetric(props.rangeTotals().cacheReadTokens)}</dd>
          </div>
          <div>
            <dt>Uncached input</dt>
            <dd>{formatTokenMetric(props.rangeTotals().inputTokens)}</dd>
          </div>
        </dl>
        <p class="usage-metric-foot usage-pricing-foot">
          <Show
            when={props.rangeCacheSavingsUsd() != null && props.rangeCacheSavingsUsd()! > 0}
            fallback="Savings use pi-ai catalog rates when recognized."
          >
            Est. saved {formatCurrency(props.rangeCacheSavingsUsd()!)} from cache.
          </Show>
        </p>
      </article>

      <article class="usage-metric-panel">
        <header class="usage-metric-panel-head">
          <h3 class="usage-section-title">
            Spend<span class="usage-section-dot">.</span>
          </h3>
          <p class="usage-section-desc">Reported session cost when providers expose it.</p>
        </header>
        <p class="usage-metric-hero">
          {props.rangeTotals().cost > 0 ? formatCurrency(props.rangeTotals().cost) : '—'}
        </p>
        <dl class="usage-metric-kv">
          <div>
            <dt>Cost / session</dt>
            <dd>{formatCostPerSession(props.rangeTotals().cost, props.rangeSessionCount())}</dd>
          </div>
        </dl>
      </article>

      <article class="usage-metric-panel">
        <header class="usage-metric-panel-head">
          <h3 class="usage-section-title">
            Per session<span class="usage-section-dot">.</span>
          </h3>
          <p class="usage-section-desc">Average load per session in this range.</p>
        </header>
        <p class="usage-metric-hero">
          {props.tokensPerSession() != null ? formatTokenMetric(props.tokensPerSession()!) : '—'}
        </p>
        <dl class="usage-metric-kv">
          <div>
            <dt>Turns / session</dt>
            <dd>
              {props.rangeSessionCount() > 0
                ? (props.rangeTotals().turns / props.rangeSessionCount()).toFixed(1)
                : '—'}
            </dd>
          </div>
        </dl>
      </article>
    </div>
  )
}
