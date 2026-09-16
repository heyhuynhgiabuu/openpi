/**
 * UsageCard — the usage dashboard: hero with range tabs, four metric panels,
 * and an activity/models/market-share tab body over locally indexed sessions.
 * Pure helpers live in usageHeatmap/usageFormat/usageAggregates; the metric
 * grid and the activity and provider panels are separate components.
 */

import { createMemo, createResource, createSignal, For, Show } from 'solid-js'
import type { UsageModelBucket } from '../../lib/ipc'
import {
  cacheHitRate,
  formatRelativeGenerated,
  formatRangeSpan,
  workspaceScopeFromPath,
} from './usageFormat'
import { aggregateProviders } from './usageAggregates'
import { rangeLabel, rangeToDays, RANGE_KEYS, type RangeKey } from './usageRange'
import { heatmapWeeksForRange } from './usageHeatmap'
import { sumCacheSavingsForModels } from './usagePricing'
import { downloadUsageCsv, downloadUsageJson } from './usageExport'
import { ModelUsagePanel } from './ModelUsagePanel'
import { UsageActivityPanel } from './UsageActivityPanel'
import { UsageMetricPanels } from './UsageMetricPanels'
import { ProviderUsagePanel } from './ProviderUsagePanel'
import './usage.css'

type Props = {
  workspacePath: string | null
  workspaceLabel?: string
  refreshRevision: string
}

export function UsageCard(props: Props) {
  const [range, setRange] = createSignal<RangeKey>('30d')
  const [activeTab, setActiveTab] = createSignal<'activity' | 'models' | 'providers'>('activity')
  const [pinnedModelKey, setPinnedModelKey] = createSignal<string | null>(null)

  const usageDays = createMemo(() => rangeToDays(range()))

  const [usageSummary] = createResource(
    () => ({
      workspacePath: props.workspacePath ?? undefined,
      revision: props.refreshRevision,
      days: usageDays(),
    }),
    ({ workspacePath, days }) => window.openpi.getUsageSummary({ workspacePath, days })
  )

  const filteredDaily = createMemo(() => usageSummary()?.daily ?? [])
  const filteredModels = createMemo(() => usageSummary()?.models ?? [])
  const dailyModelsByDate = createMemo(() => {
    const map = new Map<string, UsageModelBucket[]>()
    for (const row of usageSummary()?.dailyModels ?? []) {
      const list = map.get(row.date) ?? []
      list.push(row)
      map.set(row.date, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => b.totalTokens - a.totalTokens)
    }
    return map
  })

  const providerBuckets = createMemo(() => aggregateProviders(filteredModels()))

  const rangeTotals = createMemo(() => {
    const days = filteredDaily()
    return days.reduce(
      (acc, d) => {
        acc.totalTokens += d.totalTokens
        acc.inputTokens += d.inputTokens
        acc.cacheReadTokens += d.cacheReadTokens
        acc.turns += d.turnCount
        acc.sessions += d.sessionCount
        acc.cost += d.cost
        return acc
      },
      {
        totalTokens: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        turns: 0,
        sessions: 0,
        cost: 0,
      }
    )
  })

  const rangeCacheHitRate = createMemo(() =>
    cacheHitRate(rangeTotals().inputTokens, rangeTotals().cacheReadTokens)
  )
  const rangeCacheSavingsUsd = createMemo(() => sumCacheSavingsForModels(filteredModels()))

  const providerTrendWeeks = createMemo(() => {
    const r = range()
    if (r === '7d') return 4
    if (r === '30d') return 8
    if (r === '90d') return 14
    return 26
  })

  const rangeDateSpan = createMemo(() => formatRangeSpan(filteredDaily(), range()))

  const rangeSessionCount = createMemo(() => {
    const s = usageSummary()
    if (!s) return 0
    return rangeTotals().sessions
  })

  const scopeLabel = createMemo(
    () => props.workspaceLabel?.trim() || workspaceScopeFromPath(props.workspacePath)
  )

  const needsProviderReindex = createMemo(() => {
    const models = filteredModels()
    if (models.length === 0) return false
    return models.every((m) => !m.provider?.trim())
  })

  const tokensPerSession = createMemo(() => {
    const sessions = rangeSessionCount()
    if (sessions <= 0) return null
    return rangeTotals().totalTokens / sessions
  })

  const exportCurrent = (kind: 'json' | 'csv'): void => {
    const summary = usageSummary()
    if (!summary) return
    if (kind === 'json') downloadUsageJson(summary, scopeLabel())
    else downloadUsageCsv(summary, scopeLabel())
  }

  return (
    <section class="usage-card usage-card--dashboard" aria-label="Usage data">
      <header class="usage-dashboard-hero">
        <div class="usage-dashboard-hero-copy">
          <div class="usage-dashboard-title-row">
            <h2 class="usage-dashboard-title">Usage data</h2>
            <span class="usage-scope-pill" title={props.workspacePath ?? 'All indexed workspaces'}>
              {scopeLabel()}
            </span>
          </div>
          <Show when={needsProviderReindex()}>
            <p class="usage-reindex-hint" role="status">
              Provider labels are missing on older indexes. Open or refresh sessions in this project
              to re-index usage (v3).
            </p>
          </Show>
        </div>
        <fieldset class="usage-range-tabs usage-range-tabs--hero" aria-label="Time range">
          <For each={RANGE_KEYS}>
            {(key) => (
              <button
                type="button"
                class={range() === key ? 'is-active' : ''}
                onClick={() => setRange(key)}
              >
                {rangeLabel(key)}
              </button>
            )}
          </For>
        </fieldset>
      </header>

      <Show
        when={usageSummary()}
        fallback={
          <Show
            when={usageSummary.loading}
            fallback={
              <div class="usage-card-empty">
                {usageSummary.error ? 'Usage unavailable' : 'No usage yet'}
              </div>
            }
          >
            <div class="usage-card-skeleton" aria-hidden="true">
              <div class="usage-metric-grid">
                <For each={[1, 2, 3, 4]}>{() => <div class="usage-metric-panel-skeleton" />}</For>
              </div>
              <div class="usage-skeleton-panel" />
            </div>
          </Show>
        }
      >
        {(summary) => (
          <>
            <UsageMetricPanels
              rangeTotals={rangeTotals}
              rangeSessionCount={rangeSessionCount}
              rangeDateSpan={rangeDateSpan}
              rangeCacheHitRate={rangeCacheHitRate}
              rangeCacheSavingsUsd={rangeCacheSavingsUsd}
              tokensPerSession={tokensPerSession}
            />

            <div class="usage-dashboard-body">
              <div class="usage-activity-header">
                <div class="usage-activity-tabs" role="tablist" aria-label="Usage views">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab() === 'activity'}
                    class={activeTab() === 'activity' ? 'is-active' : ''}
                    onClick={() => setActiveTab('activity')}
                  >
                    Activity
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab() === 'models'}
                    class={activeTab() === 'models' ? 'is-active' : ''}
                    onClick={() => setActiveTab('models')}
                  >
                    Models
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab() === 'providers'}
                    class={activeTab() === 'providers' ? 'is-active' : ''}
                    onClick={() => setActiveTab('providers')}
                  >
                    Market share
                  </button>
                </div>
                <Show when={activeTab() === 'activity'}>
                  <span class="usage-card-static-label">{rangeDateSpan()}</span>
                </Show>
              </div>

              <Show when={activeTab() === 'activity'}>
                <UsageActivityPanel
                  range={range()}
                  days={filteredDaily}
                  dailyModelsByDate={dailyModelsByDate}
                />
              </Show>

              <Show when={activeTab() === 'models'}>
                <ModelUsagePanel
                  models={filteredModels()}
                  previousModels={summary()?.previousRange.models ?? []}
                  dailyModels={usageSummary()?.dailyModels ?? []}
                  maxDays={providerTrendWeeks() * 7}
                  pinnedModelKey={pinnedModelKey()}
                  onPinnedModelChange={setPinnedModelKey}
                />
              </Show>

              <Show when={activeTab() === 'providers'}>
                <ProviderUsagePanel
                  providers={providerBuckets()}
                  dailyModels={usageSummary()?.dailyModels ?? []}
                  maxTrendWeeks={providerTrendWeeks()}
                  allModels={filteredModels()}
                />
              </Show>
            </div>

            <footer class="usage-dashboard-footer">
              <p class="usage-dashboard-meta">
                Indexed from local session JSONL
                <Show when={summary().generatedAt}>
                  {' '}
                  · updated {formatRelativeGenerated(summary().generatedAt)}
                </Show>
              </p>
              <fieldset class="usage-export-actions" aria-label="Export usage">
                <button
                  type="button"
                  class="usage-export-btn"
                  onClick={() => exportCurrent('json')}
                >
                  Export JSON
                </button>
                <button type="button" class="usage-export-btn" onClick={() => exportCurrent('csv')}>
                  Export CSV
                </button>
              </fieldset>
            </footer>
          </>
        )}
      </Show>
    </section>
  )
}
