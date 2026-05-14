import { Check, Copy, FolderOpen, Search, ShieldAlert } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { CustomizationItem } from '../../lib/ipc'

type ExtensionsPaneProps = {
  items: CustomizationItem[]
  loading: boolean
}

type ExtensionFilter = 'all' | 'project' | 'user' | 'package'

type ExtensionGroup = {
  id: ExtensionFilter | 'other'
  label: string
  description: string
  items: CustomizationItem[]
}

const FILTER_LABELS: Record<ExtensionFilter, string> = {
  all: 'All',
  project: 'Project',
  user: 'Global',
  package: 'Package',
}

function classifyExtension(item: CustomizationItem): ExtensionGroup['id'] {
  if (item.origin === 'package') return 'package'
  if (item.scope === 'project') return 'project'
  if (item.scope === 'user') return 'user'
  return 'other'
}

function groupMeta(id: ExtensionGroup['id']): Pick<ExtensionGroup, 'label' | 'description'> {
  switch (id) {
    case 'project':
      return {
        label: 'Project extensions',
        description:
          'Auto-discovered from .pi/extensions/*.ts or .pi/extensions/*/index.ts in this workspace.',
      }
    case 'user':
      return {
        label: 'Global extensions',
        description: 'Loaded from ~/.pi/agent/extensions and shared across workspaces.',
      }
    case 'package':
      return {
        label: 'Package extensions',
        description: 'Provided by installed Pi packages or package manifests.',
      }
    default:
      return {
        label: 'Configured extensions',
        description: 'Loaded from settings.json paths, CLI additions, or other configured sources.',
      }
  }
}

function shortenPath(value: string | null | undefined): string {
  if (!value) return 'No path available'
  return value.replace(/^\/Users\/[^/]+\//, '~/')
}

function copyTarget(item: CustomizationItem): string | null {
  return item.path ?? item.packageSource ?? item.source ?? null
}

function formatModifiedAt(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function ExtensionCard(props: { item: CustomizationItem }) {
  const [copied, setCopied] = createSignal(false)
  const displayPath = () => copyTarget(props.item)

  const copyPath = () => {
    const value = displayPath()
    if (!value) return
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <article class="extension-card">
      <div class="extension-card-body">
        <div class="extension-card-title-row">
          <h3>{props.item.name}</h3>
          <div class="resource-provenance-chips">
            <span class={`resource-risk-chip risk-${props.item.riskLevel ?? 'low'}`}>
              {props.item.riskLevel ?? 'low'} risk
            </span>
            <span class="resource-scope-chip">{props.item.scope}</span>
          </div>
          <button
            type="button"
            class={`extension-copy-btn${copied() ? ' is-copied' : ''}`}
            onClick={copyPath}
            title="Copy extension path"
            aria-label={`Copy ${props.item.name} extension path`}
          >
            <Show when={copied()} fallback={<Copy size={13} />}>
              <Check size={13} />
            </Show>
          </button>
        </div>

        <p class="extension-card-description">
          {props.item.description ||
            'TypeScript extension module that can register tools, commands, event hooks, and custom UI.'}
        </p>

        <div class="extension-card-path" title={displayPath() ?? undefined}>
          <FolderOpen size={13} />
          <span>{shortenPath(displayPath())}</span>
        </div>
        <Show when={formatModifiedAt(props.item.lastModifiedAt)}>
          {(modified) => <div class="resource-modified">Modified {modified()}</div>}
        </Show>
      </div>
    </article>
  )
}

export function ExtensionsPane(props: ExtensionsPaneProps) {
  const [filter, setFilter] = createSignal<ExtensionFilter>('all')
  const [query, setQuery] = createSignal('')

  const counts = createMemo(() => ({
    all: props.items.length,
    project: props.items.filter((item) => item.scope === 'project' && item.origin !== 'package')
      .length,
    user: props.items.filter((item) => item.scope === 'user' && item.origin !== 'package').length,
    package: props.items.filter((item) => item.origin === 'package').length,
  }))

  const filteredItems = createMemo(() => {
    let next = props.items
    if (filter() === 'project')
      next = next.filter((item) => item.scope === 'project' && item.origin !== 'package')
    if (filter() === 'user')
      next = next.filter((item) => item.scope === 'user' && item.origin !== 'package')
    if (filter() === 'package') next = next.filter((item) => item.origin === 'package')

    const search = query().trim().toLowerCase()
    if (!search) return next

    return next.filter((item) => {
      const haystack = [
        item.name,
        item.description,
        item.warning,
        item.path,
        item.source,
        item.packageSource,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(search)
    })
  })

  const groups = createMemo<ExtensionGroup[]>(() => {
    const byId = new Map<ExtensionGroup['id'], CustomizationItem[]>()
    for (const item of filteredItems()) {
      const id = classifyExtension(item)
      const groupItems = byId.get(id) ?? []
      groupItems.push(item)
      byId.set(id, groupItems)
    }

    return (['project', 'user', 'package', 'other'] as ExtensionGroup['id'][])
      .filter((id) => byId.has(id))
      .map((id) => ({
        id,
        ...groupMeta(id),
        items: byId.get(id) ?? [],
      }))
  })

  return (
    <div class="extension-pane">
      <section class="extension-hero" aria-labelledby="extension-hero-title">
        <div class="extension-hero-main">
          <p class="extension-kicker">Pi extensions</p>
          <h2 id="extension-hero-title">TypeScript modules with runtime authority</h2>
          <p>
            Extensions can register LLM tools, slash commands, lifecycle hooks, providers, and
            custom UI. They run with full Node permissions, so review source before enabling trust
            and runtime controls.
          </p>
        </div>
      </section>

      <section class="extension-security-note" aria-label="Extension security note">
        <ShieldAlert size={14} />
        <p>
          Review source before enabling: extensions may execute shell commands, read files, mutate
          tool calls, intercept prompts, and prompt users through <code>ctx.ui</code>.
        </p>
      </section>

      <div class="extension-toolbar">
        <div class="extension-filter-tabs" role="tablist" aria-label="Extension scope filter">
          <For each={['all', 'project', 'user', 'package'] as ExtensionFilter[]}>
            {(entry) => (
              <button
                type="button"
                class={`extension-filter-tab${filter() === entry ? ' is-active' : ''}`}
                onClick={() => setFilter(entry)}
                role="tab"
                aria-selected={filter() === entry}
              >
                <span>{FILTER_LABELS[entry]}</span>
                <span class="extension-filter-count">{counts()[entry]}</span>
              </button>
            )}
          </For>
        </div>

        <label class="extension-search-wrap">
          <Search size={13} />
          <input
            class="extension-search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search extension, path…"
            aria-label="Search extensions"
          />
        </label>
      </div>

      <Show
        when={!props.loading}
        fallback={<div class="extension-empty">Scanning Pi extension directories…</div>}
      >
        <Show
          when={filteredItems().length > 0}
          fallback={
            <div class="extension-empty">
              {props.items.length === 0
                ? 'No extensions discovered. Add TypeScript modules to ~/.pi/agent/extensions or .pi/extensions.'
                : 'No extensions match the current filter.'}
            </div>
          }
        >
          <div class="extension-groups">
            <For each={groups()}>
              {(group) => (
                <section class="extension-group">
                  <div class="extension-group-head">
                    <div>
                      <h3>{group.label}</h3>
                      <p>{group.description}</p>
                    </div>
                    <span class="extension-group-count">{group.items.length}</span>
                  </div>
                  <div class="extension-group-list">
                    <For each={group.items}>{(item) => <ExtensionCard item={item} />}</For>
                  </div>
                </section>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  )
}
