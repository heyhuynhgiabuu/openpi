/**
 * pwa/api — the PWA's only door to the remote server.
 *
 * Every call carries the paired device token from localStorage; responses are
 * parsed defensively (the phone treats the server as untrusted data too).
 * Nothing here is desktop code: plain fetch against same-origin /api routes.
 */

const TOKEN_KEY = 'openpi-remote-token'

export function storedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Private-mode storage failures surface as an immediate 401 on next use.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to recover.
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string
  ) {
    super(`API ${status}: ${code}`)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = storedToken()
  if (!token) throw new ApiError(401, 'no_token')
  const response = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  })
  if (response.status === 401) {
    clearToken()
    throw new ApiError(401, 'unauthorized')
  }
  if (!response.ok) {
    let code = 'error'
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body.error === 'string') code = body.error
    } catch {
      // Non-JSON error body; keep the generic code.
    }
    throw new ApiError(response.status, code)
  }
  return (await response.json()) as T
}

export interface RemoteGate {
  id: string
  kind: 'confirm' | 'input'
  title: string
  summary: string
  payload?: unknown
  createdAt: number
  expiresAt: number
  gateToken: string
}

export interface RemoteSessionItem {
  path: string
  title: string
  workspacePath: string
  workspaceName: string
  updatedAt: string
  lastModel: string
  cost: number
}

export const api = {
  pair: async (code: string, name: string): Promise<{ deviceToken: string }> => {
    const response = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, name }),
    })
    if (!response.ok) {
      let code_ = 'error'
      try {
        const body = (await response.json()) as { error?: unknown }
        if (typeof body.error === 'string') code_ = body.error
      } catch {
        // Keep generic.
      }
      throw new ApiError(response.status, code_)
    }
    return (await response.json()) as { deviceToken: string }
  },
  sessionList: () => request<{ sessions: RemoteSessionItem[] }>('/api/session-list'),
  gates: () => request<{ gates: RemoteGate[] }>('/api/gates'),
  turnChanges: () =>
    request<{
      changes: Array<{ path: string; status: string; totalAdded: number; totalRemoved: number }>
    }>('/api/turn-changes'),
  decideGate: (
    id: string,
    approve: boolean,
    gateToken: string,
    approvedIndexes?: number[]
  ): Promise<unknown> =>
    request(`/api/gates/${encodeURIComponent(id)}/${approve ? 'approve' : 'deny'}`, {
      method: 'POST',
      body: JSON.stringify(approvedIndexes ? { gateToken, approvedIndexes } : { gateToken }),
    }),
}
