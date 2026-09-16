/**
 * remote/handlers — the P0 remote handlers bound to desktop read models.
 *
 * Every handler here is read-only except the two gate endpoints, and the gate
 * endpoints carry no decision logic of their own: they decode the body, clamp
 * approvedIndexes against the gate's hunk payload (the same rule the desktop
 * parseReviewAnswer applies: out-of-range or non-integer entries become an
 * empty approval, never a partial one), and hand the decision to the registry.
 * First resolver — desktop or remote — wins; the loser gets 409/410.
 */

import type { SessionAuthDeps } from '../session/sessionAuth'
import type { SessionIndexStore } from '../session/sessionIndex'
import type { GateRegistry, GateSnapshot } from './gates'
import { gateDecisionSchema } from './protocol'
import { remoteSessionList, remoteSessionView, remoteTurnChanges } from './readModels'
import type { RemoteHandlers, RemoteRequestContext } from './server'

export interface RemoteHandlersDeps {
  auth: SessionAuthDeps
  sessionIndex: () => SessionIndexStore | null
  registry: GateRegistry
}

/** Handler results may carry an explicit status (404/400); plain values are 200. */
export type RemoteHandlerResult = { status: number; body: unknown } | object

export function createRemoteHandlers(deps: RemoteHandlersDeps): RemoteHandlers {
  const readDeps = { auth: deps.auth, sessionIndex: deps.sessionIndex }
  return {
    'session-list': async () => remoteSessionList(readDeps),
    session: async (context) => remoteSessionView(readDeps, context.params.id ?? ''),
    'turn-changes': async () => remoteTurnChanges(),
    gates: async () => ({ gates: deps.registry.pendingWithTokens() }),
    'gate-approve': async (context) => decideGate(deps.registry, context, true),
    'gate-deny': async (context) => decideGate(deps.registry, context, false),
  }
}

async function decideGate(
  registry: GateRegistry,
  context: RemoteRequestContext,
  approved: boolean
): Promise<RemoteHandlerResult> {
  const decoded = gateDecisionSchema.safeParse(context.body)
  if (!decoded.success) return { status: 400, body: { error: 'invalid_request' } }

  const id = context.params.id ?? ''
  const snapshot = registry.listPending().find((gate) => gate.id === id)
  const result = registry.resolveRemotely(id, decoded.data.gateToken, {
    approved,
    approvedIndexes: clampApprovedIndexes(snapshot, decoded.data.approvedIndexes),
  })

  if (result.ok) return { ok: true }
  // The design's status contract: a settled gate is a conflict (409); an
  // unknown id, a wrong token, or an expired gate are all gone (410).
  if (result.reason === 'already_resolved') {
    return { status: 409, body: { error: 'already_resolved' } }
  }
  return { status: 410, body: { error: result.reason } }
}

/**
 * Mirrors the desktop parseReviewAnswer: only integer indexes inside the
 * gate's hunk payload survive, deduplicated and sorted. Gates without a hunk
 * payload (confirm/input) accept no indexes at all.
 */
function clampApprovedIndexes(
  snapshot: GateSnapshot | undefined,
  approvedIndexes: number[] | undefined
): number[] | undefined {
  if (approvedIndexes === undefined) return undefined
  const hunks = (snapshot?.payload as { hunks?: unknown } | undefined)?.hunks
  const count = Array.isArray(hunks) ? hunks.length : 0
  const inRange = new Set<number>()
  for (const value of approvedIndexes) {
    if (Number.isInteger(value) && value >= 0 && value < count) inRange.add(value)
  }
  return [...inRange].sort((a, b) => a - b)
}
