import logoUrl from '@icons/icon.svg'
import { ArrowDown, Clock3, FolderOpen, GitBranch } from 'lucide-solid'
import { type Component, createEffect, createMemo, createSignal, Show } from 'solid-js'
import { createStore, reconcile } from 'solid-js/store'
import { VList, type VListHandle } from 'virtua/solid'
import type { DisplayPreferences } from '../../lib/displayPreferences'
import type { SessionHistoryMessage, WorkspaceSummaryInfo } from '../../lib/ipc'
import type { Message } from '../../types/session'
import { ExtensionResponseCard } from './ExtensionResponseCard'
import { AssistantMessageGroup } from './Messages'

import { SystemMsg } from './SystemMessage'
import { UserMessage } from './UserMessage'

type AssistantGroup = {
  kind: 'assistant-group'
  messages: SessionHistoryMessage[]
  id: string
}

type OtherEntry = {
  kind: 'other'
  message: Message
}

type RenderItem = AssistantGroup | OtherEntry

type RenderRole = 'assistant' | 'user' | 'system' | 'extension'

function groupMessages(messages: Message[]): RenderItem[] {
  const result: RenderItem[] = []
  let i = 0
  while (i < messages.length) {
    const msg = messages[i] as SessionHistoryMessage
    if (msg.role === 'assistant') {
      const group: SessionHistoryMessage[] = []
      while (i < messages.length && (messages[i] as SessionHistoryMessage).role === 'assistant') {
        group.push(messages[i] as SessionHistoryMessage)
        i++
      }
      result.push({
        kind: 'assistant-group',
        messages: group,
        id: group[0].id,
      })
    } else {
      result.push({ kind: 'other', message: messages[i] })
      i++
    }
  }
  return result
}

function getRenderRole(item: RenderItem): RenderRole {
  if (item.kind === 'assistant-group') return 'assistant'
  if (item.message.role === 'system') return 'system'
  if (item.message.role === 'extension') return 'extension'
  return 'user'
}

function getTopSpacing(items: RenderItem[], index: number): number {
  if (index <= 0) return 0

  const prevRole = getRenderRole(items[index - 1])
  const currRole = getRenderRole(items[index])

  if ((prevRole === 'assistant' || prevRole === 'system') && currRole === 'user') return 48
  if (prevRole === 'user' && currRole === 'assistant') return 12
  if (prevRole === 'assistant' && currRole === 'assistant') return 28

  return 0
}

function formatRelativeTime(value: string | null | undefined): string {
  if (!value) return 'Unknown'

  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp)) return 'Unknown'

  const diffSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  const minute = 60
  const hour = minute * 60
  const day = hour * 24

  if (diffSeconds < 45) return 'just now'
  if (diffSeconds < hour) {
    const minutes = Math.max(1, Math.round(diffSeconds / minute))
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`
  }
  if (diffSeconds < day) {
    const hours = Math.max(1, Math.round(diffSeconds / hour))
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`
  }
  if (diffSeconds < day * 2) return 'yesterday'
  if (diffSeconds < day * 30) {
    const days = Math.max(2, Math.round(diffSeconds / day))
    return `${days} days ago`
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(timestamp))
}

function formatBranchLabel(branch: string | null | undefined): string {
  if (!branch) return 'No git branch'
  if (branch === 'main' || branch === 'master') return `Main branch (${branch})`
  return `Branch ${branch}`
}

type ConversationPaneProps = {
  messages: Message[]
  workspaceName: string
  workspaceSummary: WorkspaceSummaryInfo | null
  activeSessionPath: string | null
  setBottomRef: (el: HTMLDivElement) => void
  onFork?: (messageId: string) => void
  onFileClick?: (path: string) => void
  onOpenWorkspace?: () => void
  displayPreferences: DisplayPreferences
  isStreaming: boolean
  hasMoreHistoryBefore?: boolean
  isLoadingOlderHistory?: boolean
  onLoadOlderHistory?: () => void
  /** Set to a message/entry id to scroll the conversation to that message. */
  scrollToMessageId?: string | null
}

export const ConversationPane: Component<ConversationPaneProps> = (props) => {
  /*
   * Stable render items — prevents AssistantMessageGroup from unmounting when
   * the messages array changes on every streaming delta.
   *
   * Without reconcile: every text_delta → new messages signal → new RenderItem[]
   * → <For> sees new array → destroys + recreates every AssistantMessageGroup.
   *
   * With reconcile(key:'id', merge:true): items matched by their stable id are
   * updated in-place. The group's `messages` field updates, but the component
   * instance is kept alive → its internal segment-store handles the delta.
   */
  const [items, setItems] = createStore<RenderItem[]>([])
  createEffect(() => {
    setItems(reconcile(groupMessages(props.messages), { key: 'id', merge: true }))
  })

  let listRef: VListHandle | undefined
  const [showScrollBtn, setShowScrollBtn] = createSignal(false)
  // true  = auto-scroll is active (user is at / near bottom)
  // false = user scrolled away; stop forcing scroll
  const [isAtBottom, setIsAtBottom] = createSignal(true)

  const scrollToBottomIndex = (smooth = false) => {
    const lastIndex = items.length - 1
    if (!listRef || lastIndex < 0) return
    listRef.scrollToIndex(lastIndex, { align: 'end', smooth })
  }

  // ── Scroll position tracking ──────────────────────────────────────────────
  // Single source of truth for both the scroll button and auto-scroll gate.
  const updateScrollState = () => {
    if (!listRef) return
    const dist = listRef.scrollSize - listRef.scrollOffset - listRef.viewportSize
    setShowScrollBtn(dist > 200)
    // Snap back to "at bottom" automatically when user scrolls close enough
    if (dist < 80) setIsAtBottom(true)
    else if (dist > 120) setIsAtBottom(false)
  }

  // ── Auto-scroll: follow new content only while at bottom ─────────────────
  // Use instant (not smooth) so rapid token updates never conflict with each
  // other or with user scroll gestures.
  createEffect(() => {
    props.messages.length // reactive dependency
    if (!isAtBottom()) return
    // Defer one microtask so the new DOM nodes are measured before scrolling.
    queueMicrotask(() => {
      if (!isAtBottom()) return // user might have scrolled in the meantime
      scrollToBottomIndex(false)
      updateScrollState()
    })
  })

  // ── When a new session is loaded, jump straight to the bottom ────────────
  createEffect(() => {
    props.activeSessionPath // reactive dep
    setIsAtBottom(true)
    queueMicrotask(() => {
      scrollToBottomIndex(false)
      updateScrollState()
    })
  })

  // ── When streaming starts, re-engage auto-scroll ─────────────────────────
  // This lets the user scroll up to review context while idle, then when the
  // agent responds the view snaps back so they see the answer arrive.
  createEffect(() => {
    if (props.isStreaming) setIsAtBottom(true)
  })

  // ── Scroll to a specific message by ID (triggered from tree view) ────
  createEffect(() => {
    const rawTarget = props.scrollToMessageId
    if (!rawTarget || !listRef) return

    // Extract the real entry ID (strip nonce suffix added by App.tsx)
    const targetId = rawTarget.includes(':') ? rawTarget.split(':')[0] : rawTarget

    // Search for the target ID in items
    const index = items.findIndex((item) => {
      if (item.kind === 'assistant-group') {
        return item.id === targetId || item.messages.some((m) => m.id === targetId)
      }
      return item.message.id === targetId
    })

    if (index >= 0) {
      setIsAtBottom(false)
      setShowScrollBtn(false)
      listRef.scrollToIndex(index, { align: 'start', smooth: true })
    }
  })

  const scrollToBottom = () => {
    setIsAtBottom(true)
    setShowScrollBtn(false)
    scrollToBottomIndex(true)
  }

  const renderTimelineItem = (item: RenderItem) => {
    if (item.kind === 'assistant-group') {
      return (
        <AssistantMessageGroup
          messages={item.messages}
          agentStreaming={props.isStreaming}
          onFork={props.onFork}
          onFileClick={props.onFileClick}
          displayPreferences={props.displayPreferences}
        />
      )
    }

    if (item.message.role === 'system') {
      return <SystemMsg message={item.message} />
    }

    if (item.message.role === 'extension') {
      return <ExtensionResponseCard message={item.message} />
    }

    return <UserMessage message={item.message as SessionHistoryMessage} onFork={props.onFork} />
  }

  const workspacePath = createMemo(() => props.workspaceSummary?.cwd ?? props.workspaceName)
  const branchLabel = createMemo(() => formatBranchLabel(props.workspaceSummary?.branch))
  const lastModifiedAt = createMemo(() => props.workspaceSummary?.lastModifiedAt ?? null)

  return (
    <div class="conversation-wrap">
      <div style={{ display: 'none' }} ref={props.setBottomRef} />

      <div class="conversation-scroll">
        <Show when={props.displayPreferences.showSessionProgressBar && props.isStreaming}>
          <div class="session-progress-bar" role="status" aria-label="Session is working" />
        </Show>

        <Show
          when={props.messages.length > 0}
          fallback={
            <div class="empty-conversation">
              <section class="empty-session-hero" aria-label="New session workspace summary">
                <span class="empty-session-logo-frame" aria-hidden="true">
                  <img src={logoUrl} alt="" />
                </span>
                <h1 class="empty-session-title">Build anything your way</h1>
                <button
                  type="button"
                  class="empty-session-path-btn"
                  onClick={props.onOpenWorkspace}
                  title={`Change workspace: ${workspacePath()}`}
                >
                  <FolderOpen size={14} />
                  <span>{workspacePath()}</span>
                </button>
                <div class="empty-session-meta">
                  <div class="empty-session-meta-row">
                    <GitBranch size={14} aria-hidden="true" />
                    <span>{branchLabel()}</span>
                  </div>
                  <div class="empty-session-meta-row">
                    <Clock3 size={14} aria-hidden="true" />
                    <span>
                      Last modified <strong>{formatRelativeTime(lastModifiedAt())}</strong>
                    </span>
                  </div>
                </div>
              </section>
            </div>
          }
        >
          <Show when={props.hasMoreHistoryBefore && props.onLoadOlderHistory}>
            <div class="history-load-more-wrap">
              <button
                type="button"
                class="history-load-more-btn"
                disabled={props.isLoadingOlderHistory}
                onClick={props.onLoadOlderHistory}
              >
                {props.isLoadingOlderHistory ? 'Loading older messages…' : 'Load older messages'}
              </button>
            </div>
          </Show>

          <VList
            class="message-list"
            style={{ height: '100%' }}
            data={items}
            bufferSize={300}
            onScroll={updateScrollState}
            ref={(handle) => {
              listRef = handle
              if (handle) queueMicrotask(updateScrollState)
            }}
          >
            {(item, index) => (
              <div
                class="message-list-item"
                style={{
                  'padding-top': `${getTopSpacing(items, index())}px`,
                }}
              >
                {renderTimelineItem(item)}
              </div>
            )}
          </VList>
        </Show>
      </div>

      <Show when={showScrollBtn()}>
        <button
          type="button"
          class="scroll-to-bottom-btn"
          onClick={scrollToBottom}
          title="Scroll to bottom"
        >
          <ArrowDown size={13} />
        </button>
      </Show>
    </div>
  )
}
