/**
 * remote/readModels — read-only session models for the remote surface.
 *
 * The remote client is an untrusted renderer: it gets the same read models the
 * desktop renderer gets, through one authorization path. Session paths are
 * re-entered through authorizedSessionPath (allowlist of anchored roots), so a
 * captured or guessed id outside the active authorization is 404 — deny-only.
 * The `:id` segment is treated as final here: no re-decode, no path.join
 * before authorization (see allowlist.ts).
 */

import path from 'node:path'
import type { AgentReviewSummary, SessionListItem } from '../../src/lib/ipc'
import { getAgentReviewSummary } from '../services/agentReviewStore'
import { authorizedSessionPath, type SessionAuthDeps } from '../session/sessionAuth'
import type { SessionIndexStore } from '../session/sessionIndex'
import { buildSessionTrajectory } from '../session/sessionTrajectory'
import type { RemoteSessionView } from './protocol'

export interface RemoteReadModelDeps {
  auth: SessionAuthDeps
  sessionIndex: () => SessionIndexStore | null
}

/** GET /api/session-list — the desktop's index, workspace-grouped by the client. */
export function remoteSessionList(deps: RemoteReadModelDeps): { sessions: SessionListItem[] } {
  const index = deps.sessionIndex()
  if (!index) return { sessions: [] }
  const sessions = index.listSessions({}, undefined, undefined)
  return { sessions }
}

/**
 * GET /api/session/:id — the trajectory of one session.
 * The id is an opaque token: authorization resolves it to a session file under
 * an anchored root, or the route answers 404 with no distinction between
 * unknown and unauthorized.
 */
export function remoteSessionView(
  deps: RemoteReadModelDeps,
  sessionId: string
): { status: 200; body: RemoteSessionView } | { status: 404; body: { error: string } } {
  const resolved = resolveSessionPath(deps, sessionId)
  if (!resolved) return { status: 404, body: { error: 'not_found' } }
  try {
    return {
      status: 200,
      body: {
        sessionPath: resolved,
        trajectory: buildSessionTrajectory(resolved),
      },
    }
  } catch {
    return { status: 404, body: { error: 'not_found' } }
  }
}

function resolveSessionPath(deps: RemoteReadModelDeps, id: string): string | null {
  // The id is a session-file stem: scan the anchored roots for `<id>.jsonl`
  // and authorize the hit. Nothing outside the roots can match, and the
  // allowlist's segment guard has already rejected separators and traversal,
  // so the id cannot smuggle a path.
  const agentDir = deps.auth.getAgentDir()
  const roots = [path.join(agentDir, 'sessions')]
  const workspace = deps.auth.activeWorkspacePath()
  if (workspace) roots.push(path.join(workspace, '.pi', 'artifacts'))
  for (const root of roots) {
    try {
      return authorizedSessionPath(deps.auth, path.join(root, `${id}.jsonl`))
    } catch {
      continue
    }
  }
  return null
}

/** GET /api/turn-changes — the review snapshot summary, read-only. */
export function remoteTurnChanges(): AgentReviewSummary {
  return getAgentReviewSummary()
}
