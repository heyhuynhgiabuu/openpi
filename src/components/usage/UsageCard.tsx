import { createMemo, createResource, createSignal, For, onMount, Show } from 'solid-js'
import type { UsageDay, UsageModelBucket, UsageSummary } from '../../lib/ipc'
import { formatCurrency, formatModelName } from '../../lib/sessionView'
import { DailyModelChart } from './DailyModelChart'
import { ProviderShareChart } from './ProviderShareChart'
import { downloadUsageCsv, downloadUsageJson } from './usageExport'
import { findDeltaPct, formatDeltaPct, modelKey, pickModelColor } from './usageModelTrend'
import {
  modelPricingExtras,
  sumCacheSavingsForModels,
  warmUsagePricingCatalog,
} from './usagePricing'
import { providerChartColor } from './usageProviderTrend'

const HEATMAP_WEEKS = 53
const DAYS_PER_WEEK = 7
const DAY_MS = 86_400_000
const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const RANGE_KEYS = ['7d', '30d', '90d', 'all'] as const

type Props = {
  workspacePath: string | null
  workspaceLabel?: string
  refreshRevision: string
}

type RangeKey = (typeof RANGE_KEYS)[number]

type HeatmapCell = {
  date: string
  tokens: number
  level: number
  future: boolean
}

export function UsageCard(props: Props) {
  onMount(() => {
    warmUsagePricingCatalog()
  })

  const [range, setRange] = createSignal<RangeKey>('30d')
  const [hoveredHeatmapDay, setHoveredHeatmapDay] = createSignal<HeatmapCell | null>(null)
  const [activityPreviewPosition, setActivityPreviewPosition] = createSignal({
    left: 0,
    top: 0,
  })
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

  const heatmapWeekCount = createMemo(() => heatmapWeeksForRange(range()))
  const heatmapWeeks = createMemo(() => buildHeatmapWeeks(filteredDaily(), heatmapWeekCount()))
  const monthLabels = createMemo(() => buildMonthLabels(heatmapWeeks()))

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

  const heatmapPreview = createMemo(() => {
    const cell = hoveredHeatmapDay()
    if (!cell) return null
    const day = filteredDaily().find((d) => d.date === cell.date)
    return {
      date: cell.date,
      future: cell.future,
      totalTokens: day?.totalTokens ?? cell.tokens,
      turnCount: day?.turnCount ?? 0,
      cost: day?.cost ?? 0,
      cacheHitRate: day?.cacheHitRate ?? null,
      models: dailyModelsByDate().get(cell.date) ?? [],
    }
  })

  const updateHeatmapPreview = (day: HeatmapCell, event: PointerEvent) => {
    const gap = 14
    const width = 270
    const estimatedHeight = 250
    const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
    const fitsRight = event.clientX + gap + width <= viewportWidth - 8
    const maxTop = Math.max(8, viewportHeight - estimatedHeight - 8)
    setActivityPreviewPosition({
      left: fitsRight ? event.clientX + gap : Math.max(8, event.clientX - gap - width),
      top: Math.max(8, Math.min(event.clientY - 12, maxTop)),
    })
    setHoveredHeatmapDay(day)
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
        <div class="usage-range-tabs usage-range-tabs--hero" role="group" aria-label="Time range">
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
        </div>
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
            <div class="usage-metric-grid">
              <article class="usage-metric-panel">
                <header class="usage-metric-panel-head">
                  <h3 class="usage-section-title">
                    Activity<span class="usage-section-dot">.</span>
                  </h3>
                  <p class="usage-section-desc">Captured tokens in this range.</p>
                </header>
                <p class="usage-metric-hero">{formatTokenMetric(rangeTotals().totalTokens)}</p>
                <dl class="usage-metric-kv">
                  <div>
                    <dt>Turns</dt>
                    <dd>{rangeTotals().turns.toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Sessions</dt>
                    <dd>{rangeSessionCount().toLocaleString()}</dd>
                  </div>
                </dl>
                <p class="usage-metric-foot">{rangeDateSpan()}</p>
              </article>

              <article class="usage-metric-panel">
                <header class="usage-metric-panel-head">
                  <h3 class="usage-section-title">
                    Cache ratio<span class="usage-section-dot">.</span>
                  </h3>
                  <p class="usage-section-desc">Share of billed input served from cache.</p>
                </header>
                <p class="usage-metric-hero">
                  {rangeCacheHitRate() != null ? formatCacheHitRate(rangeCacheHitRate()) : '—'}
                </p>
                <dl class="usage-metric-kv">
                  <div>
                    <dt>Cached</dt>
                    <dd>{formatTokenMetric(rangeTotals().cacheReadTokens)}</dd>
                  </div>
                  <div>
                    <dt>Uncached input</dt>
                    <dd>{formatTokenMetric(rangeTotals().inputTokens)}</dd>
                  </div>
                </dl>
                <p class="usage-metric-foot usage-pricing-foot">
                  <Show
                    when={rangeCacheSavingsUsd() != null && rangeCacheSavingsUsd()! > 0}
                    fallback="Savings use pi-ai catalog rates when recognized."
                  >
                    Est. saved {formatCurrency(rangeCacheSavingsUsd()!)} from cache.
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
                  {rangeTotals().cost > 0 ? formatCurrency(rangeTotals().cost) : '—'}
                </p>
                <dl class="usage-metric-kv">
                  <div>
                    <dt>Cost / session</dt>
                    <dd>{formatCostPerSession(rangeTotals().cost, rangeSessionCount())}</dd>
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
                  {tokensPerSession() != null ? formatTokenMetric(tokensPerSession()!) : '—'}
                </p>
                <dl class="usage-metric-kv">
                  <div>
                    <dt>Turns / session</dt>
                    <dd>
                      {rangeSessionCount() > 0
                        ? (rangeTotals().turns / rangeSessionCount()).toFixed(1)
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </article>
            </div>

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
                <div class="usage-panel">
                  <header class="usage-panel-head">
                    <h3 class="usage-section-title">
                      Heatmap<span class="usage-section-dot">.</span>
                    </h3>
                    <p class="usage-section-desc">Each square is one day of captured usage.</p>
                  </header>
                  <div
                    class="usage-activity-content"
                    onPointerLeave={() => setHoveredHeatmapDay(null)}
                  >
                    <div
                      class="usage-heatmap-wrap"
                      style={{
                        '--usage-heatmap-weeks': String(heatmapWeekCount()),
                      }}
                    >
                      <div class="usage-heatmap-months">
                        <For each={monthLabels()}>{(label) => <span>{label}</span>}</For>
                      </div>
                      <div class="usage-heatmap" role="img" aria-label="Daily token usage heatmap">
                        <For each={heatmapWeeks()}>
                          {(week) => (
                            <div class="usage-heatmap-week">
                              <For each={week}>
                                {(day) => (
                                  <button
                                    type="button"
                                    class={`usage-heatmap-dot level-${day.level}${day.future ? ' is-future' : ''}${hoveredHeatmapDay()?.date === day.date ? ' is-selected' : ''}`}
                                    title={heatmapTooltip(
                                      day,
                                      dailyModelsByDate().get(day.date) ?? []
                                    )}
                                    aria-label={heatmapAriaLabel(day)}
                                    onPointerEnter={(event) => updateHeatmapPreview(day, event)}
                                    onPointerMove={(event) => updateHeatmapPreview(day, event)}
                                    onFocus={() => setHoveredHeatmapDay(day)}
                                    onBlur={() => setHoveredHeatmapDay(null)}
                                  />
                                )}
                              </For>
                            </div>
                          )}
                        </For>
                      </div>
                    </div>
                    <Show when={heatmapPreview()}>
                      {(preview) => (
                        <aside
                          class="usage-day-drawer"
                          aria-label={`Usage on ${preview().date}`}
                          style={{
                            left: `${activityPreviewPosition().left}px`,
                            top: `${activityPreviewPosition().top}px`,
                          }}
                        >
                          <div class="usage-day-detail-header">
                            <span class="usage-day-detail-date">
                              {formatDisplayDate(preview().date)}
                            </span>
                          </div>
                          <div class="usage-day-detail-stats">
                            <div>
                              <strong>{formatTokenMetric(preview().totalTokens)}</strong>
                              <span>tokens</span>
                            </div>
                            <div>
                              <strong>{preview().turnCount.toLocaleString()}</strong>
                              <span>turns</span>
                            </div>
                            <div>
                              <strong>
                                {preview().cost > 0 ? formatCurrency(preview().cost) : '—'}
                              </strong>
                              <span>cost</span>
                            </div>
                            <Show when={preview().cacheHitRate != null}>
                              <div>
                                <strong>{formatCacheHitRate(preview().cacheHitRate)}</strong>
                                <span>cache</span>
                              </div>
                            </Show>
                          </div>
                          <div class="usage-day-models">
                            <span class="usage-day-models-title">Top models</span>
                            <Show
                              when={preview().models.length > 0}
                              fallback={
                                <p class="usage-day-empty">
                                  {preview().future
                                    ? 'No usage yet.'
                                    : 'No model breakdown captured for this day.'}
                                </p>
                              }
                            >
                              <ol class="usage-day-model-list">
                                <For each={preview().models.slice(0, 5)}>
                                  {(model, index) => (
                                    <li>
                                      <span>{String(index() + 1).padStart(2, '0')}</span>
                                      <strong>{formatModelName(model.model) || model.model}</strong>
                                      <em>{formatTokenMetric(model.totalTokens)}</em>
                                    </li>
                                  )}
                                </For>
                              </ol>
                            </Show>
                          </div>
                        </aside>
                      )}
                    </Show>
                  </div>
                </div>
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
              <div class="usage-export-actions" role="group" aria-label="Export usage">
                <button
                  type="button"
                  class="usage-export-btn"
                  onClick={() => exportCurrent(summary(), scopeLabel(), 'json')}
                >
                  Export JSON
                </button>
                <button
                  type="button"
                  class="usage-export-btn"
                  onClick={() => exportCurrent(summary(), scopeLabel(), 'csv')}
                >
                  Export CSV
                </button>
              </div>
            </footer>
          </>
        )}
      </Show>
    </section>
  )
}

function ModelUsagePanel(props: {
  models: UsageModelBucket[]
  previousModels: UsageModelBucket[]
  dailyModels: UsageSummary['dailyModels']
  maxDays: number
  pinnedModelKey?: string | null
  onPinnedModelChange?: (key: string | null) => void
}) {
  const totalTokens = createMemo(() =>
    props.models.reduce((sum, model) => sum + model.totalTokens, 0)
  )

  const previousByKey = createMemo(() => {
    const map = new Map<string, UsageModelBucket>()
    for (const m of props.previousModels) {
      map.set(modelKey(m.model, m.provider), m)
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
              const prev = previousByKey().get(modelKey(model.model, model.provider))
              const delta = findDeltaPct(model.totalTokens, prev?.totalTokens ?? 0)
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
                const prev = previousByKey().get(modelKey(model.model, model.provider))
                const delta = findDeltaPct(model.totalTokens, prev?.totalTokens ?? 0)
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

function _LeaderboardRow(props: {
  rank: number
  model: UsageModelBucket
  sharePct: number
  showBar?: boolean
  hideVendor?: boolean
  cacheSavingsUsd?: number | null
}) {
  const label = () => formatModelName(props.model.model) || props.model.model || 'unknown'
  const vendor = () => formatProviderLabel(props.model.provider)

  return (
    <li class="usage-leaderboard-row">
      <span class="usage-leaderboard-rank">{String(props.rank).padStart(2, '0')}</span>
      <div class="usage-leaderboard-main">
        <div class="usage-leaderboard-top">
          <span class="usage-leaderboard-name" title={props.model.model}>
            {label()}
          </span>
          <span class="usage-leaderboard-volume">{formatTokenMetric(props.model.totalTokens)}</span>
        </div>
        <div class="usage-leaderboard-sub">
          <Show when={!props.hideVendor && vendor()}>
            <span>{vendor()}</span>
          </Show>
          <span class="usage-leaderboard-share">{formatSharePct(props.sharePct)}</span>
          <Show when={props.model.cacheHitRate != null}>
            <span>{formatCacheHitRate(props.model.cacheHitRate)} cache</span>
          </Show>
          <Show when={props.model.cost > 0}>
            <span>{formatCurrency(props.model.cost)}</span>
          </Show>
          <Show when={(props.cacheSavingsUsd ?? 0) > 0}>
            <span>saved {formatCurrency(props.cacheSavingsUsd ?? 0)}</span>
          </Show>
        </div>
        <Show when={props.showBar}>
          <div class="usage-model-bar" aria-hidden="true">
            <span
              class="usage-model-bar-fill"
              style={{ width: `${Math.max(props.sharePct, 2)}%` }}
            />
          </div>
        </Show>
      </div>
    </li>
  )
}

type ProviderBucket = UsageModelBucket & { model: string }

function aggregateProviders(models: UsageModelBucket[]): ProviderBucket[] {
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

function providerGroupKey(provider: string | undefined): string {
  const p = provider?.trim().toLowerCase()
  return p || '__unknown__'
}

function ProviderUsagePanel(props: {
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

function heatmapWeeksForRange(range: RangeKey): number {
  if (range === '7d') return 2
  if (range === '30d') return 6
  if (range === '90d') return 14
  return HEATMAP_WEEKS
}

function buildHeatmapWeeks(days: UsageDay[], weekCount = HEATMAP_WEEKS): HeatmapCell[][] {
  const byDate = new Map(days.map((day) => [day.date, day.totalTokens]))
  const today = startOfUtcDay(new Date())
  const weeksToShow = Math.min(HEATMAP_WEEKS, Math.max(2, weekCount))
  const start = addDays(today, -((weeksToShow - 1) * DAYS_PER_WEEK + today.getUTCDay()))

  const weeks = Array.from({ length: weeksToShow }, (_, weekIndex) =>
    Array.from({ length: DAYS_PER_WEEK }, (_, dayIndex): HeatmapCell => {
      const date = addDays(start, weekIndex * DAYS_PER_WEEK + dayIndex)
      const dateId = dateKey(date)
      const future = date.getTime() > today.getTime()
      return {
        date: dateId,
        tokens: future ? 0 : (byDate.get(dateId) ?? 0),
        level: 0,
        future,
      }
    })
  )

  const maxTokens = Math.max(0, ...weeks.flat().map((day) => day.tokens))
  for (const day of weeks.flat()) {
    day.level = usageLevel(day.tokens, maxTokens)
  }

  return weeks
}

function buildMonthLabels(weeks: HeatmapCell[][]): string[] {
  const labels: string[] = []
  let previousMonth = -1
  for (const week of weeks) {
    const firstDay = week[0]
    if (!firstDay) continue
    const month = Number(firstDay.date.slice(5, 7)) - 1
    if (month === previousMonth) {
      labels.push('')
      continue
    }
    labels.push(MONTH_LABELS[month] ?? '')
    previousMonth = month
  }
  return labels
}

function usageLevel(tokens: number, maxTokens: number): number {
  if (tokens <= 0 || maxTokens <= 0) return 0
  const ratio = tokens / maxTokens
  if (ratio >= 0.75) return 4
  if (ratio >= 0.4) return 3
  if (ratio >= 0.15) return 2
  return 1
}

function rangeLabel(key: RangeKey): string {
  if (key === '7d') return '1W'
  if (key === '30d') return '1M'
  if (key === '90d') return '3M'
  return 'All'
}

function rangeToDays(key: RangeKey): number {
  if (key === '7d') return 7
  if (key === '30d') return 30
  if (key === '90d') return 90
  return 365
}

function _dayModelSharePct(model: UsageModelBucket, models: UsageModelBucket[]): number {
  const total = models.reduce((sum, m) => sum + m.totalTokens, 0)
  if (total <= 0) return 0
  return (model.totalTokens / total) * 100
}

function formatSharePct(pct: number): string {
  const clamped = Math.min(100, Math.max(0, pct))
  return `${clamped.toFixed(clamped >= 10 ? 0 : 1)}%`
}

function cacheHitRate(inputTokens: number, cacheReadTokens: number): number | null {
  const billed = inputTokens + cacheReadTokens
  if (billed <= 0) return null
  return cacheReadTokens / billed
}

function formatCacheHitRate(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—'
  return `${Math.round(rate * 100)}%`
}

function formatTokenMetric(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return tokens.toLocaleString()
}

function formatCostPerSession(cost: number, sessions: number): string {
  if (cost <= 0 || sessions <= 0) return '—'
  return formatCurrency(cost / sessions)
}

function formatRangeSpan(days: UsageDay[], range: RangeKey): string {
  if (days.length === 0) return `${rangeLabel(range)} · no activity`
  const sorted = [...days].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0]?.date
  const last = sorted[sorted.length - 1]?.date
  if (!first || !last) return ''
  return `${formatDisplayDate(first)} → ${formatDisplayDate(last)}`
}

function formatDisplayDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  const month = MONTH_LABELS[m - 1] ?? String(m)
  return `${month} ${d}, ${y}`
}

function formatRelativeGenerated(iso: string): string {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return ''
  const sec = Math.floor((Date.now() - then) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86_400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86_400)}d ago`
}

function formatProviderLabel(provider: string | undefined): string {
  if (!provider) return ''
  const map: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    deepseek: 'DeepSeek',
    minimax: 'MiniMax',
    moonshot: 'Moonshot',
    zhipu: 'Zhipu',
    qwen: 'Qwen',
    xai: 'xAI',
  }
  const key = provider.toLowerCase()
  return map[key] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}

function workspaceScopeFromPath(path: string | null): string {
  if (!path?.trim()) return 'All projects'
  const parts = path.replace(/\/$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || path
}

function exportCurrent(summary: UsageSummary, label: string, kind: 'json' | 'csv'): void {
  if (kind === 'json') downloadUsageJson(summary, label)
  else downloadUsageCsv(summary, label)
}

function heatmapTooltip(day: HeatmapCell, models: UsageModelBucket[]): string {
  if (day.future) return day.date
  const top = models[0]
  const topModel = top ? formatModelName(top.model) || top.model : ''
  const extra = topModel ? ` · ${topModel}` : ''
  return `${day.date}: ${day.tokens.toLocaleString()} tokens${extra}`
}

function heatmapAriaLabel(day: HeatmapCell): string {
  if (day.future) return `${day.date}, no data`
  return `${day.date}, ${day.tokens.toLocaleString()} tokens`
}

function dateKey(date: Date): string {
  return startOfUtcDay(date).toISOString().slice(0, 10)
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function addDays(date: Date, days: number): Date {
  return new Date(startOfUtcDay(date).getTime() + days * DAY_MS)
}
