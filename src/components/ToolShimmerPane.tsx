import { onCleanup, onMount } from 'solid-js'
import { Pane } from 'tweakpane'

interface ShimmerParams {
  enabled: boolean
  theme: 'graphite' | 'aurora' | 'ember'
  angle: number
  speed: number
  size: number
}

interface ShimmerTheme {
  base: string
  highlight: string
  accent: string
}

interface TweakpaneBinding {
  on(eventName: 'change', handler: () => void): TweakpaneBinding
}

interface TweakpaneRuntime {
  addBinding<T extends object, K extends keyof T>(
    target: T,
    key: K,
    options?: Record<string, unknown>
  ): TweakpaneBinding
  dispose(): void
}

const themes: Record<ShimmerParams['theme'], ShimmerTheme> = {
  graphite: {
    base: 'rgba(156, 163, 175, 0.42)',
    highlight: 'rgba(244, 244, 245, 0.95)',
    accent: 'rgba(209, 213, 219, 0.78)',
  },
  aurora: {
    base: 'rgba(125, 211, 252, 0.38)',
    highlight: 'rgba(240, 253, 250, 0.98)',
    accent: 'rgba(196, 181, 253, 0.88)',
  },
  ember: {
    base: 'rgba(251, 146, 60, 0.34)',
    highlight: 'rgba(255, 247, 237, 0.98)',
    accent: 'rgba(252, 211, 77, 0.86)',
  },
}

const defaults: ShimmerParams = {
  enabled: true,
  theme: 'graphite',
  angle: 105,
  speed: 1.35,
  size: 220,
}

function rootStyle() {
  return document.documentElement.style
}

function applyParams(params: ShimmerParams) {
  const style = rootStyle()
  style.setProperty('--tool-shimmer-enabled', params.enabled ? 'running' : 'paused')
  style.setProperty('--tool-shimmer-opacity', params.enabled ? '1' : '0')
  style.setProperty('--tool-shimmer-angle', `${params.angle}deg`)
  style.setProperty('--tool-shimmer-speed', `${params.speed}s`)
  style.setProperty('--tool-shimmer-size', `${params.size}%`)
}

function applyTheme(theme: ShimmerParams['theme']) {
  const selected = themes[theme]
  const style = rootStyle()
  style.setProperty('--tool-shimmer-base', selected.base)
  style.setProperty('--tool-shimmer-highlight', selected.highlight)
  style.setProperty('--tool-shimmer-accent', selected.accent)
}

function withViewTransition(action: () => void) {
  if (document.startViewTransition) {
    void document.startViewTransition(action).finished
    return
  }
  action()
}

function hasTweakpaneRuntime(pane: Pane): pane is Pane & TweakpaneRuntime {
  const candidate: object = pane
  return 'addBinding' in candidate && typeof candidate.addBinding === 'function'
}

export function ToolShimmerPane() {
  let host: HTMLDivElement | undefined

  onMount(() => {
    if (!host) return

    const params: ShimmerParams = { ...defaults }
    applyParams(params)
    applyTheme(params.theme)

    const pane = new Pane({ container: host, title: 'Tool shimmer', expanded: false })
    if (!hasTweakpaneRuntime(pane)) {
      pane.dispose()
      return
    }

    pane.addBinding(params, 'enabled', { label: 'enabled' }).on('change', () => applyParams(params))
    pane
      .addBinding(params, 'theme', {
        label: 'theme',
        options: {
          Graphite: 'graphite',
          Aurora: 'aurora',
          Ember: 'ember',
        },
      })
      .on('change', () => withViewTransition(() => applyTheme(params.theme)))
    pane
      .addBinding(params, 'angle', { label: 'angle', min: 0, max: 360, step: 1 })
      .on('change', () => applyParams(params))
    pane
      .addBinding(params, 'speed', { label: 'speed', min: 0.4, max: 4, step: 0.05 })
      .on('change', () => applyParams(params))
    pane
      .addBinding(params, 'size', { label: 'size', min: 120, max: 420, step: 10 })
      .on('change', () => applyParams(params))

    onCleanup(() => pane.dispose())
  })

  return <div class="tool-shimmer-pane" ref={host} />
}
