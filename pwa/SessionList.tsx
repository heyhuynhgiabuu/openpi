/**
 * pwa/SessionList — the read-only session index, grouped by workspace.
 */
import { For, Show, createResource } from 'solid-js'
import { api, type RemoteSessionItem } from './api'

export function SessionList() {
  const [sessions, { refetch }] = createResource(api.sessionList)

  const grouped = (): Array<[string, RemoteSessionItem[]]> => {
    const byWorkspace = new Map<string, RemoteSessionItem[]>()
    for (const session of sessions()?.sessions ?? []) {
      const list = byWorkspace.get(session.workspacePath) ?? []
      list.push(session)
      byWorkspace.set(session.workspacePath, list)
    }
    return [...byWorkspace.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }

  return (
    <div>
      <div class="row">
        <h1>Sessions</h1>
        <button class="secondary" onClick={() => void refetch()}>
          Refresh
        </button>
      </div>
      <Show when={!sessions.loading && sessions.error}>
        <p class="error">Could not load sessions.</p>
      </Show>
      <For each={grouped()}>
        {([workspace, items]) => (
          <div>
            <h2>{workspace.split('/').pop() || workspace}</h2>
            <For each={items}>
              {(session) => (
                <div class="card">
                  <div class="row">
                    <strong>{session.title}</strong>
                    <span class="badge">{session.lastModel || 'unknown model'}</span>
                  </div>
                  <div class="muted">
                    {new Date(session.updatedAt).toLocaleString()}
                    {session.cost > 0 ? ` · $${session.cost.toFixed(3)}` : ''}
                  </div>
                </div>
              )}
            </For>
          </div>
        )}
      </For>
      <Show when={(sessions()?.sessions ?? []).length === 0 && !sessions.loading}>
        <p class="muted">No sessions yet.</p>
      </Show>
    </div>
  )
}
