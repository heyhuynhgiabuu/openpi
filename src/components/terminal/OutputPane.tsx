import { createEffect, createSignal, For, onMount, Show } from 'solid-js'
import type { OutputLine } from '../../lib/ipc'

export function OutputPane() {
  const [lines, setLines] = createSignal<OutputLine[]>([])
  let bottomRef!: HTMLDivElement

  onMount(() => {
    // Pre-populate with lines emitted before this pane was mounted
    // (startup logs, sidecar stderr, crashes that happened while closed).
    void window.openpi.getOutputBuffer().then((buffered) => {
      setLines((prev) => {
        const seen = new Set(prev.map((l) => `${l.ts}:${l.text}`))
        const fresh = buffered.filter((l) => !seen.has(`${l.ts}:${l.text}`))
        // Sort by timestamp so any live lines received during the async gap
        // land in chronological order relative to the buffered history.
        return [...fresh, ...prev].sort((a, b) => a.ts - b.ts).slice(-999)
      })
    })

    const unsub = window.openpi.onOutputAppend((line) => {
      setLines((prev) => [...prev.slice(-999), line])
    })
    return () => {
      unsub()
    }
  })

  createEffect(() => {
    lines()
    bottomRef?.scrollIntoView({ behavior: 'instant' })
  })

  return (
    <div class="output-pane">
      <Show when={lines().length === 0}>
        <div class="output-empty">
          No output. Pi SDK logs, extension errors, and diagnostics will appear here.
        </div>
      </Show>
      <For each={lines()}>
        {(line, _i) => (
          <div class={`output-line output-${line.level}`}>
            <span class="output-ts">{new Date(line.ts).toLocaleTimeString()}</span>
            <span class="output-text">{line.text}</span>
          </div>
        )}
      </For>
      <div
        ref={(el) => {
          bottomRef = el
        }}
      />
    </div>
  )
}
