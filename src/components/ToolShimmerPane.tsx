import { onMount } from 'solid-js'

interface ShimmerParams {
  base: string
  highlight: string
  accent: string
  angle: number
  speed: number
  size: number
  opacity: number
}

const toolShimmer: ShimmerParams = {
  base: 'rgba(148, 163, 184, 0.28)',
  highlight: 'rgba(248, 250, 252, 0.9)',
  accent: 'rgba(203, 213, 225, 0.56)',
  angle: 105,
  speed: 2.4,
  size: 210,
  opacity: 0.9,
}

function rootStyle() {
  return document.documentElement.style
}

function applyToolShimmer(params: ShimmerParams) {
  const style = rootStyle()
  style.setProperty('--tool-shimmer-base', params.base)
  style.setProperty('--tool-shimmer-highlight', params.highlight)
  style.setProperty('--tool-shimmer-accent', params.accent)
  style.setProperty('--tool-shimmer-angle', `${params.angle}deg`)
  style.setProperty('--tool-shimmer-speed', `${params.speed}s`)
  style.setProperty('--tool-shimmer-size', `${params.size}%`)
  style.setProperty('--tool-shimmer-opacity', `${params.opacity}`)
}

export function ToolShimmerPane() {
  onMount(() => applyToolShimmer(toolShimmer))

  return null
}
