// biome-ignore-all lint/a11y/useAriaPropsSupportedByRole lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: ask-widget option interactions follow the same pattern as the existing modal.
import { Check, ChevronDown, ChevronRight, Send, X } from 'lucide-solid'
import { animate } from 'motion'
import { createSignal, For, Show } from 'solid-js'
import type { AskQuestion, AskState } from '../lib/extensionTrackers'
import { formatAskAnswers } from '../lib/extensionTrackers'

interface Props {
  state: AskState
  onAnswer: (formatted: string) => void
  onDismiss: () => void
}

export function AskWidget(props: Props) {
  let widgetRef!: HTMLDivElement
  const [collapsed, setCollapsed] = createSignal(false)
  // tab index for multi-question flows
  const [tab, setTab] = createSignal(0)
  // answers: question text → array of selected labels
  const [answers, setAnswers] = createSignal<Record<string, string[]>>({})

  const questions = () => props.state.questions
  const current = () => questions()[tab()] as AskQuestion | undefined
  const total = () => questions().length

  // All questions answered check
  const allAnswered = () =>
    questions().every((q) => {
      const sel = answers()[q.question] ?? []
      return sel.length > 0
    })

  // Count answered questions
  const answeredCount = () =>
    questions().filter((q) => {
      const sel = answers()[q.question] ?? []
      return sel.length > 0
    }).length

  const toggleOption = (question: string, label: string) => {
    setAnswers((prev) => {
      const q = questions().find((q) => q.question === question)
      const multi = q?.multiSelect ?? false
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

  const handleSkip = () => {
    // Submit empty answer — tells the agent to try again/rephrase
    const merged: Record<string, string[]> = {}
    for (const q of questions()) {
      merged[q.question] = answers()[q.question] ?? []
    }
    const formatted = formatAskAnswers(questions(), merged)
    props.onAnswer(formatted)
    dismiss()
  }

  const handleSubmit = () => {
    const merged: Record<string, string[]> = {}
    for (const q of questions()) {
      merged[q.question] = answers()[q.question] ?? []
    }
    const formatted = formatAskAnswers(questions(), merged)
    props.onAnswer(formatted)
    dismiss()
  }

  function dismiss() {
    animate(widgetRef, { opacity: 0, y: 40, scale: 0.98 }, { duration: 0.24, ease: 'easeIn' }).then(
      () => props.onDismiss()
    )
  }

  // Progress: "1 of 3" or "2/3 answered"
  const progressLabel = () => (total() > 1 ? `${answeredCount()} of ${total()} answered` : '')

  const canAdvance = () => {
    const q = current()
    if (!q) return false
    const sel = answers()[q.question] ?? []
    return sel.length > 0
  }

  const handleNext = () => {
    if (tab() < total() - 1) {
      setTab((t) => t + 1)
    } else {
      handleSubmit()
    }
  }

  const selCount = () => {
    const q = current()
    if (!q) return 0
    return (answers()[q.question] ?? []).length
  }

  return (
    <Show when={questions().length > 0}>
      <div ref={widgetRef} class="ask-widget">
        <div class="ask-widget-header">
          <button
            type="button"
            class="ask-widget-toggle"
            aria-expanded={!collapsed()}
            onClick={() => setCollapsed((c) => !c)}
          >
            <span class="ask-widget-dot" />
            <span class="ask-widget-title">
              Question
              <Show when={total() > 1}>
                <span class="ask-widget-badge">
                  {tab() + 1} of {total()}
                </span>
              </Show>
              <Show when={!collapsed() && allAnswered()}>
                <span class="ask-widget-badge ask-widget-badge--done">ready</span>
              </Show>
            </span>
            <Show
              when={collapsed()}
              fallback={<ChevronDown size={12} strokeWidth={2} class="ask-widget-chevron" />}
            >
              <ChevronRight size={12} strokeWidth={2} class="ask-widget-chevron" />
            </Show>
          </button>
          <button type="button" class="ask-widget-dismiss" title="Dismiss" onClick={handleSkip}>
            <X size={11} strokeWidth={2} />
          </button>
        </div>

        <Show when={!collapsed()}>
          <div class="ask-widget-body">
            <Show when={current()}>
              {(q) => (
                <>
                  {/* Question text */}
                  <div class="ask-widget-q-text">{q().question}</div>

                  {/* Hint */}
                  <div class="ask-widget-hint">
                    {q().multiSelect ? 'Select all that apply' : 'Select one answer'}
                    <Show when={selCount() > 0}>
                      <span class="ask-widget-sel-count">· {selCount()} selected</span>
                    </Show>
                  </div>

                  {/* Options */}
                  <ul class="ask-widget-options">
                    <For each={q().options}>
                      {(opt) => (
                        <li
                          class={`ask-widget-option${
                            isSelected(q().question, opt.label) ? ' is-selected' : ''
                          }`}
                          onClick={() => toggleOption(q().question, opt.label)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ')
                              toggleOption(q().question, opt.label)
                          }}
                          role={q().multiSelect ? 'checkbox' : 'radio'}
                          aria-checked={isSelected(q().question, opt.label)}
                          tabIndex={0}
                        >
                          <span class="ask-widget-opt-indicator">
                            <Show when={isSelected(q().question, opt.label)}>
                              <Check size={11} strokeWidth={3} class="ask-widget-opt-check" />
                            </Show>
                          </span>
                          <span class="ask-widget-opt-content">
                            <span class="ask-widget-opt-label">{opt.label}</span>
                            <Show when={opt.description}>
                              <span class="ask-widget-opt-desc">{opt.description}</span>
                            </Show>
                          </span>
                        </li>
                      )}
                    </For>
                  </ul>

                  {/* Footer: progress + actions */}
                  <div class="ask-widget-footer">
                    <span class="ask-widget-progress">{progressLabel()}</span>
                    <div class="ask-widget-actions">
                      <Show when={total() > 1}>
                        <button
                          type="button"
                          class="ask-widget-prev"
                          disabled={tab() === 0}
                          onClick={() => setTab((t) => t - 1)}
                        >
                          Back
                        </button>
                      </Show>
                      <button type="button" class="ask-widget-skip" onClick={handleSkip}>
                        {total() > 1 ? 'Skip all' : 'Skip'}
                      </button>
                      <button
                        type="button"
                        class="ask-widget-submit"
                        disabled={!canAdvance()}
                        onClick={handleNext}
                      >
                        <Show
                          when={tab() < total() - 1}
                          fallback={
                            <>
                              <Send size={11} strokeWidth={2} />
                              Send
                            </>
                          }
                        >
                          Next
                        </Show>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  )
}
