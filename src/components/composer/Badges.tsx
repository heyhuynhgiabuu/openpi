// biome-ignore-all lint/a11y/noSvgWithoutTitle: existing composer progress markup is tracked separately from this release.
import { type Component, createSignal, onCleanup, onMount, Show } from 'solid-js'
import type { SessionStats } from '../../lib/ipc'

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

export const ContextUsageButton: Component<{ percent: number; stats?: SessionStats | null }> = (
  props
) => {
  const [open, setOpen] = createSignal(false)
  let btnRef: HTMLButtonElement | undefined
  let popoverRef: HTMLDivElement | undefined

  const r = 7
  const circ = 2 * Math.PI * r
  const dash = () => (circ * Math.min(props.percent, 100)) / 100
  const isHigh = () => props.percent >= 80
  const isMedium = () => props.percent >= 50 && props.percent < 80
  const display = () => Math.round(props.percent)

  const toggle = () => {
    if (!props.stats) return
    setOpen((prev) => !prev)
  }

  const close = (e: MouseEvent) => {
    if (
      popoverRef &&
      !popoverRef.contains(e.target as Node) &&
      btnRef &&
      !btnRef.contains(e.target as Node)
    ) {
      setOpen(false)
    }
  }

  onMount(() => {
    document.addEventListener('mousedown', close)
  })
  onCleanup(() => {
    document.removeEventListener('mousedown', close)
  })

  const totalTokens = () => (props.stats?.inputTokens ?? 0) + (props.stats?.outputTokens ?? 0)
  const pct = () => props.percent
  // contextTokens/contextWindow come from contextUsage — current context window fill
  // (what Pi TUI shows), NOT cumulative session totals.
  const contextUsed = () => props.stats?.contextTokens ?? totalTokens()
  const contextMax = () =>
    props.stats?.contextWindow ?? (pct() > 0 ? Math.round(contextUsed() / (pct() / 100)) : 0)
  const contextAvail = () => Math.max(0, contextMax() - contextUsed())

  return (
    <div class="ctx-usage-wrap">
      <button
        ref={btnRef}
        type="button"
        class={`ctx-usage-btn${isHigh() ? ' is-high' : isMedium() ? ' is-medium' : ''}${isHigh() ? ' ctx-usage-pulse' : ''}`}
        title={`Context window: ${display()}% used`}
        aria-label={`Context window ${display()}% used`}
        onClick={toggle}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          {/* track */}
          <circle
            cx="9"
            cy="9"
            r={r}
            stroke="currentColor"
            stroke-width="2"
            stroke-opacity="0.18"
          />
          {/* fill arc */}
          <circle
            cx="9"
            cy="9"
            r={r}
            stroke="currentColor"
            stroke-width="2"
            stroke-dasharray={`${dash()} ${circ - dash()}`}
            stroke-dashoffset={circ * 0.25}
            /* start at top */
            stroke-linecap="round"
          />
        </svg>
        <span class="ctx-usage-label">{display()}%</span>
      </button>

      <Show when={open() && props.stats}>
        <div ref={popoverRef} class="ctx-popover">
          <div class="ctx-pop-header">Context Window</div>

          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Tokens</span>
            <span class="ctx-pop-value">{formatNumber(totalTokens())}</span>
          </div>
          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Input</span>
            <span class="ctx-pop-value">{formatNumber(props.stats!.inputTokens)}</span>
          </div>
          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Output</span>
            <span class="ctx-pop-value">{formatNumber(props.stats!.outputTokens)}</span>
          </div>
          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Cache read</span>
            <span class="ctx-pop-value">{formatNumber(props.stats!.cacheReadTokens)}</span>
          </div>
          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Cache write</span>
            <span class="ctx-pop-value">{formatNumber(props.stats!.cacheWriteTokens)}</span>
          </div>

          <div class="ctx-pop-divider" />

          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Cost</span>
            <span class="ctx-pop-value">{formatCost(props.stats!.cost)}</span>
          </div>

          <div class="ctx-pop-divider" />

          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Used</span>
            <span class="ctx-pop-value">{formatNumber(contextUsed())}</span>
          </div>
          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Available</span>
            <span class="ctx-pop-value">{formatNumber(contextAvail())}</span>
          </div>
          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Window</span>
            <span class="ctx-pop-value">{formatNumber(contextMax())}</span>
          </div>

          <div class="ctx-pop-usage-bar">
            <div class="ctx-pop-usage-fill" style={{ width: `${Math.min(pct(), 100)}%` }} />
          </div>
          <div class="ctx-pop-row">
            <span class="ctx-pop-label">Usage</span>
            <span class="ctx-pop-value">{pct().toFixed(1)}%</span>
          </div>
        </div>
      </Show>
    </div>
  )
}

export const TpsBadge: Component<{ tps: number }> = (props) => (
  <span class="composer-tps-badge" title={`Last run TPS: ${props.tps.toFixed(1)} tokens/second`}>
    TPS {props.tps.toFixed(1)}
  </span>
)
