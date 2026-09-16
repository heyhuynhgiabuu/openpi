import { For, createSignal } from 'solid-js'
import type { PreapplyReview as Review } from '../lib/extensionUiTypes'

type Props = {
  title: string
  review: Review
  /**
   * Denying is an answer, not a dismissal: it sends an empty selection so the
   * model is told the change was refused instead of never answered.
   */
  onApply: (approved: number[], remember: boolean) => void
}

/**
 * Hunk review for a Pi `edit` call that has not been applied yet. Every hunk is
 * one `edits[]` entry, and the indexes sent back are the entries Pi keeps. A
 * `write` review reuses this modal with one synthetic hunk for the whole-file
 * change, so the selection there is all-or-nothing.
 */
export function PreapplyReview(props: Props) {
  const [selected, setSelected] = createSignal<number[]>(
    props.review.hunks.map((_, index) => index)
  )
  const [remember, setRemember] = createSignal(false)

  const toggle = (index: number) => {
    setSelected((current) =>
      current.includes(index)
        ? current.filter((value) => value !== index)
        : [...current, index].sort((a, b) => a - b)
    )
  }

  return (
    <div class="extension-ui-overlay ask-overlay" role="presentation">
      <dialog open class="ask-modal ask-modal-review" aria-modal="true">
        <div class="ask-modal-header">
          <span class="ask-modal-title">{props.title}</span>
          <span class="ask-modal-counter">{props.review.summary}</span>
        </div>
        <div class="preapply-hunks">
          <For each={props.review.hunks}>
            {(hunk, index) => (
              <label class="preapply-hunk" classList={{ 'is-off': !selected().includes(index()) }}>
                <span class="preapply-hunk-head">
                  <input
                    type="checkbox"
                    checked={selected().includes(index())}
                    onChange={() => toggle(index())}
                  />
                  <span>{`Hunk ${index() + 1} · -${hunk.removed} / +${hunk.added}`}</span>
                </span>
                <pre class="preapply-hunk-diff">
                  <For each={hunk.diff.split('\n')}>
                    {(line) => (
                      <span
                        class="preapply-hunk-line"
                        classList={{
                          'diff-added': line.startsWith('+'),
                          'diff-removed': line.startsWith('-'),
                        }}
                      >
                        {`${line}\n`}
                      </span>
                    )}
                  </For>
                </pre>
              </label>
            )}
          </For>
        </div>
        <label class="preapply-remember">
          <input
            type="checkbox"
            checked={remember()}
            disabled={selected().length === 0}
            onChange={(event) => setRemember(event.currentTarget.checked)}
          />
          <span>Skip review for the rest of this turn</span>
        </label>
        <div class="ask-modal-footer">
          <button
            type="button"
            class="ask-btn ask-btn-ghost"
            onClick={() => props.onApply([], false)}
          >
            Deny all
          </button>
          <button
            type="button"
            class="ask-btn ask-btn-primary"
            disabled={selected().length === 0}
            onClick={() => props.onApply(selected(), remember())}
          >
            {`Apply ${selected().length} of ${props.review.hunks.length}`}
          </button>
        </div>
      </dialog>
    </div>
  )
}
