/**
 * One root-to-leaf branch of the session tree, drawn as a list of entries.
 *
 * SessionMap owns the tree data, the cursor and the filtering; this file only
 * knows how to render a single branch and label an entry.
 */
import { For, Show } from 'solid-js'
import type { TreeEntryNode } from '../../lib/ipc'

export interface VisibleBranch {
  /** Leaf entry id — marks the branch the session is currently on. */
  leafId: string
  /** 1-based position in the unfiltered branch list, so labels stay stable. */
  position: number
  /** Index of this branch's first node in the flattened, filtered node list. */
  offset: number
  nodes: TreeEntryNode[]
}

export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Only message entries get a row in the conversation; the rest are metadata. */
export function isNavigable(node: TreeEntryNode): boolean {
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

export function nodeLabel(node: TreeEntryNode): string {
  if (node.type === 'message') return node.role === 'user' ? 'You' : 'Assistant'
  return NODE_LABELS[node.type]
}

/** First field that carries something readable, so every entry type shows a line. */
export function nodeDetail(node: TreeEntryNode): string {
  if (node.contentPreview) return node.contentPreview
  if (node.summary) return node.summary
  if (node.name) return node.name
  if (node.modelId) return node.modelId
  if (node.tokensBefore !== undefined) return `${node.tokensBefore.toLocaleString()} tokens before`
  return ''
}

export function BranchCard(props: {
  branch: VisibleBranch
  activeLeafId: string | null
  cursor: number
  onFocusNode: (index: number) => void
  onActivateNode: (node: TreeEntryNode) => void
}) {
  const isActive = () => props.branch.leafId === props.activeLeafId

  return (
    <section class={`session-map-branch${isActive() ? ' is-active' : ''}`}>
      <header class="session-map-branch-header">
        <span class="session-map-branch-name">Branch {props.branch.position}</span>
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
            const flatIndex = () => props.branch.offset + index()
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
