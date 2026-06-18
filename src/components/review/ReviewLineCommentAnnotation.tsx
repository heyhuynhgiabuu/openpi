import { Check, X } from 'lucide-solid'
import { createSignal, type JSX, Show } from 'solid-js'
import { formatFileLineCommentSideLabel } from '../../lib/fileLineComments'

export interface ReviewLineCommentAnnotationProps {
  comment: string
  side: 'additions' | 'deletions' | 'current'
  lineLabel: string
  preview?: string
  onSave: (value: string) => void
  onCancel: () => void
}

export function ReviewLineCommentAnnotation(props: ReviewLineCommentAnnotationProps): JSX.Element {
  const [value, setValue] = createSignal('')

  const handleSubmit = (event: Event) => {
    event.preventDefault()
    const next = value().trim()
    if (next.length === 0) return
    props.onSave(next)
    setValue('')
  }

  const handleCancel = (event: Event) => {
    event.preventDefault()
    setValue('')
    props.onCancel()
  }

  return (
    <form class="review-line-annotation review-line-annotation--draft" onSubmit={handleSubmit}>
      <div class="review-line-annotation-meta">
        <span class={`review-line-annotation-side is-${props.side}`}>
          {formatFileLineCommentSideLabel(props.side)}
        </span>
        <span class="review-line-annotation-line">{props.lineLabel}</span>
      </div>
      <Show when={props.preview}>
        {(preview) => <pre class="review-line-annotation-preview">{preview()}</pre>}
      </Show>
      <textarea
        class="review-line-annotation-textarea"
        value={value()}
        placeholder="Add a comment for the agent…"
        rows={3}
        onInput={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            handleSubmit(event)
          } else if (event.key === 'Escape') {
            handleCancel(event)
          }
        }}
      />
      <div class="review-line-annotation-actions">
        <button type="button" class="review-line-annotation-btn" onClick={handleCancel}>
          <X size={12} /> Cancel
        </button>
        <button
          type="submit"
          class="review-line-annotation-btn is-primary"
          disabled={value().trim().length === 0}
        >
          <Check size={12} /> Add
        </button>
      </div>
    </form>
  )
}
