import { Check, Copy, GitBranch } from 'lucide-solid'
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from '../../lib/displayPreferences'
import type { SessionHistoryMessage } from '../../lib/ipc'
import type { Message, SystemMessage, ToolCard } from '../../types/session'
import { MarkdownContent } from './MarkdownContent'
import { SystemMsg } from './SystemMessage'
import { ToolCardView } from './ToolCardView'
import { aggregateUsage, LiveUsageRow, UsageRow, usageTotal } from './usage'

type MessageActionsProps = {
  messageId: string
  /** Thunk: called only at copy-click time, never during streaming. */
  getText: () => string
  streaming?: boolean
  onFork?: (id: string) => void
}

function MessageActions(props: MessageActionsProps) {
  const [copied, setCopied] = createSignal(false)
  let copiedTimer: ReturnType<typeof setTimeout> | undefined

  onCleanup(() => {
    if (copiedTimer) clearTimeout(copiedTimer)
  })

  const handleCopy = () => {
    void navigator.clipboard.writeText(props.getText())
    setCopied(true)
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => setCopied(false), 1800)
  }

  return (
    <Show when={!props.streaming}>
      <div class="message-actions">
        <button type="button" class="msg-action-btn" onClick={handleCopy} title="Copy text">
          <Show when={copied()} fallback={<Copy size={12} />}>
            <Check size={12} />
          </Show>
        </button>
        <Show when={props.onFork}>
          <button
            type="button"
            class="msg-action-btn fork-btn"
            onClick={() => props.onFork?.(props.messageId)}
            title="Fork conversation from here"
          >
            <GitBranch size={12} />
            <span>fork</span>
          </button>
        </Show>
      </div>
    </Show>
  )
}

type UserMessageProps = {
  message: SessionHistoryMessage
  onFork?: (id: string) => void
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  return (
    <div class="message-row user-message-row">
      <div class="user-msg-stack">
        <div class="user-bubble">
          <MarkdownContent text={props.message.text} />
        </div>
        <MessageActions
          messageId={props.message.id}
          getText={() => props.message.text}
          streaming={props.message.streaming}
          onFork={props.onFork}
        />
      </div>
    </div>
  )
}

type Segment =
  | { kind: 'rail'; cards: ToolCard[]; id: string }
  | { kind: 'thinking'; content: string; streaming?: boolean; id: string }
  | { kind: 'text'; content: string; streaming?: boolean; id: string }

function ThinkingBlock(props: { text: string; streaming?: boolean; show: boolean }) {
  // Start open and force-open during streaming. User can collapse after.
  const [open, setOpen] = createSignal(true)

  // Re-open automatically whenever streaming resumes (e.g. fork / new turn).
  createEffect(() => {
    if (props.streaming) setOpen(true)
  })

  return (
    <Show when={props.show}>
      <details
        class={`thinking-block${props.streaming ? ' is-streaming' : ' is-complete'}`}
        open={open()}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span class="thinking-label">Thinking</span>
          <Show when={props.streaming}>
            <span class="thinking-state">streaming</span>
          </Show>
        </summary>
        {/*
         * IMPORTANT: do NOT wrap with <Show when={open()}> here.
         * Using <Show> would unmount MarkdownContent every time the user
         * collapses the block, destroying the rendered html() signal and
         * forcing a full re-render (plain flash) on next open.
         * The browser's native <details> already hides non-summary content
         * when closed — no extra Show needed.
         */}
        <div class="thinking-body">
          <MarkdownContent text={props.text} streaming={props.streaming} />
        </div>
      </details>
    </Show>
  )
}

function buildSegments(messages: SessionHistoryMessage[]): Segment[] {
  const segs: Segment[] = []
  let rail: ToolCard[] = []
  // Stable rail id: first toolCallId in the group so reconcile can match it.
  let railAnchorId: string | undefined

  for (const msg of messages) {
    if (msg.thinking) {
      if (rail.length > 0) {
        segs.push({ kind: 'rail', cards: [...rail], id: `rail-${railAnchorId}` })
        rail = []
        railAnchorId = undefined
      }
      segs.push({
        kind: 'thinking',
        content: msg.thinking,
        streaming: msg.streaming,
        id: `${msg.id}:thinking`,
      })
    }
    const inlineToolCards = msg.toolCards.filter((card) => card.toolName !== 'update_plan')
    if (inlineToolCards.length > 0) {
      if (railAnchorId === undefined) railAnchorId = inlineToolCards[0].toolCallId
      rail.push(...inlineToolCards)
    }
    if (msg.text) {
      if (rail.length > 0) {
        segs.push({ kind: 'rail', cards: [...rail], id: `rail-${railAnchorId}` })
        rail = []
        railAnchorId = undefined
      }
      segs.push({ kind: 'text', content: msg.text, streaming: msg.streaming, id: msg.id })
    }
  }

  if (rail.length > 0) segs.push({ kind: 'rail', cards: rail, id: `rail-${railAnchorId}` })

  return segs
}

export type AssistantMessageGroupProps = {
  messages: SessionHistoryMessage[]
  onFork?: (id: string) => void
  onFileClick?: (path: string) => void
  displayPreferences: DisplayPreferences
}

export const AssistantMessageGroup: Component<AssistantMessageGroupProps> = (props) => {
  const lastMsg = createMemo(() => props.messages[props.messages.length - 1])
  const usage = createMemo(() => aggregateUsage(props.messages))

  /*
   * Stable segment store — prevents ThinkingBlock and MarkdownContent from
   * being unmounted/remounted on every streaming delta.
   *
   * Problem: buildSegments() creates new object references on every call.
   * <For> uses reference equality, so it destroys and recreates every segment
   * component on every delta. MarkdownContent.html() resets to '' → phase-1
   * plain-flash fires → visible flicker.
   *
   * Fix: reconcile({ key: 'id', merge: true }) matches segments by their stable
   * id and updates fields in-place on the same store proxy. <For> sees the same
   * proxy reference → no unmount → MarkdownContent keeps its html() state.
   */
  const [segments, setSegments] = createStore<Segment[]>([])
  createEffect(() => {
    setSegments(reconcile(buildSegments(props.messages), { key: 'id', merge: true }))
  })

  const hasContent = createMemo(() => segments.length > 0)

  // Lazy: only computed when the copy button is clicked, not on every delta.
  const getAllText = () =>
    props.messages
      .map((msg) => msg.text)
      .filter(Boolean)
      .join('\n\n')

  const modelName = createMemo(() => props.messages.find((msg) => msg.modelName)?.modelName)

  return (
    <div class="message-row assistant-message-row">
      <div class="assistant-body">
        <For each={segments}>
          {(segment) => {
            if (segment.kind === 'rail') {
              return (
                <div class="tool-group-rail">
                  <For each={segment.cards}>
                    {(card) => (
                      <ToolCardView
                        card={card}
                        onFileClick={props.onFileClick}
                        displayPreferences={props.displayPreferences}
                      />
                    )}
                  </For>
                </div>
              )
            }

            if (segment.kind === 'thinking') {
              return (
                <ThinkingBlock
                  text={segment.content}
                  streaming={segment.streaming}
                  show={props.displayPreferences.showReasoningSummaries}
                />
              )
            }

            return <MarkdownContent text={segment.content} streaming={segment.streaming} />
          }}
        </For>

        <Show when={!hasContent() && lastMsg()?.streaming}>
          <div class="typing-dots">
            <For each={[0, 150, 300]}>
              {(delay) => (
                <span class="pulse" style={{ 'animation-delay': `${delay}ms` }}>
                  ·
                </span>
              )}
            </For>
          </div>
        </Show>

        <Show when={usage().input > 0 || usage().output > 0 || usage().total > 0}>
          <UsageRow modelName={modelName()} metrics={usage()} />
        </Show>
        <Show
          when={
            !(usage().input > 0 || usage().output > 0 || usage().total > 0) && lastMsg()?.streaming
          }
        >
          <LiveUsageRow text={props.messages.map((m) => m.text).join('')} modelName={modelName()} />
        </Show>

        <MessageActions
          messageId={lastMsg()?.id ?? ''}
          getText={getAllText}
          streaming={lastMsg()?.streaming}
          onFork={props.onFork}
        />
      </div>
    </div>
  )
}

type AssistantMessageProps = {
  message: SessionHistoryMessage
  onFork?: (id: string) => void
  onFileClick?: (path: string) => void
  displayPreferences: DisplayPreferences
}

export const AssistantMessage: Component<AssistantMessageProps> = (props) => {
  return (
    <div class="message-row assistant-message-row">
      <div class="assistant-header">
        <div class="assistant-avatar-badge">π</div>
        <span class="assistant-name-tag">Pi</span>
      </div>
      <div class="assistant-body">
        <Show when={props.message.thinking}>
          <ThinkingBlock
            text={props.message.thinking ?? ''}
            streaming={props.message.streaming}
            show={props.displayPreferences.showReasoningSummaries}
          />
        </Show>

        <For each={props.message.toolCards.filter((card) => card.toolName !== 'update_plan')}>
          {(card) => (
            <ToolCardView
              card={card}
              onFileClick={props.onFileClick}
              displayPreferences={props.displayPreferences}
            />
          )}
        </For>

        <Show when={props.message.text}>
          <MarkdownContent text={props.message.text} streaming={props.message.streaming} />
        </Show>

        <Show
          when={!props.message.text && !props.message.toolCards.length && props.message.streaming}
        >
          <div class="typing-dots">
            <For each={[0, 150, 300]}>
              {(delay) => (
                <span class="pulse" style={{ 'animation-delay': `${delay}ms` }}>
                  ·
                </span>
              )}
            </For>
          </div>
        </Show>

        <Show
          when={
            (props.message.inputTokens ?? 0) > 0 ||
            (props.message.outputTokens ?? 0) > 0 ||
            usageTotal(props.message) > 0
          }
        >
          <UsageRow modelName={props.message.modelName} metrics={aggregateUsage([props.message])} />
        </Show>

        <Show when={props.message.streaming && props.message.text}>
          <LiveUsageRow text={props.message.text} modelName={props.message.modelName} />
        </Show>

        <MessageActions
          messageId={props.message.id}
          getText={() => props.message.text}
          streaming={props.message.streaming}
          onFork={props.onFork}
        />
      </div>
    </div>
  )
}

export function renderMessage(
  message: Message,
  onFork?: (id: string) => void,
  onFileClick?: (path: string) => void,
  displayPreferences: DisplayPreferences = DEFAULT_DISPLAY_PREFERENCES
) {
  if (message.role === 'system') return <SystemMsg message={message as SystemMessage} />
  if (message.role === 'user')
    return <UserMessage message={message as SessionHistoryMessage} onFork={onFork} />
  return (
    <AssistantMessage
      message={message as SessionHistoryMessage}
      onFork={onFork}
      onFileClick={onFileClick}
      displayPreferences={displayPreferences}
    />
  )
}
