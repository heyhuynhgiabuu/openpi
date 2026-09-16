/**
 * Activity tab: the daily usage heatmap grid with a floating per-day drawer.
 * Owns the hover/focus preview state; day data and per-day model breakdowns
 * arrive as accessors from the parent card.
 */

import { createMemo, createSignal, For, Show } from 'solid-js'
import type { UsageDay, UsageModelBucket } from '../../lib/ipc'
import { formatCurrency, formatModelName } from '../../lib/sessionView'
import {
  buildHeatmapWeeks,
  buildMonthLabels,
  heatmapAriaLabel,
  heatmapTooltip,
  heatmapWeeksForRange,
  type HeatmapCell,
} from './usageHeatmap'
import {
  formatCacheHitRate,
  formatDisplayDate,
  formatTokenMetric,
  MONTH_LABELS,
} from './usageFormat'
import type { RangeKey } from './usageRange'

const PREVIEW_GAP = 14
const PREVIEW_WIDTH = 270
const PREVIEW_ESTIMATED_HEIGHT = 250

export function UsageActivityPanel(props: {
  range: RangeKey
  days: () => UsageDay[]
  dailyModelsByDate: () => Map<string, UsageModelBucket[]>
}) {
  const [hoveredHeatmapDay, setHoveredHeatmapDay] = createSignal<HeatmapCell | null>(null)
  const [activityPreviewPosition, setActivityPreviewPosition] = createSignal({
    left: 0,
    top: 0,
  })

  const heatmapWeekCount = createMemo(() => heatmapWeeksForRange(props.range))
  const heatmapWeeks = createMemo(() => buildHeatmapWeeks(props.days(), heatmapWeekCount()))
  const monthLabels = createMemo(() => buildMonthLabels(heatmapWeeks(), MONTH_LABELS))

  const heatmapPreview = createMemo(() => {
    const cell = hoveredHeatmapDay()
    if (!cell) return null
    const day = props.days().find((d) => d.date === cell.date)
    return {
      date: cell.date,
      future: cell.future,
      totalTokens: day?.totalTokens ?? cell.tokens,
      turnCount: day?.turnCount ?? 0,
      cost: day?.cost ?? 0,
      cacheHitRate: day?.cacheHitRate ?? null,
      models: props.dailyModelsByDate().get(cell.date) ?? [],
    }
  })

  const updateHeatmapPreview = (day: HeatmapCell, event: PointerEvent) => {
    const viewportWidth = typeof window === 'undefined' ? 1200 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 800 : window.innerHeight
    const fitsRight = event.clientX + PREVIEW_GAP + PREVIEW_WIDTH <= viewportWidth - 8
    const maxTop = Math.max(8, viewportHeight - PREVIEW_ESTIMATED_HEIGHT - 8)
    setActivityPreviewPosition({
      left: fitsRight
        ? event.clientX + PREVIEW_GAP
        : Math.max(8, event.clientX - PREVIEW_GAP - PREVIEW_WIDTH),
      top: Math.max(8, Math.min(event.clientY - 12, maxTop)),
    })
    setHoveredHeatmapDay(day)
  }

  return (
    <div class="usage-panel">
      <header class="usage-panel-head">
        <h3 class="usage-section-title">
          Heatmap<span class="usage-section-dot">.</span>
        </h3>
        <p class="usage-section-desc">Each square is one day of captured usage.</p>
      </header>
      <div class="usage-activity-content" onPointerLeave={() => setHoveredHeatmapDay(null)}>
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
                        title={heatmapTooltip(day, props.dailyModelsByDate().get(day.date) ?? [])}
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
                <span class="usage-day-detail-date">{formatDisplayDate(preview().date)}</span>
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
                  <strong>{preview().cost > 0 ? formatCurrency(preview().cost) : '—'}</strong>
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
  )
}
