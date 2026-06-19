import { createMemo, createSignal, For, Show } from 'solid-js'
import type { UsageDayModel } from '../../lib/ipc'
import { buildDailyModelColumns, modelKey, pickModelColor } from './usageModelTrend'

type Props = {
  dailyModels: UsageDayModel[]
  maxDays: number
  pinnedModelKey?: string | null
  onPinnedModelChange?: (key: string | null) => void
}

export function DailyModelChart(props: Props) {
  const [hoveredColIdx, setHoveredColIdx] = createSignal<number | null>(null)
  const [hoveredModel, setHoveredModel] = createSignal<string | null>(null)
  const [mouseX, setMouseX] = createSignal(0)
  const [mouseY, setMouseY] = createSignal(0)
  const [chartWidth, setChartWidth] = createSignal(0)
  const [isTouch, setIsTouch] = createSignal(false)
  if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) {
    setIsTouch(true)
  }

  const columns = createMemo(() =>
    buildDailyModelColumns(props.dailyModels, { maxDays: props.maxDays })
  )

  // Global model index for consistent colors
  const modelIndexMap = createMemo(() => {
    const map = new Map<string, number>()
    let idx = 0
    for (const col of columns()) {
      for (const seg of col.segments) {
        if (!map.has(seg.modelKey)) map.set(seg.modelKey, idx++)
      }
    }
    return map
  })

  const colorFor = (key: string): string => {
    const idx = modelIndexMap().get(key) ?? 0
    return pickModelColor(idx, key)
  }

  // Reactive tooltip data — recomputes whenever hoveredColIdx or columns change
  const tooltipCol = createMemo(() => {
    const idx = hoveredColIdx()
    if (idx == null) return null
    return columns()[idx] ?? null
  })

  const tooltipSegments = createMemo(() => {
    const col = tooltipCol()
    if (!col) return []
    return col.segments.filter((s) => s.tokens > 0)
  })

  const activeModelKey = createMemo(() => hoveredModel() ?? props.pinnedModelKey ?? null)

  // Tooltip tracks the cursor, prefers the right side, and flips left near the edge.
  const tooltipPosition = createMemo(() => {
    const gap = 14
    const width = 210
    const x = mouseX()
    const y = mouseY()
    const maxWidth = chartWidth()
    const fitsRight = maxWidth <= 0 || x + gap + width <= maxWidth
    return {
      left: fitsRight ? x + gap : Math.max(8, x - gap - width),
      top: Math.max(8, y - 12),
    }
  })

  // Hover line position
  const hoverlinePct = createMemo(() => {
    const idx = hoveredColIdx()
    if (idx == null) return 50
    const cols = columns()
    return cols.length > 0 ? ((idx + 0.5) / cols.length) * 100 : 50
  })

  const handleBarMouseMove = (index: number, e: MouseEvent) => {
    if (isTouch()) return
    const chartRect = (e.currentTarget as HTMLElement)
      .closest('.usage-daily-chart')
      ?.getBoundingClientRect()
    if (chartRect) {
      setChartWidth(chartRect.width)
      setMouseX(e.clientX - chartRect.left)
      setMouseY(e.clientY - chartRect.top)
    }
    setHoveredColIdx(index)

    const stackRect = (e.currentTarget as HTMLElement)
      .querySelector('.usage-daily-chart-stack')
      ?.getBoundingClientRect()
    const col = columns()[index]
    if (!stackRect || !col) return

    const yFromBottom = Math.max(0, Math.min(stackRect.height, stackRect.bottom - e.clientY))
    const shareAtCursor = stackRect.height > 0 ? yFromBottom / stackRect.height : 0
    let cumulative = 0
    let nextModel: string | null = null
    for (const seg of col.segments) {
      if (seg.share <= 0) continue
      cumulative += Math.max(seg.share, 0.015)
      if (shareAtCursor <= cumulative) {
        nextModel = seg.modelKey
        break
      }
    }
    setHoveredModel(nextModel)
    props.onPinnedModelChange?.(nextModel)
  }

  const handleSegmentEnter = (mk: string) => {
    if (isTouch()) return
    setHoveredModel(mk)
    props.onPinnedModelChange?.(mk)
  }

  const handleLeave = () => {
    setHoveredColIdx(null)
    setHoveredModel(null)
    props.onPinnedModelChange?.(null)
  }

  return (
    <Show
      when={columns().length > 0}
      fallback={
        <p class="usage-chart-empty">
          Not enough daily model history in this range for a stacked chart.
        </p>
      }
    >
      <div
        class="usage-daily-chart"
        role="none"
        onMouseLeave={handleLeave}
        onClick={() => {
          setHoveredColIdx(null)
          setHoveredModel(null)
          props.onPinnedModelChange?.(null)
        }}
      >
        {/* Hover indicator line */}
        <Show when={hoveredColIdx() != null}>
          <div class="usage-daily-chart-hoverline" style={{ left: `${hoverlinePct()}%` }} />
        </Show>

        {/* Tooltip — follows mouse X, always reactive */}
        <Show when={tooltipCol()}>
          <div
            class="usage-daily-chart-tooltip"
            role="status"
            style={{
              left: `${tooltipPosition().left}px`,
              top: `${tooltipPosition().top}px`,
            }}
          >
            <div class="usage-daily-chart-tooltip-header">
              <div class="usage-daily-chart-tooltip-date">{tooltipCol()!.label.toUpperCase()}</div>
              <div class="usage-daily-chart-tooltip-total">
                {formatCompact(tooltipCol()!.totalTokens)} total
              </div>
            </div>
            <ol class="usage-daily-chart-tooltip-list">
              <For each={tooltipSegments()}>
                {(seg) => (
                  <li class={activeModelKey() === seg.modelKey ? 'is-active' : ''}>
                    <span
                      class="usage-daily-chart-tooltip-dot"
                      style={{ background: colorFor(seg.modelKey) }}
                    />
                    <span class="usage-daily-chart-tooltip-name">{seg.label}</span>
                    <span class="usage-daily-chart-tooltip-val">{formatCompact(seg.tokens)}</span>
                  </li>
                )}
              </For>
            </ol>
          </div>
        </Show>

        {/* Bars */}
        <div
          class="usage-daily-chart-bars"
          role="img"
          aria-label="Daily token usage stacked by model"
        >
          <For each={columns()}>
            {(col, i) => (
              <div
                class={`usage-daily-chart-col${hoveredColIdx() === i() ? ' is-hovered' : ''}`}
                role="button"
                tabIndex={-1}
                onKeyDown={() => {}}
                onMouseMove={(e) => handleBarMouseMove(i(), e)}
                onMouseLeave={() => setHoveredModel(null)}
                onClick={(e) => e.stopPropagation()}
              >
                <div class="usage-daily-chart-stack">
                  <For each={col.segments}>
                    {(seg) => (
                      <div
                        class={`usage-daily-chart-seg${
                          activeModelKey() && activeModelKey() !== seg.modelKey ? ' is-dimmed' : ''
                        }${activeModelKey() === seg.modelKey ? ' is-pinned' : ''}`}
                        role="button"
                        tabIndex={-1}
                        onKeyDown={() => {}}
                        style={{
                          height: `${Math.max(seg.share * 100, seg.share > 0 ? 1.5 : 0)}%`,
                          background:
                            activeModelKey() && activeModelKey() !== seg.modelKey
                              ? 'var(--surface-card)'
                              : colorFor(seg.modelKey),
                        }}
                        onMouseEnter={() => handleSegmentEnter(seg.modelKey)}
                      />
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>

        {/* X-axis */}
        <div class="usage-daily-chart-axis">
          <For each={columns()}>
            {(col, i) => (
              <span class="usage-daily-chart-x">
                {shouldShowLabel(i(), columns().length) ? col.label : ''}
              </span>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

function shouldShowLabel(index: number, total: number): boolean {
  if (total <= 12) return true
  if (total <= 30) return index % 3 === 0 || index === total - 1
  if (total <= 60) return index % 7 === 0 || index === total - 1
  return index % 14 === 0 || index === total - 1
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

export { modelKey }
