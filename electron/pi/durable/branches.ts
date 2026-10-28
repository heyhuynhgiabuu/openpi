import type { Context } from '@earendil-works/chord'
import type { Conversation, Harness } from '@earendil-works/pi-durable'
import { readHistory } from './history'
import type { SessionFileHeader } from './sessionFile'
import { BRANCH_KIND } from './sessionItems'
import { findLine, isBranchMarker, leafOf, placeTree, type Placed } from './sessionTree'
import type { DurableNavigation } from './types'

/**
 * Phase 8.3q: the conversations that make up one session.
 *
 * A session starts as one conversation. `navigate_tree` moves it to an earlier point by forking the
 * conversation there and continuing in the fork, so the abandoned branch stays in the store and in
 * the exported tree. `branches` lists them, oldest first, the active one last.
 */

/** The branch the session is on: the last. */
export function activeBranch(branches: readonly Conversation[]): Conversation {
  const active = branches.at(-1)
  if (!active) throw new Error('the session has no conversation')
  return active
}

/** Every branch's whole history, in the order the exported tree is built. */
export function readAll(branches: readonly Conversation[], context: Context) {
  return Promise.all(branches.map((branch) => readHistory(branch, context)))
}

async function locate(
  branches: readonly Conversation[],
  header: SessionFileHeader,
  lineId: string,
  action: 'fork' | 'navigate',
  context: Context
): Promise<{ placed: Placed[]; target: Placed }> {
  const placed = placeTree(header, await readAll(branches, context))
  const target = findLine(placed, lineId, action)
  if (!target) {
    // The SDK's own wording for each.
    throw new Error(
      action === 'fork' ? `Cannot fork: entry not found (${lineId})` : `Entry ${lineId} not found`
    )
  }
  return { placed, target }
}

/** The newest branch whose history contains the line, which is what a fork there continues. */
function branchHolding(branches: readonly Conversation[], line: Placed): Conversation {
  const index = Math.max(...line.histories)
  const branch = branches[index]
  if (!branch) throw new Error('Cannot fork: the entry belongs to no known branch')
  return branch
}

/** Fork after the line a renderer id names, from whichever branch holds it. */
export async function forkAtLine(
  branches: readonly Conversation[],
  header: SessionFileHeader,
  lineId: string,
  context: Context
): Promise<Conversation> {
  const { target } = await locate(branches, header, lineId, 'fork', context)
  // The fork shares the entries up to and including the line and leaves its parent as it is.
  return branchHolding(branches, target).fork(
    target.item.source,
    { ownership: { kind: 'ownerless' } },
    context
  )
}

/** The line itself, or the nearest one before it that is a place to continue from. */
function placeAt(placed: readonly Placed[], line: Placed | undefined): Placed | undefined {
  let node = line
  while (node && isBranchMarker(node)) node = placed.find((other) => other.lineId === node?.parent)
  return node
}

/**
 * Move the session's leaf to the line, as the SDK's `navigateTree` does.
 *
 * A user message is not a place to continue from but a message to edit and send again, so the leaf
 * becomes the message before it and its text comes back for the composer; the first message has
 * nothing before it, and continuing from there starts a new root. Anything else becomes the leaf
 * itself. When the leaf is already there nothing changes, and no branch is made.
 */
export async function navigate(
  harness: Harness,
  branches: Conversation[],
  header: SessionFileHeader,
  lineId: string,
  context: Context
): Promise<DurableNavigation> {
  const { placed, target } = await locate(branches, header, lineId, 'navigate', context)
  const message = target.item.role === 'user' ? target : undefined
  const leaf = placeAt(
    placed,
    message ? placed.find((node) => node.lineId === target.parent) : target
  )
  const current = leafOf(placed, branches.length - 1)
  const outcome: DurableNavigation = { switched: false, leafLineId: leaf?.lineId ?? null }
  if (message?.item.text !== undefined) outcome.editorText = message.item.text
  if ((leaf?.lineId ?? null) === (current?.lineId ?? null)) return outcome

  const active = activeBranch(branches)
  const next = leaf
    ? await branchHolding(branches, leaf).fork(
        leaf.item.source,
        { ownership: { kind: 'ownerless' } },
        context
      )
    : // Nothing before the first message: a conversation of its own.
      await harness.createConversation({ ownership: { kind: 'ownerless' } }, context)
  // A fork carries the agent settings as they were at its fork point, but navigating leaves the
  // model and thinking level alone, as the SDK does: keep what the session is using now.
  const { model, thinkingLevel } = await active.agent(context)
  await next.configure(model ? { model, thinkingLevel } : { thinkingLevel }, context)
  // The branch's first entry: it puts the file's last line on this branch, so a reader that takes
  // the last line as the leaf (a reload, the SDK) is where the session is, before any message.
  const marker = await next.submit(
    { type: 'write', entry: { kind: BRANCH_KIND, data: { at: leaf?.lineId ?? null } } },
    context
  )
  await marker.wait(context)
  branches.push(next)
  outcome.switched = true
  return outcome
}
