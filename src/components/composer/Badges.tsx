// biome-ignore-all lint/a11y/noSvgWithoutTitle: existing composer progress markup is tracked separately from this release.
import type { Component } from 'solid-js'

// Shows a mini SVG arc + percentage. Color shifts green→amber→red.
export const ContextUsageButton: Component<{ percent: number }> = (props) => {
  const r = 7
  const circ = 2 * Math.PI * r
  const dash = () => (circ * Math.min(props.percent, 100)) / 100
  const isHigh = () => props.percent >= 80
  const isMedium = () => props.percent >= 50 && props.percent < 80
  const display = () => Math.round(props.percent)

  return (
    <button
      type="button"
      class={`ctx-usage-btn${isHigh() ? ' is-high' : isMedium() ? ' is-medium' : ''}${isHigh() ? ' ctx-usage-pulse' : ''}`}
      title={`Context window: ${display()}% used`}
      aria-label={`Context window ${display()}% used`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        {/* track */}
        <circle cx="9" cy="9" r={r} stroke="currentColor" stroke-width="2" stroke-opacity="0.18" />
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
  )
}

export const TpsBadge: Component<{ tps: number }> = (props) => (
  <span class="composer-tps-badge" title={`Last run TPS: ${props.tps.toFixed(1)} tokens/second`}>
    TPS {props.tps.toFixed(1)}
  </span>
)
