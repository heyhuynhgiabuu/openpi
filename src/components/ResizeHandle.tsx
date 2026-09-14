/**
 * ResizeHandle — drag to resize adjacent panels.
 *
 * Usage:
 *   <ResizeHandle
 *     direction="horizontal"        // left/right drag changes width
 *     onResize={(delta) => setWidth(w => clamp(w + delta, min, max))}
 *   />
 *
 * Renders a thin invisible hit-target that becomes visible on hover.
 * Authority: pure renderer — no IPC, no side effects beyond calling onResize.
 */

import type { Component } from 'solid-js'

interface ResizeHandleProps {
  /** Axis to resize along */
  direction: 'horizontal' | 'vertical'
  /** Called with pixel delta on each move; parent owns the clamping */
  onResize: (delta: number) => void
  /** Extra CSS class to apply to the handle element */
  class?: string
}

export const ResizeHandle: Component<ResizeHandleProps> = (props) => {
  const isH = () => props.direction === 'horizontal'

  const onMouseDown = (startEvent: MouseEvent) => {
    startEvent.preventDefault()
    document.body.style.cursor = isH() ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    let prev = isH() ? startEvent.clientX : startEvent.clientY

    const onMove = (e: MouseEvent) => {
      const curr = isH() ? e.clientX : e.clientY
      props.onResize(curr - prev)
      prev = curr
    }

    const onUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div
      class={`resize-handle resize-handle--${isH() ? 'h' : 'v'}${props.class ? ` ${props.class}` : ''}`}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={isH() ? 'vertical' : 'horizontal'}
    />
  )
}
