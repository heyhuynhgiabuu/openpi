import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'

import { ToolShimmerPane } from '../src/components/ToolShimmerPane'

const shimmerVars = [
  '--tool-shimmer-base',
  '--tool-shimmer-highlight',
  '--tool-shimmer-accent',
  '--tool-shimmer-angle',
  '--tool-shimmer-speed',
  '--tool-shimmer-size',
  '--tool-shimmer-opacity',
] as const

afterEach(() => {
  cleanup()
  for (const name of shimmerVars) {
    document.documentElement.style.removeProperty(name)
  }
})

describe('ToolShimmerPane', () => {
  it('applies production shimmer variables without rendering controls', () => {
    const { container } = render(() => <ToolShimmerPane />)
    const style = document.documentElement.style

    expect(container.firstElementChild).toBeNull()
    expect(style.getPropertyValue('--tool-shimmer-base')).toBe('rgba(148, 163, 184, 0.28)')
    expect(style.getPropertyValue('--tool-shimmer-highlight')).toBe('rgba(248, 250, 252, 0.9)')
    expect(style.getPropertyValue('--tool-shimmer-accent')).toBe('rgba(203, 213, 225, 0.56)')
    expect(style.getPropertyValue('--tool-shimmer-angle')).toBe('105deg')
    expect(style.getPropertyValue('--tool-shimmer-speed')).toBe('2.4s')
    expect(style.getPropertyValue('--tool-shimmer-size')).toBe('210%')
    expect(style.getPropertyValue('--tool-shimmer-opacity')).toBe('0.9')
  })
})
