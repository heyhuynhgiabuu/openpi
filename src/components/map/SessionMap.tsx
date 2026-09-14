/**
 * SessionMap — read-only view of the session tree Pi stores in the JSONL file.
 *
 * Pi sessions are trees (parentId branching, compaction entries, labels), not
 * flat chats. This overlay renders every root-to-leaf branch, marks the active
 * leaf and lists fork points. Data comes from main via GET_SESSION_TREE — the
 * renderer never parses JSONL or imports the Pi SDK.
 */
import { X } from 'lucide-solid'
import {
  type Component,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import type { Branch, TreeEntryNode } from '../../lib/ipc'

export interface SessionMapProps {
  sessionPath: string
  onClose: () => void
  /** True when the conversation has this entry loaded, so jumping to it will land somewhere. */
  isEntryLoaded: (entryId: string) => boolean
  onNavigate: (entryId: string) => void
}

/** Only message entries get a row in the conversation; the rest are metadata. */
function isNavigable(node: TreeEntryNode): boolean {
  return node.type === 'message'
}

const NODE_LABELS: Record<TreeEntryNode['type'], string> = {
  message: 'Message',
  compaction: 'Compaction',
  branch_summary: 'Branch summary',
  label: 'Label',
  model_change: 'Model',
  session_info: 'Name',
  thinking_level_change: 'Thinking',
}

function nodeLabel(node: TreeEntryNode): string {
  if (node.type === 'message') return node.role === 'user' ? 'You' : 'Assistant'
  return NODE_LABELS[node.type]
}

/** First field that carries something readable, so every entry type shows a line. */
function nodeDetail(node: TreeEntryNode): string {
  if (node.contentPreview) return node.contentPreview
  if (node.summary) return node.summary
  if (node.name) return node.name
  if (node.modelId) return node.modelId
  if (node.tokensBefore !== undefined) return `${node.tokensBefore.toLocaleString()} tokens before`
  return ''
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function BranchCard(props: {
  branch: Branch
  position: number
  activeLeafId: string | null
  /** Index of this branch's first node in the flattened node list. */
  nodeOffset: number
  cursor: number
  onFocusNode: (index: number) => void
  onActivateNode: (node: TreeEntryNode) => void
}) {
  const isActive = () => props.branch.leafId === props.activeLeafId

  return (
    <section class={`session-map-branch${isActive() ? ' is-active' : ''}`}>
      <header class="session-map-branch-header">
        <span class="session-map-branch-name">Branch {props.position}</span>
        <span class="session-map-branch-count">
          {countLabel(props.branch.nodes.length, 'entry', 'entries')}
        </span>
        <Show when={isActive()}>
          <span class="session-map-branch-current">current</span>
        </Show>
      </header>
      <ol class="session-map-nodes">
        <For each={props.branch.nodes}>
          {(node, index) => {
            const flatIndex = () => props.nodeOffset + index()
            return (
              <li>
                <button
                  type="button"
                  data-map-idx={flatIndex()}
                  class={`session-map-node is-${node.type}${
                    node.id === props.activeLeafId ? ' is-leaf' : ''
                  }${flatIndex() === props.cursor ? ' is-cursor' : ''}`}
                  aria-current={flatIndex() === props.cursor ? 'true' : undefined}
                  onMouseEnter={() => props.onFocusNode(flatIndex())}
                  onClick={() => props.onActivateNode(node)}
                >
                  <span class="session-map-node-type">{nodeLabel(node)}</span>
                  <span class="session-map-node-detail">{nodeDetail(node)}</span>
                </button>
              </li>
            )
          }}
        </For>
      </ol>
    </section>
  )
}

export const SessionMap: Component<SessionMapProps> = (props) => {
  const [tree] = createResource(
    () => props.sessionPath,
    (sessionPath) => window.openpi.getSessionTree(sessionPath)
  )
  // Reading the resource accessor re-throws its error, so the error state is
  // read first and the rest of the component only ever sees loaded data.
  const data = () => (tree.error ? null : (tree() ?? null))
  const branchCount = () => data()?.branches.length ?? 0
  const forkCount = () => data()?.forkPoints.length ?? 0

  // Branches are rendered in order, so a flat index addresses every node.
  const nodes = createMemo(() => data()?.branches.flatMap((branch) => branch.nodes) ?? [])
  const branchOffsets = createMemo(() => {
    const offsets: number[] = []
    let offset = 0
    for (const branch of data()?.branches ?? []) {
      offsets.push(offset)
      offset += branch.nodes.length
    }
    return offsets
  })
  const [cursor, setCursor] = createSignal(0)
  const [notice, setNotice] = createSignal<string | null>(null)
  let listRef: HTMLDivElement | undefined

  // Start on the leaf the session is actually at, not on the first entry.
  createEffect(() => {
    const activeLeafId = data()?.activeLeafId
    const index = nodes().findIndex((node) => node.id === activeLeafId)
    if (index >= 0) setCursor(index)
  })

  createEffect(() => {
    const index = cursor()
    listRef?.querySelector(`[data-map-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  const activate = (node: TreeEntryNode) => {
    if (!isNavigable(node)) {
      setNotice('This entry has no message in the conversation.')
      return
    }
    if (!props.isEntryLoaded(node.id)) {
      setNotice(
        'Not loaded in the conversation yet — scroll back in the chat to load older history.'
      )
      return
    }
    props.onNavigate(node.id)
    props.onClose()
  }

  const moveCursor = (next: number) => {
    const total = nodes().length
    if (total === 0) return
    setCursor(Math.max(0, Math.min(next, total - 1)))
    setNotice(null)
  }

  onMount(() => {
    // Capture phase: the overlay owns Escape while it is open, including when
    // focus sits outside it (the composer keeps focus when the map opens).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onClose()
        return
      }
      const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
        moveCursor(cursor() + step)
        return
      }
      if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        moveCursor(event.key === 'Home' ? 0 : nodes().length - 1)
        return
      }
      if (event.key === 'Enter') {
        const node = nodes()[cursor()]
        if (!node) return
        event.preventDefault()
        activate(node)
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    onCleanup(() => document.removeEventListener('keydown', onKeyDown, true))
  })

  return (
    <div class="session-map" role="dialog" aria-modal="true" aria-label="Session map">
      <div class="session-map-shell">
        <header class="session-map-header">
          <div>
            <h2 class="session-map-title">Session map</h2>
            <p class="session-map-meta">
              {countLabel(branchCount(), 'branch', 'branches')} ·{' '}
              {countLabel(forkCount(), 'fork', 'forks')}
            </p>
            <Show when={notice()}>
              <p class="session-map-notice">{notice()}</p>
            </Show>
          </div>
          <button
            type="button"
            class="session-map-close"
            aria-label="Close session map"
            onClick={() => props.onClose()}
          >
            <X size={14} />
          </button>
        </header>

        <Show when={tree.loading}>
          <div class="session-map-empty">Loading session tree…</div>
        </Show>
        <Show when={tree.error}>
          <div class="session-map-empty">Could not load the session tree.</div>
        </Show>
        <Show when={data()}>
          {(payload) => (
            <Show
              when={payload().branches.length > 0}
              fallback={<div class="session-map-empty">This session has no entries yet.</div>}
            >
              <div class="session-map-branches" ref={listRef}>
                <For each={payload().branches}>
                  {(branch, index) => (
                    <BranchCard
                      branch={branch}
                      position={index() + 1}
                      activeLeafId={payload().activeLeafId}
                      nodeOffset={branchOffsets()[index()] ?? 0}
                      cursor={cursor()}
                      onFocusNode={(nodeIndex) => {
                        setCursor(nodeIndex)
                        setNotice(null)
                      }}
                      onActivateNode={activate}
                    />
                  )}
                </For>
              </div>
            </Show>
          )}
        </Show>
      </div>
    </div>
  )
}
