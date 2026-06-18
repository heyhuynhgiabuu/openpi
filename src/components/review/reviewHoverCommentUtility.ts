import type { SelectedLineRange } from '@pierre/diffs'

export type ReviewHoveredLine = {
  lineNumber: number
  side?: 'additions' | 'deletions'
}

export function createReviewHoverCommentUtility(props: {
  label: string
  getHoveredLine: () => ReviewHoveredLine | undefined
  onSelect: (range: SelectedLineRange) => void
}): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined

  const button = document.createElement('button')
  button.type = 'button'
  button.ariaLabel = props.label
  button.title = props.label
  button.textContent = '+'
  button.setAttribute('data-openpi-hover-comment', 'true')
  button.style.width = '20px'
  button.style.height = '20px'
  button.style.display = 'flex'
  button.style.alignItems = 'center'
  button.style.justifyContent = 'center'
  button.style.border = 'none'
  button.style.borderRadius = '6px'
  button.style.background = 'var(--warning)'
  button.style.color = 'var(--surface-card)'
  button.style.boxShadow = '0 1px 4px color-mix(in srgb, var(--ink) 28%, transparent)'
  button.style.fontSize = '14px'
  button.style.fontWeight = '700'
  button.style.lineHeight = '1'
  button.style.cursor = 'pointer'
  button.style.position = 'relative'
  button.style.left = '30px'
  button.style.top = 'calc((var(--diffs-line-height, 24px) - 20px) / 2)'

  let line: ReviewHoveredLine | undefined

  const sync = () => {
    const next = props.getHoveredLine()
    if (next) line = next
  }

  const loop = () => {
    if (!button.isConnected) return
    sync()
    requestAnimationFrame(loop)
  }

  const open = () => {
    const next = props.getHoveredLine() ?? line
    if (!next) return
    props.onSelect({ start: next.lineNumber, end: next.lineNumber, side: next.side ?? 'additions' })
  }

  requestAnimationFrame(loop)
  button.addEventListener('mouseenter', sync)
  button.addEventListener('mousemove', sync)
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  })
  button.addEventListener('mousedown', (event) => {
    event.preventDefault()
    event.stopPropagation()
    sync()
  })
  button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    open()
  })

  return button
}
