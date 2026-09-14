import { Check, Copy, FolderOpen, Search } from 'lucide-solid'
import { createMemo, createSignal, For, Show } from 'solid-js'
import type { CustomizationItem } from '../../lib/ipc'

type PromptsPaneProps = {
  items: CustomizationItem[]
  loading: boolean
}

type PromptFilter = 'all' | 'project' | 'user' | 'package'

type PromptGroup = {
  id: PromptFilter | 'other'
  label: string
  description: string
  items: CustomizationItem[]
}

const FILTER_LABELS: Record<PromptFilter, string> = {
  all: 'All',
  project: 'Project',
  user: 'Global',
  package: 'Package',
}

function classifyPrompt(item: CustomizationItem): PromptGroup['id'] {
  if (item.origin === 'package') return 'package'
  if (item.scope === 'project') return 'project'
  if (item.scope === 'user') return 'user'
  return 'other'
}

function groupMeta(id: PromptGroup['id']): Pick<PromptGroup, 'label' | 'description'> {
  switch (id) {
    case 'project':
      return {
        label: 'Project templates',
        description: 'Loaded from .pi/prompts/*.md for this workspace.',
      }
    case 'user':
      return {
        label: 'Global templates',
        description: 'Loaded from ~/.pi/agent/prompts/*.md across workspaces.',
      }
    case 'package':
      return {
        label: 'Package templates',
        description: 'Discovered from Pi package prompt directories or manifests.',
      }
    default:
      return {
        label: 'Other templates',
        description: 'Loaded from configured prompt paths or temporary sources.',
      }
  }
}

function shortenPath(value: string | null | undefined): string {
  if (!value) return 'No path available'
  return value.replace(/^\/Users\/[^/]+\//, '~/')
}

function commandName(item: CustomizationItem): string {
  return `/${item.name}`
}

function PromptCard(props: { item: CustomizationItem }) {
  const [copied, setCopied] = createSignal(false)
  const displayPath = () => props.item.path ?? props.item.packageSource ?? props.item.source
  const hint = () => props.item.argumentHint
  const command = () => `${commandName(props.item)}${hint() ? ` ${hint()}` : ''}`

  const copyCommand = () => {
    void navigator.clipboard.writeText(`${command()} `).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <article class="prompt-card">
      <div class="prompt-card-body">
        <div class="prompt-card-title-row">
          <h3>{props.item.name}</h3>
          <button
            type="button"
            class={`prompt-copy-btn${copied() ? ' is-copied' : ''}`}
            onClick={copyCommand}
            title="Copy slash command"
            aria-label={`Copy ${command()} command`}
          >
            <Show when={copied()} fallback={<Copy size={13} />}>
              <Check size={13} />
            </Show>
          </button>
        </div>

        <p class="prompt-card-description">
          {props.item.description ||
            'No description frontmatter; Pi will fall back to the first non-empty line.'}
        </p>

        <div class="prompt-card-path" title={displayPath() ?? undefined}>
          <FolderOpen size={13} />
          <span>{shortenPath(displayPath())}</span>
        </div>
      </div>
    </article>
  )
}

export function PromptsPane(props: PromptsPaneProps) {
  const [filter, setFilter] = createSignal<PromptFilter>('all')
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
        item.argumentHint,
        item.description,
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

  const groups = createMemo<PromptGroup[]>(() => {
    const byId = new Map<PromptGroup['id'], CustomizationItem[]>()
    for (const item of filteredItems()) {
      const id = classifyPrompt(item)
      const groupItems = byId.get(id) ?? []
      groupItems.push(item)
      byId.set(id, groupItems)
    }

    return (['project', 'user', 'package', 'other'] as PromptGroup['id'][])
      .filter((id) => byId.has(id))
      .map((id) => ({
        id,
        ...groupMeta(id),
        items: byId.get(id) ?? [],
      }))
  })

  return (
    <div class="prompt-pane">
      <section class="prompt-hero" aria-labelledby="prompt-hero-title">
        <div class="prompt-hero-main">
          <div>
            <p class="prompt-kicker">Pi prompt templates</p>
            <h2 id="prompt-hero-title">Slash commands backed by Markdown</h2>
            <p>
              Type <code>/name</code> in the composer to expand <code>name.md</code>. Templates can
              expose
              <code> argument-hint</code> frontmatter and accept positional arguments like{' '}
              <code>$1</code>, <code>$@</code>, and <code>${'${@:2}'}</code>.
            </p>
          </div>
        </div>
      </section>

      <div class="prompt-toolbar">
        <div class="prompt-filter-tabs" role="tablist" aria-label="Prompt scope filter">
          <For each={['all', 'project', 'user', 'package'] as PromptFilter[]}>
            {(entry) => (
              <button
                type="button"
                class={`prompt-filter-tab${filter() === entry ? ' is-active' : ''}`}
                onClick={() => setFilter(entry)}
                role="tab"
                aria-selected={filter() === entry}
              >
                <span>{FILTER_LABELS[entry]}</span>
                <span class="prompt-filter-count">{counts()[entry]}</span>
              </button>
            )}
          </For>
        </div>

        <label class="prompt-search-wrap">
          <Search size={13} />
          <input
            class="prompt-search"
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search command, args, description…"
            aria-label="Search prompt templates"
          />
        </label>
      </div>

      <Show
        when={!props.loading}
        fallback={<div class="prompt-empty">Scanning Pi prompt template directories…</div>}
      >
        <Show
          when={filteredItems().length > 0}
          fallback={
            <div class="prompt-empty">
              {props.items.length === 0
                ? 'No prompt templates discovered. Add Markdown files to ~/.pi/agent/prompts or .pi/prompts.'
                : 'No prompts match the current filter.'}
            </div>
          }
        >
          <div class="prompt-groups">
            <For each={groups()}>
              {(group) => (
                <section class="prompt-group">
                  <div class="prompt-group-head">
                    <div>
                      <h3>{group.label}</h3>
                      <p>{group.description}</p>
                    </div>
                    <span class="prompt-group-count">{group.items.length}</span>
                  </div>
                  <div class="prompt-group-list">
                    <For each={group.items}>{(item) => <PromptCard item={item} />}</For>
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
