import { createSignal, For, Show } from 'solid-js'
import type { AskQuestion, AskState } from '../lib/extensionTrackers'
import { formatAskAnswers } from '../lib/extensionTrackers'

interface Props {
  state: AskState
  isStreaming: boolean
  onSubmit: (formatted: string) => void
  onDismiss: () => void
}

export function AskUserQuestionModal(props: Props) {
  const [tab, setTab] = createSignal(0)
  // answers: question text → array of selected labels
  const [answers, setAnswers] = createSignal<Record<string, string[]>>({})
  const [freeText, setFreeText] = createSignal<Record<string, string>>({})

  const questions = () => props.state.questions
  const current = () => questions()[tab()] as AskQuestion | undefined
  const total = () => questions().length

  const toggleOption = (question: string, label: string, multi: boolean) => {
    setAnswers((prev) => {
      const cur = prev[question] ?? []
      if (multi) {
        return {
          ...prev,
          [question]: cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label],
        }
      }
      return { ...prev, [question]: [label] }
    })
  }

  const isSelected = (question: string, label: string) =>
    (answers()[question] ?? []).includes(label)

  const updateFreeText = (question: string, val: string) => {
    setFreeText((prev) => ({ ...prev, [question]: val }))
    // sync into answers: replace any existing free-text entry or add
    setAnswers((prev) => {
      const existing = (prev[question] ?? []).filter((l) => !l.startsWith('__free:'))
      return { ...prev, [question]: val.trim() ? [...existing, `__free:${val.trim()}`] : existing }
    })
  }

  const canAdvance = () => {
    const q = current()
    if (!q) return false
    const sel = answers()[q.question] ?? []
    const ft = freeText()[q.question] ?? ''
    return sel.length > 0 || ft.trim().length > 0
  }

  const isLastTab = () => tab() === total() - 1

  const allAnswered = () =>
    questions().every((q) => {
      const sel = answers()[q.question] ?? []
      const ft = freeText()[q.question] ?? ''
      return sel.length > 0 || ft.trim().length > 0
    })

  const handleNext = () => {
    if (!isLastTab()) {
      setTab((t) => t + 1)
    } else {
      // Build merged answers: replace __free: prefix
      const merged: Record<string, string[]> = {}
      for (const q of questions()) {
        const sel = (answers()[q.question] ?? []).map((l) =>
          l.startsWith('__free:') ? l.slice(7) : l
        )
        merged[q.question] = sel
      }
      const formatted = formatAskAnswers(questions(), merged)
      props.onSubmit(formatted)
    }
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop dismiss
    <div class="ask-overlay" onClick={(e) => e.target === e.currentTarget && props.onDismiss()}>
      <div class="ask-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div class="ask-modal-header">
          <span class="ask-modal-counter">
            {tab() + 1} of {total()} question{total() !== 1 ? 's' : ''}
          </span>
          <Show when={total() > 1}>
            <div class="ask-progress-dots">
              <For each={questions()}>
                {(_, i) => (
                  <button
                    type="button"
                    class={`ask-progress-dot${i() === tab() ? ' is-active' : ''}`}
                    onClick={() => setTab(i())}
                    title={questions()[i()]?.header ?? `Question ${i() + 1}`}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>

        {/* Question body */}
        <Show when={current()}>
          {(q) => (
            <div class="ask-modal-body">
              <p class="ask-question-text">{q().question}</p>
              <p class="ask-question-hint">
                {q().multiSelect ? 'Select all that apply' : 'Select one answer'}
              </p>

              <ul class="ask-options">
                <For each={q().options}>
                  {(opt) => (
                    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-checked is valid for radio/checkbox
                    <li
                      class={`ask-option${isSelected(q().question, opt.label) ? ' is-selected' : ''}`}
                      onClick={() => toggleOption(q().question, opt.label, q().multiSelect)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ')
                          toggleOption(q().question, opt.label, q().multiSelect)
                      }}
                      role={q().multiSelect ? 'checkbox' : 'radio'}
                      aria-checked={isSelected(q().question, opt.label)}
                      tabIndex={0}
                    >
                      <span
                        class={`ask-option-indicator${q().multiSelect ? ' is-checkbox' : ' is-radio'}`}
                      >
                        <Show when={isSelected(q().question, opt.label)}>
                          <span class="ask-option-indicator-fill" />
                        </Show>
                      </span>
                      <span class="ask-option-content">
                        <span class="ask-option-label">{opt.label}</span>
                        <Show when={opt.description}>
                          <span class="ask-option-desc">{opt.description}</span>
                        </Show>
                      </span>
                    </li>
                  )}
                </For>
                {/* Free text option */}
                <li
                  class={`ask-option ask-option--freetext${
                    freeText()[q().question]?.trim() ? ' is-selected' : ''
                  }`}
                  onClick={() => {
                    const el = document.querySelector<HTMLInputElement>('.ask-freetext-input')
                    el?.focus()
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      const el = document.querySelector<HTMLInputElement>('.ask-freetext-input')
                      el?.focus()
                    }
                  }}
                  tabIndex={-1}
                >
                  <span class="ask-option-indicator is-radio">
                    <Show when={freeText()[q().question]?.trim()}>
                      <span class="ask-option-indicator-fill" />
                    </Show>
                  </span>
                  <span class="ask-option-content ask-option-content--full">
                    <input
                      class="ask-freetext-input"
                      type="text"
                      placeholder="Type your own answer…"
                      value={freeText()[q().question] ?? ''}
                      onInput={(e) => updateFreeText(q().question, e.currentTarget.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </span>
                </li>
              </ul>
            </div>
          )}
        </Show>

        {/* Footer */}
        <div class="ask-modal-footer">
          <button type="button" class="ask-btn-dismiss" onClick={props.onDismiss}>
            Dismiss
          </button>
          <button
            type="button"
            class={`ask-btn-next${isLastTab() ? ' is-submit' : ''}`}
            disabled={!canAdvance()}
            onClick={handleNext}
          >
            {isLastTab() ? (allAnswered() ? 'Submit' : 'Submit anyway') : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}
