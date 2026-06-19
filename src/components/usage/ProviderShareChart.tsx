import { createMemo, createSignal, For, Show } from 'solid-js'
import type { UsageDayModel } from '../../lib/ipc'
import {
  buildProviderWeekColumns,
  providerChartColor,
  providerLabelFromKey,
} from './usageProviderTrend'

type Props = {
  dailyModels: UsageDayModel[]
  maxWeeks: number
  activeProviderKey?: string | null
  onActiveProviderChange?: (key: string | null) => void
}

export function ProviderShareChart(props: Props) {
  const [hoveredColIdx, setHoveredColIdx] = createSignal<number | null>(null)
  const [localProviderKey, setLocalProviderKey] = createSignal<string | null>(null)
  const [mouseX, setMouseX] = createSignal(0)
  const [mouseY, setMouseY] = createSignal(0)
  const [chartWidth, setChartWidth] = createSignal(0)
  const isTouch = () =>
    typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  const columns = createMemo(() => buildProviderWeekColumns(props.dailyModels, props.maxWeeks))

  const providerIndex = createMemo(() => {
    const map = new Map<string, number>()
    for (const col of columns()) {
      for (const seg of col.segments) {
        if (!map.has(seg.providerKey)) map.set(seg.providerKey, map.size)
      }
    }
    return map
  })

  const activeProvider = createMemo(() => localProviderKey() ?? props.activeProviderKey ?? null)
  const tooltipCol = createMemo(() => {
    const idx = hoveredColIdx()
    if (idx == null) return null
    return columns()[idx] ?? null
  })
  const tooltipSegments = createMemo(
    () => tooltipCol()?.segments.filter((seg) => seg.tokens > 0) ?? []
  )
  const hoverlinePct = createMemo(() => {
    const idx = hoveredColIdx()
    const cols = columns()
    return idx == null || cols.length === 0 ? 50 : ((idx + 0.5) / cols.length) * 100
  })
  const tooltipPosition = createMemo(() => {
    const gap = 14
    const width = 210
    const x = mouseX()
    const y = mouseY()
    const fitsRight = chartWidth() <= 0 || x + gap + width <= chartWidth()
    return {
      left: fitsRight ? x + gap : Math.max(8, x - gap - width),
      top: Math.max(8, y - 12),
    }
  })

  const colorFor = (providerKey: string): string =>
    providerChartColor(providerKey, providerIndex().get(providerKey) ?? 0)

  const handlePointerMove = (index: number, event: PointerEvent) => {
    if (event.pointerType === 'touch' || isTouch()) return
    const root = (event.currentTarget as HTMLElement)
      .closest('.usage-provider-chart')
      ?.getBoundingClientRect()
    if (root) {
      setChartWidth(root.width)
      setMouseX(event.clientX - root.left)
      setMouseY(event.clientY - root.top)
    }
    setHoveredColIdx(index)
  }

  const setActiveProvider = (providerKey: string | null) => {
    setLocalProviderKey(providerKey)
    props.onActiveProviderChange?.(providerKey)
  }

  const clearHover = () => {
    setHoveredColIdx(null)
    setLocalProviderKey(null)
    props.onActiveProviderChange?.(null)
  }

  return (
    <Show
      when={columns().length > 0}
      fallback={
        <p class="usage-chart-empty">
          Not enough provider history in this range for a trend chart.
        </p>
      }
    >
      <div class="usage-provider-chart" onPointerLeave={clearHover}>
        <Show when={hoveredColIdx() != null}>
          <div class="usage-provider-chart-hoverline" style={{ left: `${hoverlinePct()}%` }} />
        </Show>

        <Show when={tooltipCol()}>
          <div
            class="usage-provider-tooltip usage-provider-tooltip--floating"
            role="status"
            style={{ left: `${tooltipPosition().left}px`, top: `${tooltipPosition().top}px` }}
          >
            <div class="usage-provider-tooltip-week">{tooltipCol()!.label.toUpperCase()}</div>
            <div class="usage-provider-tooltip-total">
              {formatCompact(tooltipCol()!.totalTokens)} total
            </div>
            <ol class="usage-provider-tooltip-list">
              <For each={tooltipSegments()}>
                {(seg) => (
                  <li class={activeProvider() === seg.providerKey ? 'is-active' : ''}>
                    <span
                      class="usage-provider-tooltip-dot"
                      style={{ background: colorFor(seg.providerKey) }}
                    />
                    <span class="usage-provider-tooltip-name">{seg.label}</span>
                    <span class="usage-provider-tooltip-value">{formatCompact(seg.tokens)}</span>
                  </li>
                )}
              </For>
            </ol>
          </div>
        </Show>

        <div
          class="usage-provider-chart-bars"
          role="img"
          aria-label="Weekly token share by provider"
        >
          <For each={columns()}>
            {(col, index) => (
              <div
                class={`usage-provider-chart-col${hoveredColIdx() === index() ? ' is-hovered' : ''}`}
                onPointerMove={(event) => handlePointerMove(index(), event)}
              >
                <div class="usage-provider-chart-stack">
                  <For each={col.segments}>
                    {(seg) => (
                      <div
                        class={`usage-provider-chart-seg${
                          activeProvider() && activeProvider() !== seg.providerKey
                            ? ' is-dimmed'
                            : ''
                        }${activeProvider() === seg.providerKey ? ' is-pinned' : ''}`}
                        style={{
                          height: `${Math.max(seg.share * 100, seg.share > 0 ? 2 : 0)}%`,
                          background:
                            activeProvider() && activeProvider() !== seg.providerKey
                              ? 'var(--surface-card)'
                              : colorFor(seg.providerKey),
                        }}
                        onPointerEnter={(event) => {
                          if (event.pointerType === 'touch') return
                          setActiveProvider(seg.providerKey)
                        }}
                      />
                    )}
                  </For>
                </div>
                <span class="usage-provider-chart-x">{col.label}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}

function formatCompact(n: number): string {
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`
  return n.toLocaleString()
}

export { providerLabelFromKey }
