import { BookOpen } from 'lucide-solid'
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js'
import type { DirectoryEntry, ListDirectoryResult } from '../../lib/ipc'

type StoryInfo = {
  path: string
  name: string
  title: string
  status: string
}

type StoryBrowserProps = {
  cwd: string | null
  onOpenFile: (relPath: string) => void
}

/** Parse simple YAML frontmatter from markdown content */
function parseFrontmatter(content: string): { title?: string; status?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return {}
  const frontmatter = match[1]
  const title = frontmatter.match(/^title:\s*(.+)$/m)?.[1]
  const status = frontmatter.match(/^status:\s*(.+)$/m)?.[1]
  return { title, status }
}

/** Truncate long strings */
function truncate(s: string, max = 48): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export const StoryBrowser: Component<StoryBrowserProps> = (props) => {
  const [stories, setStories] = createSignal<StoryInfo[]>([])
  const [loading, setLoading] = createSignal(true)

  createEffect(() => {
    const cwd = props.cwd
    if (!cwd) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      let entries: ListDirectoryResult
      try {
        entries = await window.openpi.listDirectory('docs/stories')
      } catch {
        if (cancelled) return
        setStories([])
        setLoading(false)
        return
      }

      const mdFiles = entries.filter(
        (e: DirectoryEntry) => !e.isDirectory && e.name.endsWith('.md')
      )

      // Read each story file to parse frontmatter
      const parsed: StoryInfo[] = []
      for (const entry of mdFiles) {
        if (cancelled) break
        try {
          const result = await window.openpi.readFile(entry.path)
          if (cancelled) break
          if (!result) continue
          const fm = parseFrontmatter(result.content)
          parsed.push({
            path: entry.path,
            name: entry.name.replace(/\.md$/, ''),
            title: fm.title ?? entry.name.replace(/\.md$/, ''),
            status: fm.status ?? 'planned',
          })
        } catch {
          // Skip unreadable files
        }
      }

      if (!cancelled) {
        setStories(parsed)
        setLoading(false)
      }
    })()

    onCleanup(() => {
      cancelled = true
    })
  })

  const statusClass = (status: string) => {
    const valid = ['planned', 'in_progress', 'implemented', 'changed', 'retired']
    return valid.includes(status) ? status : 'planned'
  }

  const sortedStories = createMemo(() => {
    const items = stories()
    // Sort: in_progress first, then implemented, then planned, then rest
    const order = ['in_progress', 'implemented', 'changed', 'planned', 'retired']
    return [...items].sort(
      (a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.title.localeCompare(b.title)
    )
  })

  return (
    <aside class="story-browser" aria-label="Stories">
      <header class="story-browser-header">
        <div class="eyebrow">Stories</div>
        <div class="story-browser-subtitle">Product work items and progress</div>
      </header>

      <div class="story-browser-list">
        <Show when={!loading()} fallback={<div class="story-browser-empty">Loading stories…</div>}>
          <Show
            when={sortedStories().length > 0}
            fallback={
              <div class="story-browser-empty">
                <BookOpen size={18} />
                <span>
                  No stories yet. Run <code>/goal</code> to create one.
                </span>
              </div>
            }
          >
            <For each={sortedStories()}>
              {(story) => (
                <button
                  type="button"
                  class="story-row"
                  title={`${story.title} (${story.status})`}
                  onClick={() => props.onOpenFile(story.path)}
                >
                  <span class="story-row-title">{truncate(story.title)}</span>
                  <span class={`story-badge story-badge--${statusClass(story.status)}`}>
                    {story.status.replace('_', ' ')}
                  </span>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </aside>
  )
}
