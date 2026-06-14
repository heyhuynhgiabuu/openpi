import { Download, ExternalLink, Loader2, ShieldAlert } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { CustomizationItem, PackageOperationRequest } from '../../lib/ipc'
import type { ParsedEntry, PkgSourceType } from './packageHelpers'
import { DISPLAY_SCOPE, normalizeInstallSource, parsePackage, SOURCE_ORDER } from './packageHelpers'
import { SourceGroup } from './SourceGroup'

type PackageScope = PackageOperationRequest['scope']
type ScopeFilter = 'all' | 'user' | 'project'

const SCOPE_LABELS: Record<ScopeFilter, string> = {
  all: 'All',
  user: 'Global',
  project: 'Project',
}

type PackagesPaneProps = {
  items: CustomizationItem[]
  loading: boolean
  onReload: () => Promise<void>
  onError: (message: string) => void
}

export function PackagesPane(props: PackagesPaneProps) {
  const [scopeFilter, setScopeFilter] = createSignal<ScopeFilter>('all')
  const [search, setSearch] = createSignal('')
  const [installSource, setInstallSource] = createSignal('')
  const [installScope, setInstallScope] = createSignal<PackageScope>('user')
  const [installing, setInstalling] = createSignal(false)
  const [removingId, setRemovingId] = createSignal<string | null>(null)
  const [status, setStatus] = createSignal<string | null>(null)
  const [pendingInstall, setPendingInstall] = createSignal<{
    source: string
    scope: PackageScope
  } | null>(null)

  const allParsed = createMemo<ParsedEntry[]>(() =>
    props.items.map((item) => ({ item, parsed: parsePackage(item.name) }))
  )

  const counts = createMemo(() => ({
    all: props.items.length,
    user: props.items.filter((i) => i.scope === 'user').length,
    project: props.items.filter((i) => i.scope === 'project').length,
  }))

  const filtered = createMemo(() => {
    let list = allParsed()
    if (scopeFilter() !== 'all') list = list.filter((e) => e.item.scope === scopeFilter())
    if (search().trim()) {
      const q = search().toLowerCase()
      list = list.filter(
        (e) =>
          e.item.name.toLowerCase().includes(q) || e.parsed.displayName.toLowerCase().includes(q)
      )
    }
    return list
  })

  const groups = createMemo(() => {
    const byType = new Map<PkgSourceType, ParsedEntry[]>()
    for (const entry of filtered()) {
      const arr = byType.get(entry.parsed.sourceType) ?? []
      arr.push(entry)
      byType.set(entry.parsed.sourceType, arr)
    }
    return SOURCE_ORDER.filter((t) => byType.has(t)).map((t) => ({
      type: t,
      entries: byType.get(t) ?? [],
    }))
  })

  const performInstall = async () => {
    const pending = pendingInstall()
    const source = pending?.source ?? normalizeInstallSource(installSource())
    const scope = pending?.scope ?? installScope()
    if (!source) return
    setPendingInstall(null)

    setInstalling(true)
    setStatus(null)
    try {
      const result = await window.openpi.installPackage({ source, scope })
      if (!result.ok) {
        props.onError(result.output)
        setStatus(result.output)
        return
      }
      setInstallSource('')
      setStatus(result.output)
      await props.onReload()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      props.onError(message)
      setStatus(message)
    } finally {
      setInstalling(false)
    }
  }

  const submitInstall = (event: SubmitEvent) => {
    event.preventDefault()
    const source = normalizeInstallSource(installSource())
    if (!source) return

    // Show a confirmation dialog before installing — packages can contain
    // extensions that run with full system permissions.
    setPendingInstall({ source, scope: installScope() })
  }

  const removePackage = async (entry: ParsedEntry) => {
    if (entry.item.scope === 'temporary') return
    const label = `${entry.item.name} from ${DISPLAY_SCOPE[entry.item.scope]}`
    if (!window.confirm(`Remove ${label}?`)) return

    setRemovingId(entry.item.id)
    setStatus(null)
    try {
      const result = await window.openpi.removePackage({
        source: entry.item.source,
        scope: entry.item.scope,
      })
      if (!result.ok) {
        props.onError(result.output)
        setStatus(result.output)
        return
      }
      setStatus(result.output)
      await props.onReload()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      props.onError(message)
      setStatus(message)
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div class="pkg-pane">
      <div class="pkg-security-bar">
        <ShieldAlert size={14} class="pkg-security-icon" />
        <span>
          Extensions inside packages run with <strong>full system permissions</strong>. Review
          source code before enabling any third-party package.
        </span>
      </div>

      <form class="pkg-install-form" onSubmit={submitInstall}>
        <div class="pkg-install-copy">
          <span class="pkg-install-title">Install Pi package</span>
          <span class="pkg-install-hint">
            Accepts npm:, git:, URL, and local path sources. Bare names are installed as npm
            packages.
          </span>
        </div>
        <div class="pkg-install-controls">
          <input
            class="pkg-install-input"
            placeholder="npm:@marckrenn/pi-sub-core"
            value={installSource()}
            onInput={(e) => setInstallSource(e.currentTarget.value)}
            disabled={installing()}
            aria-label="Package source"
          />
          <select
            class="pkg-install-scope"
            value={installScope()}
            onChange={(e) => setInstallScope(e.currentTarget.value as PackageScope)}
            disabled={installing()}
            aria-label="Install scope"
          >
            <option value="user">Global</option>
            <option value="project">Project</option>
          </select>
          <button
            type="submit"
            class="pkg-install-btn"
            disabled={installing() || !installSource().trim()}
          >
            <Show when={installing()} fallback={<Download size={13} />}>
              <Loader2 size={13} class="spin" />
            </Show>
            Install
          </button>
        </div>
      </form>

      <Show when={status()}>{(message) => <div class="pkg-status">{message()}</div>}</Show>

      <Show when={pendingInstall()}>
        {(pending) => (
          <div class="pkg-install-confirm">
            <ShieldAlert size={14} class="pkg-security-icon" />
            <div class="pkg-install-confirm-body">
              <strong>Confirm package installation</strong>
              <p>
                <code>{pending().source}</code> will be installed in your{' '}
                <strong>{pending().scope === 'project' ? 'project' : 'global'}</strong> Pi
                configuration. Packages can provide extensions with{' '}
                <strong>full system permissions</strong>. Only install from sources you trust.
              </p>
              <div class="pkg-install-confirm-actions">
                <button
                  type="button"
                  class="pkg-confirm-btn pkg-confirm-btn-primary"
                  disabled={installing()}
                  onClick={() => void performInstall()}
                >
                  {installing() ? 'Installing…' : 'Install'}
                </button>
                <button
                  type="button"
                  class="pkg-confirm-btn"
                  disabled={installing()}
                  onClick={() => setPendingInstall(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </Show>

      <div class="pkg-toolbar">
        <div class="pkg-scope-tabs">
          <For each={['all', 'user', 'project'] as ScopeFilter[]}>
            {(scope) => (
              <button
                type="button"
                class={`pkg-scope-tab${scopeFilter() === scope ? ' is-active' : ''}`}
                onClick={() => setScopeFilter(scope)}
              >
                {SCOPE_LABELS[scope]}
                <span class="pkg-scope-count">{counts()[scope] ?? 0}</span>
              </button>
            )}
          </For>
        </div>
        <div class="pkg-toolbar-right">
          <input
            class="pkg-search"
            placeholder="Filter packages…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            aria-label="Filter packages"
          />
          <button
            type="button"
            class="pkg-gallery-btn"
            onClick={() => void window.openpi.openExternal('https://pi.dev/packages')}
            title="Browse Pi package gallery"
          >
            <ExternalLink size={12} />
            Gallery
          </button>
        </div>
      </div>

      <div class="pkg-groups">
        <Show
          when={!props.loading}
          fallback={<div class="pkg-empty">Scanning Pi resource directories…</div>}
        >
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="pkg-empty">
                <Show
                  when={props.items.length === 0}
                  fallback={<p>No packages match the current filter.</p>}
                >
                  <p>No packages installed.</p>
                  <p class="pkg-empty-hint">Install from the field above or browse the gallery.</p>
                </Show>
              </div>
            }
          >
            <For each={groups()}>
              {(group) => (
                <SourceGroup
                  type={group.type}
                  entries={group.entries}
                  removingId={removingId()}
                  onRemove={removePackage}
                />
              )}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={props.items.length > 0}>
        <div class="pkg-footer">
          <span class="pkg-footer-label">Examples:</span>
          <code class="pkg-footer-cmd">npm:@scope/pkg</code>
          <span class="pkg-footer-sep">·</span>
          <code class="pkg-footer-cmd">git:github.com/user/repo</code>
        </div>
      </Show>
    </div>
  )
}
