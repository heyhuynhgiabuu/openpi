import type { JSX } from 'solid-js'

export function HighlightedText(props: { text: string; ranges?: readonly [number, number][] }) {
  const nodes: (string | JSX.Element)[] = []
  if (!props.ranges?.length) return <>{props.text}</>

  let cursor = 0
  for (const [start, end] of props.ranges) {
    if (start > cursor) nodes.push(props.text.slice(cursor, start))
    nodes.push(<mark class="fsearch-hl">{props.text.slice(start, end + 1)}</mark>)
    cursor = end + 1
  }
  if (cursor < props.text.length) nodes.push(props.text.slice(cursor))

  return <>{nodes}</>
}

export function ModifierBtn(props: {
  label: string
  title: string
  active: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      class={`fsearch-modifier-btn${props.active ? ' is-active' : ''}`}
      title={props.title}
      onClick={props.onToggle}
      tabIndex={-1}
      aria-pressed={props.active}
    >
      {props.label}
    </button>
  )
}
