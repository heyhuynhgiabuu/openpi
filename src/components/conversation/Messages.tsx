import { type Component, createEffect, createMemo, For, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { DEFAULT_DISPLAY_PREFERENCES, type DisplayPreferences } from '../../lib/displayPreferences'
import type { SessionHistoryMessage } from '../../lib/ipc'
import type { Message, SystemMessage, ToolCard } from '../../types/session'
import { MarkdownContent } from './MarkdownContent'
import { MessageActions } from './MessageActions'
import { SystemMsg } from './SystemMessage'
import { ToolCardView } from './ToolCardView'
import { UserMessage } from './UserMessage'
import { aggregateUsage, LiveUsageRow, UsageRow, usageTotal } from './usage'

type Segment =
  | { kind: 'rail'; cards: ToolCard[]; id: string }
  | { kind: 'thinking'; content: string; streaming?: boolean; id: string }
  | { kind: 'text'; content: string; streaming?: boolean; id: string }

function ThinkingBlock(props: { text: string; streaming?: boolean; show: boolean }) {
  return (
    <Show when={props.show}>
      <div class={`thinking-block${props.streaming ? ' is-streaming' : ' is-complete'}`}>
        <div class="thinking-body">
          <MarkdownContent text={props.text} streaming={props.streaming} />
        </div>
      </div>
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
  agentStreaming: boolean
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
                        shimmerActive={props.agentStreaming}
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
          modelName={[...props.messages].reverse().find((m) => m.modelName)?.modelName}
          durationMs={props.messages.reduce((sum, m) => sum + (m.durationMs ?? 0), 0)}
        />
      </div>
    </div>
  )
}

type AssistantMessageProps = {
  message: SessionHistoryMessage
  agentStreaming?: boolean
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
              shimmerActive={props.agentStreaming ?? props.message.streaming ?? false}
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
          modelName={props.message.modelName}
          durationMs={props.message.durationMs}
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
