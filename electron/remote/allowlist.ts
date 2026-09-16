/**
 * remote/allowlist — the P0 security contract.
 *
 * Every remote request is matched against this table BEFORE anything else
 * happens. A method+path that does not match returns 501, never a silent ok.
 * Adding a route here is a security decision: read-only and gate-approval
 * only, per docs/decisions/2026-09-16-remote-monitoring-p0-design.md.
 *
 * Pattern segments starting with ':' capture one path segment. `auth` says
 * which credential the endpoint accepts: the one-time pairing code ('pairing')
 * or a paired device's bearer token ('bearer').
 */

export type RemoteHandlerId =
  | 'pair'
  | 'session-list'
  | 'session'
  | 'turn-changes'
  | 'gates'
  | 'gate-approve'
  | 'gate-deny'
  | 'events'

export interface RemoteRoute {
  method: 'GET' | 'POST'
  pattern: string
  handler: RemoteHandlerId
  auth: 'pairing' | 'bearer'
}

export const REMOTE_ROUTES: readonly RemoteRoute[] = [
  { method: 'POST', pattern: '/api/pair', handler: 'pair', auth: 'pairing' },
  { method: 'GET', pattern: '/api/session-list', handler: 'session-list', auth: 'bearer' },
  { method: 'GET', pattern: '/api/session/:id', handler: 'session', auth: 'bearer' },
  { method: 'GET', pattern: '/api/turn-changes', handler: 'turn-changes', auth: 'bearer' },
  { method: 'GET', pattern: '/api/gates', handler: 'gates', auth: 'bearer' },
  { method: 'POST', pattern: '/api/gates/:id/approve', handler: 'gate-approve', auth: 'bearer' },
  { method: 'POST', pattern: '/api/gates/:id/deny', handler: 'gate-deny', auth: 'bearer' },
  { method: 'GET', pattern: '/api/events', handler: 'events', auth: 'bearer' },
]

export interface RemoteRouteMatch {
  route: RemoteRoute
  params: Record<string, string>
}

/**
 * Matches a request against the allowlist. Null means "not allowlisted" — the
 * caller must answer 501 without touching any handler.
 */
export function matchRemoteRoute(method: string, pathname: string): RemoteRouteMatch | null {
  const requestSegments = pathname.split('/').filter((segment) => segment.length > 0)
  for (const route of REMOTE_ROUTES) {
    if (route.method !== method) continue
    const params = matchPattern(route.pattern, requestSegments)
    if (params) return { route, params }
  }
  return null
}

function matchPattern(pattern: string, requestSegments: string[]): Record<string, string> | null {
  const patternSegments = pattern.split('/').filter((segment) => segment.length > 0)
  if (patternSegments.length !== requestSegments.length) return null

  const params: Record<string, string> = {}
  for (let index = 0; index < patternSegments.length; index++) {
    const expected = patternSegments[index]
    const actual = requestSegments[index]
    if (expected.startsWith(':')) {
      const decoded = decodeSegment(actual)
      if (decoded === null || decoded === '') return null
      params[expected.slice(1)] = decoded
      continue
    }
    if (expected !== actual) return null
  }
  return params
}

function decodeSegment(segment: string): string | null {
  try {
    const decoded = decodeURIComponent(segment)
    // A captured segment stays an opaque id: never traversal, never a control
    // character (log injection), never a separator. Callers must also treat it
    // as final — no re-decoding, and no path.join before authorization.
    if (decoded === '' || decoded === '.' || decoded === '..') return null
    if (decoded.includes('/') || decoded.includes('\\')) return null
    for (const char of decoded) {
      const codePoint = char.codePointAt(0) ?? 0
      if (codePoint < 0x20 || codePoint === 0x7f) return null
    }
    return decoded
  } catch {
    return null
  }
}
