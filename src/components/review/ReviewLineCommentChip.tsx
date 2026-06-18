import { X } from 'lucide-solid'
import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import {
  type FileLineComment,
  formatFileLineCommentSideLabel,
  formatLineRange,
} from '../../lib/fileLineComments'

export interface ReviewLineCommentChipProps {
  comment: FileLineComment
  onRemove?: (id: string) => void
}

export function ReviewLineCommentChip(props: ReviewLineCommentChipProps): JSX.Element {
  const handleRemove = (event: Event) => {
    event.stopPropagation()
    props.onRemove?.(props.comment.id)
  }

  return (
    <div class="review-line-annotation review-line-annotation--saved">
      <div class="review-line-annotation-meta">
        <span class={`review-line-annotation-side is-${props.comment.side}`}>
          {formatFileLineCommentSideLabel(props.comment.side)}
        </span>
        <span class="review-line-annotation-line">
          {formatLineRange(props.comment.startLine, props.comment.endLine)}
        </span>
        <Show when={props.onRemove}>
          <button
            type="button"
            class="review-line-annotation-remove"
            onClick={handleRemove}
            aria-label="Remove comment"
          >
            <X size={11} />
          </button>
        </Show>
      </div>
      <Show when={props.comment.snippet}>
        {(snippet) => <pre class="review-line-annotation-preview">{snippet()}</pre>}
      </Show>
      <div class="review-line-annotation-text">{props.comment.comment}</div>
    </div>
  )
}
