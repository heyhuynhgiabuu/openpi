import {
  AlertTriangle,
  Check,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  ShieldAlert,
  Trash2,
} from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { CustomizationItem, CustomizationScope, PackageOperationRequest } from '../../lib/ipc'

type PkgSourceType = 'npm' | 'git' | 'local'
type PackageScope = PackageOperationRequest['scope']

interface ParsedPkg {
  sourceType: PkgSourceType
  displayName: string
  version: string | null
  ref: string | null
  isPinned: boolean
  externalUrl: string | null
  installCmd: string
}

function parseNpmSpec(spec: string): { pkgName: string; version: string | null } {
  if (spec.startsWith('@')) {
    const secondAt = spec.indexOf('@', 1)
    if (secondAt === -1) return { pkgName: spec, version: null }
    return { pkgName: spec.slice(0, secondAt), version: spec.slice(secondAt + 1) }
  }
  const atIdx = spec.indexOf('@')
  if (atIdx === -1) return { pkgName: spec, version: null }
  return { pkgName: spec.slice(0, atIdx), version: spec.slice(atIdx + 1) }
}

function parsePackage(name: string): ParsedPkg {
  if (name.startsWith('npm:')) {
    const spec = name.slice(4)
    const { pkgName, version } = parseNpmSpec(spec)
    return {
      sourceType: 'npm',
      displayName: pkgName,
      version,
      ref: null,
      isPinned: version !== null,
      externalUrl: `https://www.npmjs.com/package/${pkgName}`,
      installCmd: `pi install ${name}`,
    }
  }

  if (
    name.startsWith('git:') ||
    name.startsWith('https://') ||
    name.startsWith('http://') ||
    name.startsWith('ssh://') ||
    name.startsWith('git@')
  ) {
    const raw = name.startsWith('git:') ? name.slice(4) : name
    const gitAtIdx = raw.startsWith('git@') ? raw.indexOf(':', 4) : -1
    const searchFrom = gitAtIdx > -1 ? gitAtIdx : 0
    const lastAt = raw.lastIndexOf('@')
    const refCutoff = lastAt > searchFrom ? lastAt : -1
    const ref = refCutoff > -1 ? raw.slice(refCutoff + 1) : null
    const repoRaw = ref ? raw.slice(0, refCutoff) : raw

    const displayName = repoRaw
      .replace(/^https?:\/\//, '')
      .replace(/^git@([^:]+):/, '$1/')
      .replace(/^ssh:\/\/git@[^/]+\//, '')
      .replace(/\.git$/, '')

    let externalUrl: string | null = null
    if (displayName.includes('github.com')) externalUrl = `https://${displayName}`
    else if (repoRaw.startsWith('https://')) externalUrl = repoRaw

    return {
      sourceType: 'git',
      displayName,
      version: null,
      ref,
      isPinned: ref !== null,
      externalUrl,
      installCmd: `pi install ${name}`,
    }
  }

  if (name.startsWith('/') || name.startsWith('./') || name.startsWith('../')) {
    return {
      sourceType: 'local',
      displayName: name,
      version: null,
      ref: null,
      isPinned: false,
      externalUrl: null,
      installCmd: `pi install ${name}`,
    }
  }

  const { pkgName, version } = parseNpmSpec(name)
  return {
    sourceType: 'npm',
    displayName: pkgName,
    version,
    ref: null,
    isPinned: version !== null,
    externalUrl: `https://www.npmjs.com/package/${pkgName}`,
    installCmd: `pi install npm:${name}`,
  }
}

function normalizeInstallSource(value: string): string {
  const source = value.trim()
  if (
    source.startsWith('npm:') ||
    source.startsWith('git:') ||
    source.startsWith('https://') ||
    source.startsWith('http://') ||
    source.startsWith('ssh://') ||
    source.startsWith('git://') ||
    source.startsWith('git@') ||
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../')
  ) {
    return source
  }
  return `npm:${source}`
}

function shortenPath(p: string | null): string {
  if (!p) return ''
  return p.replace(/^\/Users\/[^/]+\//, '~/')
}

function formatModifiedAt(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

type ScopeFilter = 'all' | 'user' | 'project'

const SCOPE_LABELS: Record<ScopeFilter, string> = { all: 'All', user: 'Global', project: 'Project' }

const DISPLAY_SCOPE: Record<CustomizationScope, string> = {
  user: 'Global',
  project: 'Project',
  temporary: 'Temp',
}

const SOURCE_LABELS: Record<PkgSourceType, string> = {
  npm: 'npm packages',
  git: 'git packages',
  local: 'local packages',
}

const SOURCE_ORDER: PkgSourceType[] = ['npm', 'git', 'local']

interface ParsedEntry {
  item: CustomizationItem
  parsed: ParsedPkg
}

function PackageCard(props: {
  entry: ParsedEntry
  removing: boolean
  onRemove: (entry: ParsedEntry) => void
}) {
  const [copied, setCopied] = createSignal(false)

  const copyInstall = () => {
    void navigator.clipboard.writeText(props.entry.parsed.installCmd).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const openExternal = () => {
    if (props.entry.parsed.externalUrl)
      void window.openpi.openExternal(props.entry.parsed.externalUrl)
  }

  return (
    <article class="pkg-card">
      <div class="pkg-card-inner">
        <div class="pkg-card-body">
          <div class="pkg-card-nameline">
            <span class="pkg-card-name">{props.entry.parsed.displayName}</span>
            <Show
              when={
                props.entry.parsed.isPinned &&
                (props.entry.parsed.version ?? props.entry.parsed.ref)
              }
              fallback={<span class="pkg-float-chip">latest</span>}
            >
              <span class="pkg-pin-chip">
                {props.entry.parsed.version ?? props.entry.parsed.ref}
              </span>
            </Show>
            <span class="pkg-scope-chip">{DISPLAY_SCOPE[props.entry.item.scope]}</span>
            <span class={`resource-risk-chip risk-${props.entry.item.riskLevel ?? 'medium'}`}>
              {props.entry.item.riskLevel ?? 'medium'} risk
            </span>
            <Show when={!props.entry.item.enabled}>
              <span class="pkg-disabled-chip">disabled</span>
            </Show>
          </div>

          <Show when={props.entry.item.path}>
            <div class="pkg-card-path">{shortenPath(props.entry.item.path)}</div>
          </Show>
          <Show when={formatModifiedAt(props.entry.item.lastModifiedAt)}>
            {(modified) => <div class="resource-modified">Modified {modified()}</div>}
          </Show>

          <Show when={props.entry.item.warning}>
            <div class="pkg-card-warning">
              <AlertTriangle size={12} />
              <span>{props.entry.item.warning}</span>
            </div>
          </Show>
        </div>

        <div class="pkg-card-actions">
          <Show when={props.entry.parsed.externalUrl}>
            <button
              type="button"
              class="pkg-action-btn"
              onClick={openExternal}
              title="Open source"
              aria-label="Open package source"
              disabled={props.removing}
            >
              <ExternalLink size={13} />
            </button>
          </Show>
          <button
            type="button"
            class={`pkg-action-btn${copied() ? ' is-copied' : ''}`}
            onClick={copyInstall}
            title="Copy install command"
            aria-label="Copy install command"
            disabled={props.removing}
          >
            <Show when={copied()} fallback={<Copy size={13} />}>
              <Check size={13} />
            </Show>
          </button>
          <button
            type="button"
            class="pkg-action-btn pkg-action-danger"
            onClick={() => props.onRemove(props.entry)}
            title="Remove package"
            aria-label={`Remove ${props.entry.item.name}`}
            disabled={props.removing}
          >
            <Show when={props.removing} fallback={<Trash2 size={13} />}>
              <Loader2 size={13} class="spin" />
            </Show>
          </button>
        </div>
      </div>
    </article>
  )
}

function SourceGroup(props: {
  type: PkgSourceType
  entries: ParsedEntry[]
  removingId: string | null
  onRemove: (entry: ParsedEntry) => void
}) {
  return (
    <div class="pkg-group-box">
      <div class="pkg-group-header">
        <span class="pkg-group-label">{SOURCE_LABELS[props.type]}</span>
        <span class="pkg-group-count">
          {props.entries.length} {props.entries.length === 1 ? 'package' : 'packages'}
        </span>
      </div>

      <div class="pkg-group-rows">
        <For each={props.entries}>
          {(entry) => (
            <PackageCard
              entry={entry}
              removing={props.removingId === entry.item.id}
              onRemove={props.onRemove}
            />
          )}
        </For>
      </div>
    </div>
  )
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
            placeholder="npm:pi-subagents"
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
