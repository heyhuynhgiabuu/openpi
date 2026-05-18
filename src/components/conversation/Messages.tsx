import { Check, ChevronDown, Copy, FileCode, FilePen, GitBranch } from 'lucide-solid'
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
import { ToolCardView } from './ToolCardView'

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
    if (msg.toolCards.length > 0) {
      if (railAnchorId === undefined) railAnchorId = msg.toolCards[0].toolCallId
      rail.push(...msg.toolCards)
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

type UsageMetrics = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  durationMs: number
  tps: number | null
  cost: number
}

function usageTotal(message: SessionHistoryMessage): number {
  return (
    message.totalTokens ??
    (message.inputTokens ?? 0) +
      (message.outputTokens ?? 0) +
      (message.cacheReadTokens ?? 0) +
      (message.cacheWriteTokens ?? 0)
  )
}

function aggregateUsage(messages: SessionHistoryMessage[]): UsageMetrics {
  const input = messages.reduce((sum, msg) => sum + (msg.inputTokens ?? 0), 0)
  const output = messages.reduce((sum, msg) => sum + (msg.outputTokens ?? 0), 0)
  const cacheRead = messages.reduce((sum, msg) => sum + (msg.cacheReadTokens ?? 0), 0)
  const cacheWrite = messages.reduce((sum, msg) => sum + (msg.cacheWriteTokens ?? 0), 0)
  const total = messages.reduce((sum, msg) => sum + usageTotal(msg), 0)
  // Sum per-message durations across turns (improvement over Math.max)
  const durationMs = messages.reduce((sum, msg) => sum + (msg.durationMs ?? 0), 0)
  const tps = durationMs > 0 && output > 0 ? output / (durationMs / 1000) : null
  const cost = messages.reduce((sum, msg) => sum + (msg.cost ?? 0), 0)
  return { input, output, cacheRead, cacheWrite, total, durationMs, tps, cost }
}

function formatRuntime(ms: number): string {
  if (ms <= 0) return ''
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const minutes = Math.floor(seconds / 60)
  const remainder = Math.round(seconds % 60)
  return `${minutes}m ${remainder}s`
}

function UsageRow(props: { modelName?: string; metrics: UsageMetrics }) {
  return (
    <div class="message-usage">
      <Show when={props.modelName}>
        <span class="message-usage-model">{props.modelName}</span>
      </Show>
      <span>out {props.metrics.output.toLocaleString()}</span>
      <span>in {props.metrics.input.toLocaleString()}</span>
      <span>
        {`cache r/w ${props.metrics.cacheRead.toLocaleString()}/${props.metrics.cacheWrite.toLocaleString()}`}
      </span>
      <span>total {props.metrics.total.toLocaleString()}</span>
      <Show when={props.metrics.durationMs > 0}>
        <span>{formatRuntime(props.metrics.durationMs)}</span>
      </Show>
      <Show when={props.metrics.cost > 0}>
        <span>${props.metrics.cost.toFixed(4)}</span>
      </Show>
    </div>
  )
}

/**
 * Estimate output tokens from text length (~4 chars per token on average
 * for mixed English + code). Used during streaming before actual token
 * counts arrive from the agent session event.
 */
function estimateTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4))
}

/**
 * LiveUsageRow — shown during streaming before actual token counts arrive.
 * Shows estimated output tokens accumulating in real time.
 */
function LiveUsageRow(props: { text: string; modelName?: string }) {
  const estTokens = createMemo(() => estimateTokens(props.text))
  return (
    <div class="message-usage message-usage--streaming">
      <Show when={props.modelName}>
        <span class="message-usage-model">{props.modelName}</span>
      </Show>
      <span class="message-usage-live">
        generating&nbsp;~{estTokens().toLocaleString()}&nbsp;tok
      </span>
    </div>
  )
}

type AssistantMessageGroupProps = {
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

        <For each={props.message.toolCards}>
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

type SystemMsgProps = {
  message: SystemMessage
}

/** Compact path display: keep the last N segments of a path */
function shortPath(p: string, segments = 3): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts.length <= segments ? p : `…/${parts.slice(-segments).join('/')}`
}

export const SystemMsg: Component<SystemMsgProps> = (props) => {
  const [expanded, setExpanded] = createSignal(false)

  const isCompaction = () => props.message.kind === 'compaction'
  const modifiedFiles = () => props.message.modifiedFiles ?? []
  const readFiles = () => props.message.readFiles ?? []
  const hasFiles = () => modifiedFiles().length > 0 || readFiles().length > 0
  const fileCount = () => modifiedFiles().length + readFiles().length

  return (
    <div
      class={`system-message${
        isCompaction() && props.message.done && hasFiles() ? ' system-message--expandable' : ''
      } ${props.message.done ? 'is-done' : 'is-pending'}`}
    >
      {/* ── Header row ────────────────────────────────────────────────────── */}
      <div class="system-msg-row">
        <span class="system-msg-icon">{isCompaction() ? '⟳' : '↺'}</span>
        <span class="system-msg-text">{props.message.text}</span>

        {/* File count badge + toggle */}
        <Show when={isCompaction() && props.message.done && hasFiles()}>
          <button
            type="button"
            class={`system-msg-toggle${expanded() ? ' is-open' : ''}`}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded()}
            title={expanded() ? 'Hide files' : 'Show files & changes'}
          >
            <span class="system-msg-file-count">
              {fileCount()} {fileCount() === 1 ? 'file' : 'files'}
            </span>
            <ChevronDown size={11} strokeWidth={2} />
          </button>
        </Show>
      </div>

      {/* ── Files & changes section ───────────────────────────────────────── */}
      <Show when={expanded() && hasFiles()}>
        <div class="system-msg-files">
          <Show when={modifiedFiles().length > 0}>
            <div class="system-msg-file-group">
              <span class="system-msg-file-label">
                <FilePen size={11} strokeWidth={2} />
                Modified
              </span>
              <div class="system-msg-file-list">
                <For each={modifiedFiles()}>
                  {(f) => (
                    <span class="system-msg-file-item system-msg-file-item--modified" title={f}>
                      {shortPath(f)}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <Show when={readFiles().length > 0}>
            <div class="system-msg-file-group">
              <span class="system-msg-file-label">
                <FileCode size={11} strokeWidth={2} />
                Read
              </span>
              <div class="system-msg-file-list">
                <For each={readFiles()}>
                  {(f) => (
                    <span class="system-msg-file-item system-msg-file-item--read" title={f}>
                      {shortPath(f)}
                    </span>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </div>
      </Show>
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
