// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/noSvgWithoutTitle: existing composer picker/progress markup is tracked separately from this release.
import fuzzysort from 'fuzzysort'
import {
  ArrowUp,
  BookOpen,
  ChevronDown,
  Clock,
  MessageSquare,
  Paperclip,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Square,
  TerminalSquare,
  Zap,
} from 'lucide-solid'
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from 'solid-js'
import { FileIcon } from '../lib/fileIcons'
import type { FileLineComment } from '../lib/fileLineComments'
import { formatLineRange } from '../lib/fileLineComments'
import {
  type FileMentionTrigger,
  findFileMentionTrigger,
  removeFileMentionToken,
} from '../lib/fileMentions'
import type { FffFileResult, ModelInfo, SkillItem } from '../lib/ipc'
import {
  buildKeybindingEntries,
  eventMatchesBinding,
  findBinding,
  KEYBINDINGS_CHANGED_EVENT,
  type KeybindingActionId,
  type KeybindingOverrides,
  loadCustomKeybindings,
} from '../lib/keybindings'
import { GoalBanner } from './GoalBanner'

type QueueMode = 'prompt' | 'steer' | 'followup'

// ─── Slash commands ─────────────────────────────────────────────────────────

interface SlashCommand {
  name: string
  description: string
  argHint?: string
}

export function formatSlashCommandInput(commandName: string): string {
  const trimmed = commandName.trim()
  const slashName = trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  return `${slashName} `
}

// Thinking levels supported by Pi — matches ThinkingLevel union in Pi SDK
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

type ComposerProps = {
  input: string
  isStreaming: boolean
  isShellRunning: boolean
  queueMode: QueueMode
  workspaceName: string
  /** Most-recent-first list of user message texts for Up/Down history navigation */
  promptHistory: string[]
  steeringQueue: string[]
  followUpQueue: string[]
  setTextareaRef: (el: HTMLTextAreaElement) => void
  /** Workspace root path — used to fetch the file list for the context picker */
  cwd: string | null
  /** Relative paths of files currently attached as context */
  attachedFiles: string[]
  onAddFile: (relPath: string) => void
  onRemoveFile: (relPath: string) => void
  /** File line comments captured from the file preview modal */
  lineComments: FileLineComment[]
  onRemoveLineComment: (id: string) => void
  /** Loaded skill items (prepended as context on send) */
  loadedSkills: SkillItem[]
  onAddSkill: (skill: SkillItem) => void
  onRemoveSkill: (name: string) => void
  // Model
  models: ModelInfo[]
  currentModel: ModelInfo | null
  onSelectModel: (model: ModelInfo) => void
  // Thinking
  thinkingLevel: string
  onThinkingLevel: (level: string) => void
  // Provider actions
  onConnectProvider: () => void
  onManageModels: () => void
  onInput: (value: string) => void
  onQueueMode: (mode: QueueMode | ((mode: QueueMode) => QueueMode)) => void
  onSend: () => void
  onShellSend: () => void
  onAbort: () => void
  // Goal state
  activeGoalText: string | null
  activeGoalStep: 'running' | 'idle' | null
  onSetActiveGoal: (text: string | null) => void
  /** 0-100 percentage of context window consumed. Null when unknown. */
  contextPercent?: number | null
}

function truncate(s: string, max = 36): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

// ─── Context Picker popover (fff-powered, async) ──────────────────────────────────────

interface ContextPickerProps {
  cwd: string | null
  attachedPaths: Set<string>
  onSelect: (file: FffFileResult) => void
  onClose: () => void
}

const ContextPicker: Component<ContextPickerProps> = (props) => {
  const [query, setQuery] = createSignal('')
  const [activeIdx, setActiveIdx] = createSignal(0)
  const [results, setResults] = createSignal<FffFileResult[]>([])

  let inputRef: HTMLInputElement | undefined
  let listRef: HTMLDivElement | undefined
  let debounceRef: ReturnType<typeof setTimeout> | null = null

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus())
  })

  // Run fff file search on every query change (debounced 100 ms for non-empty queries)
  createEffect(() => {
    const q = query()
    if (debounceRef) clearTimeout(debounceRef)
    const cwd = props.cwd
    if (!cwd) {
      setResults([])
      return
    }
    const delay = q.trim() ? 100 : 0
    debounceRef = setTimeout(() => {
      void window.openpi.fff
        .fileSearch(q, 60, cwd)
        .then((items) => setResults(items))
        .catch(() => setResults([]))
    }, delay)

    onCleanup(() => {
      if (debounceRef) clearTimeout(debounceRef)
    })
  })

  // Reset active idx when result set changes
  createEffect(() => {
    results().length
    setActiveIdx(0)
  })

  // Scroll active item into view
  createEffect(() => {
    const idx = activeIdx()
    listRef?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      props.onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results().length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const f = results()[activeIdx()]
      if (f && !props.attachedPaths.has(f.relativePath)) {
        props.onSelect(f)
        props.onClose()
      }
    }
  }

  return (
    <div class="ctx-picker" onKeyDown={handleKeyDown}>
      {/* Search input */}
      <div class="ctx-picker-search">
        <Search size={12} class="ctx-picker-search-icon" />
        <input
          ref={(el) => {
            inputRef = el
          }}
          class="ctx-picker-input"
          placeholder="Search files… (fff)"
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value)
            setActiveIdx(0)
          }}
          autocomplete="off"
          spellcheck={false}
        />
      </div>

      {/* File list */}
      <div
        ref={(el) => {
          listRef = el
        }}
        class="ctx-picker-list"
      >
        <Show when={results().length === 0}>
          <div class="ctx-picker-empty">No files match</div>
        </Show>

        <For each={results()}>
          {(f, idx) => {
            const already = () => props.attachedPaths.has(f.relativePath)
            const isActive = () => idx() === activeIdx()

            return (
              <button
                type="button"
                data-idx={idx()}
                class={`ctx-picker-item${isActive() ? ' is-active' : ''}${already() ? ' is-attached' : ''}`}
                onClick={() => {
                  if (!already()) {
                    props.onSelect(f)
                    props.onClose()
                  }
                }}
                onMouseEnter={() => setActiveIdx(idx())}
                disabled={already()}
              >
                <span class="ctx-picker-item-icon">
                  <FileIcon name={f.fileName} size={12} />
                </span>
                <span class="ctx-picker-item-name">{f.fileName}</span>
                <Show when={f.dir}>
                  <span class="ctx-picker-item-dir">{f.dir}</span>
                </Show>
                <Show when={already()}>
                  <span class="ctx-picker-item-badge">added</span>
                </Show>
              </button>
            )
          }}
        </For>
      </div>

      {/* Footer */}
      <div class="ctx-picker-footer">
        <span>↑↓ navigate</span>
        <span>↵ add</span>
        <span>esc close</span>
      </div>
    </div>
  )
}

interface FileMentionPickerProps {
  query: string
  results: FffFileResult[]
  activeIdx: number
  attachedPaths: Set<string>
  onSelect: (file: FffFileResult) => void
  onSetActiveIdx: (idx: number) => void
}

const FileMentionPicker: Component<FileMentionPickerProps> = (props) => {
  let listRef: HTMLDivElement | undefined

  createEffect(() => {
    const idx = props.activeIdx
    listRef?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
  })

  return (
    <div class="file-mention-picker" role="listbox" aria-label="Attach file suggestions">
      <div class="file-mention-header">
        <span class="file-mention-kicker">Attach file</span>
        <span class="file-mention-query">@{props.query}</span>
      </div>
      <div
        ref={(el) => {
          listRef = el
        }}
        class="file-mention-list"
      >
        <Show
          when={props.results.length > 0}
          fallback={<div class="file-mention-empty">No files match</div>}
        >
          <For each={props.results}>
            {(f, idx) => {
              const already = () => props.attachedPaths.has(f.relativePath)
              const isActive = () => idx() === props.activeIdx

              return (
                <button
                  type="button"
                  data-idx={idx()}
                  class={`file-mention-item${isActive() ? ' is-active' : ''}${already() ? ' is-attached' : ''}`}
                  role="option"
                  aria-selected={isActive()}
                  disabled={already()}
                  onClick={() => {
                    if (!already()) props.onSelect(f)
                  }}
                  onMouseEnter={() => props.onSetActiveIdx(idx())}
                >
                  <span class="file-mention-icon">
                    <FileIcon name={f.fileName} size={13} />
                  </span>
                  <span class="file-mention-main">
                    <span class="file-mention-name">{f.fileName}</span>
                    <Show when={f.dir}>
                      <span class="file-mention-dir">{f.dir}</span>
                    </Show>
                  </span>
                  <Show when={already()}>
                    <span class="file-mention-badge">added</span>
                  </Show>
                </button>
              )
            }}
          </For>
        </Show>
      </div>
      <div class="file-mention-footer">
        <span>↑↓ navigate</span>
        <span>↵ attach</span>
        <span>esc close</span>
      </div>
    </div>
  )
}

// ─── Slash command picker ────────────────────────────────────────────

type SlashCommandPickerProps = {
  commands: SlashCommand[]
  activeIdx: number
  onSelect: (cmd: SlashCommand) => void
  onSetActiveIdx: (idx: number) => void
}

const SlashCommandPicker: Component<SlashCommandPickerProps> = (props) => {
  let listRef: HTMLDivElement | undefined

  createEffect(() => {
    listRef
      ?.querySelector(`[data-slash-idx="${props.activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })

  if (props.commands.length === 0) return null

  return (
    <div class="slash-picker">
      <div
        ref={(el) => {
          listRef = el
        }}
        class="slash-picker-list"
      >
        <For each={props.commands}>
          {(cmd, idx) => (
            <button
              type="button"
              data-slash-idx={idx()}
              class={`slash-picker-item${idx() === props.activeIdx ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                props.onSelect(cmd)
              }}
              onMouseEnter={() => props.onSetActiveIdx(idx())}
            >
              <span class="slash-picker-left">
                <span class="slash-picker-name">{cmd.name}</span>
              </span>
              <span class="slash-picker-desc">
                <Show when={cmd.argHint}>
                  <span class="slash-picker-arghint">{cmd.argHint}</span>
                </Show>
                {cmd.description}
              </span>
            </button>
          )}
        </For>
      </div>
    </div>
  )
}

// ─── File chip ───────────────────────────────────────────────────────────────

type FileChipProps = { relPath: string; onRemove: () => void }

const FileChip: Component<FileChipProps> = (props) => {
  const parts = props.relPath.split('/')
  const name = parts.pop() ?? props.relPath

  return (
    <span class="ctx-chip" title={props.relPath}>
      <span class="ctx-chip-icon">
        <FileIcon name={name} size={11} />
      </span>
      <span class="ctx-chip-name">{name}</span>
      <button
        type="button"
        class="ctx-chip-remove"
        onClick={props.onRemove}
        tabIndex={-1}
        aria-label={`Remove ${name}`}
      >
        ×
      </button>
    </span>
  )
}

// ─── File line comment chip ────────────────────────────────────────────

type LineCommentChipProps = { comment: FileLineComment; onRemove: () => void }

const LineCommentChip: Component<LineCommentChipProps> = (props) => {
  const parts = props.comment.path.split('/')
  const name = parts.pop() ?? props.comment.path
  const range = () => formatLineRange(props.comment.startLine, props.comment.endLine)
  const commentPreview = () => props.comment.comment.replace(/\s+/g, ' ').trim()

  return (
    <span
      class="ctx-chip line-comment-chip"
      title={`${props.comment.path}:${range()} — ${commentPreview()}`}
    >
      <span class="ctx-chip-icon">
        <MessageSquare size={11} />
      </span>
      <span class="line-comment-chip-meta">{`${name}:${range()}`}</span>
      <span class="line-comment-chip-text">{commentPreview()}</span>
      <button
        type="button"
        class="ctx-chip-remove"
        onClick={props.onRemove}
        tabIndex={-1}
        aria-label={`Remove comment on ${name} ${range()}`}
      >
        ×
      </button>
    </span>
  )
}

// ─── Skill picker ─────────────────────────────────────────────────────

type SkillPickerProps = {
  skills: SkillItem[]
  activeIdx: number
  onSelect: (skill: SkillItem) => void
  onSetActiveIdx: (idx: number) => void
}

const SkillPicker: Component<SkillPickerProps> = (props) => {
  let listRef: HTMLDivElement | undefined

  createEffect(() => {
    listRef
      ?.querySelector(`[data-skill-idx="${props.activeIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  })

  if (props.skills.length === 0) return null

  return (
    <div class="slash-picker skill-picker">
      <div class="skill-picker-header">
        <BookOpen size={12} />
        <span>Skills</span>
      </div>
      <div
        ref={(el) => {
          listRef = el
        }}
        class="slash-picker-list"
      >
        <For each={props.skills}>
          {(skill, idx) => (
            <button
              type="button"
              data-skill-idx={idx()}
              class={`slash-picker-item${idx() === props.activeIdx ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                props.onSelect(skill)
              }}
              onMouseEnter={() => props.onSetActiveIdx(idx())}
            >
              <span class="slash-picker-left">
                <span class={`skill-scope-dot skill-scope-dot--${skill.scope}`} />
                <span class="slash-picker-name">{skill.name}</span>
              </span>
              <span class="slash-picker-desc">{skill.description}</span>
            </button>
          )}
        </For>
      </div>
      <div class="slash-picker-footer">
        <span class="skill-scope-legend">
          <span class="skill-scope-dot skill-scope-dot--user" /> user &nbsp;
          <span class="skill-scope-dot skill-scope-dot--project" /> project
        </span>
        <span>enter to load · esc close</span>
      </div>
    </div>
  )
}

// ─── Skill chip ────────────────────────────────────────────────────────────

type SkillChipProps = { skill: SkillItem; onRemove: () => void }

const SkillChip: Component<SkillChipProps> = (props) => {
  return (
    <span class="ctx-chip skill-chip" title={props.skill.description}>
      <span class="ctx-chip-icon">
        <BookOpen size={11} />
      </span>
      <span class="ctx-chip-name">{props.skill.name}</span>
      <button
        type="button"
        class="ctx-chip-remove"
        onClick={props.onRemove}
        tabIndex={-1}
        aria-label={`Remove skill ${props.skill.name}`}
      >
        ×
      </button>
    </span>
  )
}

// ─── Context usage ring button ────────────────────────────────────────────────
// Shows a mini SVG arc + percentage. Color shifts green→amber→red.

const ContextUsageButton: Component<{ percent: number }> = (props) => {
  const r = 7
  const circ = 2 * Math.PI * r
  const dash = () => (circ * Math.min(props.percent, 100)) / 100
  const isHigh = () => props.percent >= 80
  const isMedium = () => props.percent >= 50 && props.percent < 80
  const display = () => Math.round(props.percent)

  return (
    <button
      type="button"
      class={`ctx-usage-btn${isHigh() ? ' is-high' : isMedium() ? ' is-medium' : ''}${isHigh() ? ' ctx-usage-pulse' : ''}`}
      title={`Context window: ${display()}% used`}
      aria-label={`Context window ${display()}% used`}
    >
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        {/* track */}
        <circle cx="9" cy="9" r={r} stroke="currentColor" stroke-width="2" stroke-opacity="0.18" />
        {/* fill arc */}
        <circle
          cx="9"
          cy="9"
          r={r}
          stroke="currentColor"
          stroke-width="2"
          stroke-dasharray={`${dash()} ${circ - dash()}`}
          stroke-dashoffset={circ * 0.25}
          /* start at top */
          stroke-linecap="round"
        />
      </svg>
      <span class="ctx-usage-label">{display()}%</span>
    </button>
  )
}

// ─── Main Composer ───────────────────────────────────────────────────────────

export const Composer: Component<ComposerProps> = (props) => {
  const hasQueue = createMemo(
    () => props.steeringQueue.length > 0 || props.followUpQueue.length > 0
  )
  const [shellMode, setShellMode] = createSignal(false)
  const [customKeybindings, setCustomKeybindings] = createSignal<KeybindingOverrides>({})

  // ─ Prompt history navigation (Up/Down when cursor at start) ──────────────
  // -1 = typing draft; ≥0 = browsing history (0 = most recent)
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [savedDraft, setSavedDraft] = createSignal('')
  // Model dropdown
  const [modelOpen, setModelOpen] = createSignal(false)
  const [modelSearch, setModelSearch] = createSignal('')
  let modelRef: HTMLDivElement | undefined
  let modelSearchRef: HTMLInputElement | undefined

  // Thinking dropdown
  const [thinkingOpen, setThinkingOpen] = createSignal(false)
  let thinkingRef: HTMLDivElement | undefined

  // Context picker
  const [pickerOpen, setPickerOpen] = createSignal(false)
  let pickerRef: HTMLDivElement | undefined

  // Inline @ file mention picker
  const [fileMentionOpen, setFileMentionOpen] = createSignal(false)
  const [fileMentionTrigger, setFileMentionTrigger] = createSignal<FileMentionTrigger | null>(null)
  const [fileMentionResults, setFileMentionResults] = createSignal<FffFileResult[]>([])
  const [fileMentionActiveIdx, setFileMentionActiveIdx] = createSignal(0)
  let fileMentionDebounceRef: ReturnType<typeof setTimeout> | null = null

  let textareaEl: HTMLTextAreaElement | undefined

  const attachedSet = createMemo(() => new Set(props.attachedFiles))

  // ─ Slash command picker state ───────────────────────────────────────────
  const [slashOpen, setSlashOpen] = createSignal(false)
  const [slashQuery, setSlashQuery] = createSignal('')
  const [slashActiveIdx, setSlashActiveIdx] = createSignal(0)
  const [promptCommands, setPromptCommands] = createSignal<SlashCommand[]>([])

  // Load prompt templates (merged with built-ins for the combined command list)
  createEffect(() => {
    const currentCwd = props.cwd
    void currentCwd

    void window.openpi
      .listPromptTemplates()
      .then((templates) => {
        const cmds: SlashCommand[] = templates.map((t) => ({
          name: `/${t.name}`,
          description: t.description,
          argHint: t.argHint,
        }))
        setPromptCommands(cmds)
      })
      .catch(() => {
        /* not fatal */
      })
  })

  // Built-in slash commands (merged with prompt templates)
  const BUILT_IN_SLASH_COMMANDS: SlashCommand[] = [
    {
      name: '/goal',
      description: 'Set or continue a goal/harness loop',
      argHint: '<objective, status, pause, resume, or clear>',
    },
  ]

  // All commands: built-ins first, then prompts sorted alphabetically
  const allCommands = createMemo<SlashCommand[]>(() => [
    ...BUILT_IN_SLASH_COMMANDS,
    ...promptCommands(),
  ])

  const filteredCmds = createMemo<SlashCommand[]>(() => {
    const q = slashQuery()
    const cmds = allCommands()
    if (!q) return cmds

    const ql = q.toLowerCase()
    const seen = new Set<string>()
    const prefix = cmds.filter((c) => {
      const hit = c.name.slice(1).toLowerCase().startsWith(ql)
      if (hit) seen.add(c.name)
      return hit
    })

    const fuzzy = fuzzysort
      .go(
        q,
        cmds.filter((c) => !seen.has(c.name)),
        {
          keys: ['name', 'description'],
          threshold: -10000,
          limit: 14,
        }
      )
      .map((r) => r.obj)

    return [...prefix, ...fuzzy].slice(0, 14)
  })

  // Reset active index when filtered set changes
  createEffect(() => {
    filteredCmds()
    setSlashActiveIdx(0)
  })

  const applySlashCommand = (cmd: SlashCommand) => {
    // Pi SDK requires the leading `/` to recognise prompt templates and extension commands.
    // Without it, session.prompt() receives e.g. `review` instead of `/review` and
    // expandPromptTemplates check (`text.startsWith("/")`) skips expansion entirely.
    const newVal = formatSlashCommandInput(cmd.name)
    props.onInput(newVal)
    setSlashOpen(false)
    setFileMentionOpen(false)
    requestAnimationFrame(() => {
      if (textareaEl) {
        textareaEl.style.height = 'auto'
        textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 200)}px`
        textareaEl.setSelectionRange(newVal.length, newVal.length)
        textareaEl.focus()
      }
    })
  }

  const closeFileMentionPicker = () => {
    setFileMentionOpen(false)
    setFileMentionTrigger(null)
    setFileMentionResults([])
    setFileMentionActiveIdx(0)
  }

  const updateFileMentionPicker = (value: string, cursor: number) => {
    const trigger = findFileMentionTrigger(value, cursor)
    if (!trigger || shellMode()) {
      closeFileMentionPicker()
      return null
    }

    setFileMentionTrigger(trigger)
    setFileMentionOpen(true)
    setFileMentionActiveIdx(0)
    setSlashOpen(false)
    setSkillOpen(false)
    return trigger
  }

  createEffect(() => {
    const trigger = fileMentionTrigger()
    if (fileMentionDebounceRef) clearTimeout(fileMentionDebounceRef)
    const cwd = props.cwd
    if (!fileMentionOpen() || !trigger || !cwd) return

    const query = trigger.query
    const delay = query.trim() ? 80 : 0
    fileMentionDebounceRef = setTimeout(() => {
      void window.openpi.fff
        .fileSearch(query, 12, cwd)
        .then((items) => setFileMentionResults(items))
        .catch(() => setFileMentionResults([]))
    }, delay)
  })

  onCleanup(() => {
    if (fileMentionDebounceRef) clearTimeout(fileMentionDebounceRef)
  })

  const applyFileMention = (file: FffFileResult) => {
    const trigger = fileMentionTrigger()
    if (!trigger) return

    if (!attachedSet().has(file.relativePath)) {
      props.onAddFile(file.relativePath)
    }

    const next = removeFileMentionToken(props.input, trigger)
    props.onInput(next.text)
    closeFileMentionPicker()
    requestAnimationFrame(() => {
      if (!textareaEl) return
      textareaEl.style.height = 'auto'
      textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 200)}px`
      textareaEl.setSelectionRange(next.cursor, next.cursor)
      textareaEl.focus()
    })
  }

  // ─ Skill picker state ─────────────────────────────────────────────────────
  const [skillOpen, setSkillOpen] = createSignal(false)
  const [skillQuery, setSkillQuery] = createSignal('')
  const [skillActiveIdx, setSkillActiveIdx] = createSignal(0)
  const [allSkills, setAllSkills] = createSignal<SkillItem[]>([])
  const [skillsLoaded, setSkillsLoaded] = createSignal(false)

  // Lazy-load skills when skill picker first opens
  createEffect(() => {
    if (skillOpen() && !skillsLoaded()) {
      void window.openpi
        .listSkills()
        .then((skills) => {
          setAllSkills(skills)
          setSkillsLoaded(true)
        })
        .catch(() => {})
    }
  })

  // Reload skills when cwd changes
  createEffect(() => {
    const currentCwd = props.cwd
    void currentCwd
    setSkillsLoaded(false)
  })

  const filteredSkills = createMemo<SkillItem[]>(() => {
    const q = skillQuery()
    const skills = allSkills()
    if (!q) return skills

    const ql = q.toLowerCase()
    const seen = new Set<string>()
    const prefix = skills.filter((s) => {
      const hit = s.name.toLowerCase().startsWith(ql)
      if (hit) seen.add(s.name)
      return hit
    })

    const fuzzy = fuzzysort
      .go(
        q,
        skills.filter((s) => !seen.has(s.name)),
        {
          keys: ['name', 'description'],
          threshold: -10000,
          limit: 14,
        }
      )
      .map((r) => r.obj)

    return [...prefix, ...fuzzy].slice(0, 14)
  })

  createEffect(() => {
    filteredSkills()
    setSkillActiveIdx(0)
  })

  const applySkill = (skill: SkillItem) => {
    props.onInput('')
    setSkillOpen(false)
    closeFileMentionPicker()
    props.onAddSkill(skill)
    requestAnimationFrame(() => textareaEl?.focus())
  }

  // Helpers for Up/Down prompt-history navigation
  const historyBack = () => {
    const history = props.promptHistory
    if (!history.length) return
    const current = historyIndex()
    if (current === -1) {
      // First Up press — save draft and go to most-recent message
      setSavedDraft(props.input)
      setHistoryIndex(0)
      props.onInput(history[0] ?? '')
    } else if (current < history.length - 1) {
      // Go further back
      setHistoryIndex(current + 1)
      props.onInput(history[current + 1] ?? '')
    }
    // At oldest entry — do nothing
  }

  const historyForward = () => {
    const current = historyIndex()
    if (current <= 0) {
      // Back to draft
      setHistoryIndex(-1)
      props.onInput(savedDraft())
    } else {
      setHistoryIndex(current - 1)
      props.onInput(props.promptHistory[current - 1] ?? '')
    }
  }

  const keybindingEntries = createMemo(() => buildKeybindingEntries(customKeybindings()))
  const binding = (actionId: KeybindingActionId) => findBinding(keybindingEntries(), actionId)

  onMount(() => {
    loadCustomKeybindings()
      .then(setCustomKeybindings)
      .catch(() => {})

    const onKeybindingsChanged = (event: Event) => {
      setCustomKeybindings((event as CustomEvent<KeybindingOverrides>).detail)
    }
    window.addEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="dialog"], .customizations-modal')) return

      if (eventMatchesBinding(event, binding('addFiles'))) {
        event.preventDefault()
        setPickerOpen((v) => !v)
        setModelOpen(false)
        setThinkingOpen(false)
        return
      }
      if (eventMatchesBinding(event, binding('toggleShellMode'))) {
        event.preventDefault()
        setShellMode(true)
        setPickerOpen(false)
        setModelOpen(false)
        setThinkingOpen(false)
        setSlashOpen(false)
        setSkillOpen(false)
        requestAnimationFrame(() => textareaEl?.focus())
        return
      }
      if (eventMatchesBinding(event, binding('chooseModel'))) {
        event.preventDefault()
        const willOpen = !modelOpen()
        setModelOpen(willOpen)
        setThinkingOpen(false)
        setPickerOpen(false)
        if (willOpen) setTimeout(() => modelSearchRef?.focus(), 30)
        return
      }
      if (eventMatchesBinding(event, binding('cycleThinkingEffort'))) {
        event.preventDefault()
        const currentIndex = THINKING_LEVELS.indexOf(
          props.thinkingLevel as (typeof THINKING_LEVELS)[number]
        )
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % THINKING_LEVELS.length
        props.onThinkingLevel(THINKING_LEVELS[nextIndex])
        return
      }
      if (eventMatchesBinding(event, binding('focusComposer'))) {
        event.preventDefault()
        requestAnimationFrame(() => textareaEl?.focus())
        return
      }
      // clearInput fires only when the textarea is focused and there is no active
      // text selection (so normal Ctrl+C copy still works when text is selected).
      if (eventMatchesBinding(event, binding('clearInput'))) {
        const active = document.activeElement
        if (active === textareaEl) {
          const sel = textareaEl?.selectionStart !== textareaEl?.selectionEnd
          if (!sel && props.input.length > 0) {
            event.preventDefault()
            props.onInput('')
            return
          }
        }
      }
      // Interrupt mode (Alt+Up) — only while agent is running.
      if (eventMatchesBinding(event, binding('steerMode')) && props.isStreaming) {
        event.preventDefault()
        // Toggle: pressing again while already in steer resets to prompt.
        props.onQueueMode((m) => (m === 'steer' ? 'prompt' : 'steer'))
        requestAnimationFrame(() => textareaEl?.focus())
        return
      }
      // Follow-up mode (Alt+Down) — only while agent is running.
      if (eventMatchesBinding(event, binding('followupMode')) && props.isStreaming) {
        event.preventDefault()
        // Toggle: pressing again while already in followup resets to prompt.
        props.onQueueMode((m) => (m === 'followup' ? 'prompt' : 'followup'))
        requestAnimationFrame(() => textareaEl?.focus())
        return
      }
    }

    window.addEventListener('keydown', handler)
    onCleanup(() => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)
    })
  })

  // Close dropdowns on outside click
  createEffect(() => {
    if (!modelOpen() && !thinkingOpen() && !pickerOpen()) return

    const close = (e: MouseEvent) => {
      if (!modelRef?.contains(e.target as Node)) {
        setModelOpen(false)
        setModelSearch('')
      }
      if (!thinkingRef?.contains(e.target as Node)) setThinkingOpen(false)
      if (!pickerRef?.contains(e.target as Node)) setPickerOpen(false)
    }

    document.addEventListener('mousedown', close)
    onCleanup(() => document.removeEventListener('mousedown', close))
  })

  const filteredModels = createMemo(() => {
    const q = modelSearch().trim().toLowerCase()
    if (!q) return props.models
    return props.models.filter(
      (m) => m.name.toLowerCase().includes(q) || m.provider.toLowerCase().includes(q)
    )
  })

  return (
    <div class="composer-wrap">
      <div class="composer-inner">
        {/* ── Inline @ file mention picker — floats above composer box ───── */}
        <Show when={fileMentionOpen()}>
          <FileMentionPicker
            query={fileMentionTrigger()?.query ?? ''}
            results={fileMentionResults()}
            activeIdx={fileMentionActiveIdx()}
            attachedPaths={attachedSet()}
            onSelect={applyFileMention}
            onSetActiveIdx={(idx) => setFileMentionActiveIdx(idx)}
          />
        </Show>

        {/* ── Slash command picker — floats above composer box ───────────── */}
        <Show when={slashOpen() && filteredCmds().length > 0}>
          <SlashCommandPicker
            commands={filteredCmds()}
            activeIdx={slashActiveIdx()}
            onSelect={applySlashCommand}
            onSetActiveIdx={(idx) => setSlashActiveIdx(idx)}
          />
        </Show>

        {/* ── Skill picker — triggered by /skill: ───────────────── */}
        <Show when={skillOpen() && filteredSkills().length > 0}>
          <SkillPicker
            skills={filteredSkills()}
            activeIdx={skillActiveIdx()}
            onSelect={applySkill}
            onSetActiveIdx={(idx) => setSkillActiveIdx(idx)}
          />
        </Show>

        {/* ── Pending queue list ────────────────────────────────────── */}
        <Show when={hasQueue()}>
          <div class="pending-queue">
            <div class="pending-queue-header">
              <span class="pending-queue-count">
                Queued · {props.steeringQueue.length + props.followUpQueue.length}
              </span>
            </div>
            <For each={props.steeringQueue}>
              {(item) => (
                <div class="pq-row">
                  <span
                    class="pq-badge pq-badge--steer"
                    title="Interrupt — injected after current tool calls"
                  >
                    <Zap size={10} />
                  </span>
                  <span class="pq-text" title={item}>
                    {truncate(item, 72)}
                  </span>
                </div>
              )}
            </For>
            <For each={props.followUpQueue}>
              {(item) => (
                <div class="pq-row">
                  <span
                    class="pq-badge pq-badge--followup"
                    title="Queue — delivered when agent fully stops"
                  >
                    <Clock size={10} />
                  </span>
                  <span class="pq-text" title={item}>
                    {truncate(item, 72)}
                  </span>
                </div>
              )}
            </For>
          </div>
        </Show>

        {/* ── Goal banner ─────────────────────────────────────────────── */}
        <GoalBanner
          text={props.activeGoalText}
          step={props.activeGoalStep}
          onDismiss={() => props.onSetActiveGoal(null)}
        />

        {/* ── Composer box ─────────────────────────────────────────────── */}
        <div
          class={`composer-box${shellMode() ? ' is-shell-mode' : ''}${
            props.isStreaming
              ? props.queueMode === 'steer'
                ? ' is-steer-mode'
                : props.queueMode === 'followup'
                  ? ' is-followup-mode'
                  : ''
              : ''
          }`}
        >
          {/* ── Attached file chips ──────────────────────────────────── */}
          <Show
            when={
              props.attachedFiles.length > 0 ||
              props.lineComments.length > 0 ||
              props.loadedSkills.length > 0
            }
          >
            <div class="ctx-chips-row">
              <For each={props.loadedSkills}>
                {(s) => <SkillChip skill={s} onRemove={() => props.onRemoveSkill(s.name)} />}
              </For>
              <For each={props.attachedFiles}>
                {(p) => <FileChip relPath={p} onRemove={() => props.onRemoveFile(p)} />}
              </For>
              <For each={props.lineComments}>
                {(comment) => (
                  <LineCommentChip
                    comment={comment}
                    onRemove={() => props.onRemoveLineComment(comment.id)}
                  />
                )}
              </For>
            </div>
          </Show>

          <Show when={shellMode()}>
            <div class="composer-shell-banner">
              <span class="composer-shell-label">
                <TerminalSquare size={13} /> Shell
              </span>
              <button
                type="button"
                class="composer-shell-cancel"
                onClick={() => setShellMode(false)}
              >
                Cancel
              </button>
            </div>
          </Show>

          <textarea
            ref={(el) => {
              textareaEl = el
              props.setTextareaRef(el)
            }}
            rows={1}
            placeholder={
              shellMode()
                ? 'Enter shell command…'
                : props.isStreaming
                  ? props.queueMode === 'steer'
                    ? 'Interrupt Pi after current tool calls…'
                    : props.queueMode === 'followup'
                      ? 'Queue message for when Pi finishes…'
                      : 'Message Pi…'
                  : `Ask Pi about ${props.workspaceName}…`
            }
            value={props.input}
            onInput={(event) => {
              const val = event.currentTarget.value
              const caret = event.currentTarget.selectionStart ?? val.length
              props.onInput(val)
              // Any direct typing exits history-browsing mode
              if (historyIndex() !== -1) setHistoryIndex(-1)

              if (shellMode()) {
                if (slashOpen()) setSlashOpen(false)
                if (skillOpen()) setSkillOpen(false)
                closeFileMentionPicker()
                event.currentTarget.style.height = 'auto'
                event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 200)}px`
                return
              }

              const mention = updateFileMentionPicker(val, caret)
              if (mention) {
                if (slashOpen()) setSlashOpen(false)
                if (skillOpen()) setSkillOpen(false)
              }

              // Skill picker: /skill:<query> takes priority over slash picker
              const skillMatch = mention ? null : /^\/skill:([\w-]*)$/.exec(val)
              // Slash command detection: entire input is exactly /<query>
              const slashMatch = !mention && !skillMatch ? /^\/([-\w]*)$/.exec(val) : null

              if (skillMatch !== null) {
                setSkillQuery(skillMatch[1] ?? '')
                setSkillOpen(true)
                if (slashOpen()) setSlashOpen(false)
                closeFileMentionPicker()
              } else if (slashMatch !== null) {
                setSlashQuery(slashMatch[1] ?? '')
                setSlashOpen(true)
                if (skillOpen()) setSkillOpen(false)
                closeFileMentionPicker()
              } else if (!mention) {
                if (slashOpen()) setSlashOpen(false)
                if (skillOpen()) setSkillOpen(false)
              }

              event.currentTarget.style.height = 'auto'
              event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 200)}px`
            }}
            onKeyDown={(event) => {
              const currentMentionResults = fileMentionResults()
              const currentFilteredCmds = filteredCmds()
              const currentFilteredSkills = filteredSkills()

              if (shellMode()) {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setShellMode(false)
                  return
                }
                if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
                  event.preventDefault()
                  props.onShellSend()
                  return
                }
              }

              // Inline @ file picker intercepts navigation keys first
              if (fileMentionOpen()) {
                if (event.key === 'ArrowDown' && currentMentionResults.length > 0) {
                  event.preventDefault()
                  setFileMentionActiveIdx((i) => Math.min(i + 1, currentMentionResults.length - 1))
                  return
                }
                if (event.key === 'ArrowUp' && currentMentionResults.length > 0) {
                  event.preventDefault()
                  setFileMentionActiveIdx((i) => Math.max(i - 1, 0))
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  const file = currentMentionResults[fileMentionActiveIdx()]
                  if (file) applyFileMention(file)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  closeFileMentionPicker()
                  return
                }
              }

              // Slash picker intercepts navigation keys first
              if (slashOpen() && currentFilteredCmds.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSlashActiveIdx((i) => Math.min(i + 1, currentFilteredCmds.length - 1))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSlashActiveIdx((i) => Math.max(i - 1, 0))
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  const cmd = currentFilteredCmds[slashActiveIdx()]
                  if (cmd) applySlashCommand(cmd)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSlashOpen(false)
                  return
                }
              }

              // Skill picker keyboard nav
              if (skillOpen() && currentFilteredSkills.length > 0) {
                if (event.key === 'ArrowDown') {
                  event.preventDefault()
                  setSkillActiveIdx((i) => Math.min(i + 1, currentFilteredSkills.length - 1))
                  return
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault()
                  setSkillActiveIdx((i) => Math.max(i - 1, 0))
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  const s = currentFilteredSkills[skillActiveIdx()]
                  if (s) applySkill(s)
                  return
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setSkillOpen(false)
                  return
                }
              }

              // ─ Prompt history navigation (Up/Down) ───────────────────────────────
              // Up at the start enters prompt history; while browsing, Up keeps going older.
              if (
                event.key === 'ArrowUp' &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !shellMode() &&
                !slashOpen() &&
                !skillOpen() &&
                !fileMentionOpen() &&
                (historyIndex() !== -1 ||
                  (event.currentTarget.selectionStart === 0 &&
                    event.currentTarget.selectionEnd === 0))
              ) {
                event.preventDefault()
                historyBack()
                requestAnimationFrame(() => {
                  if (textareaEl) {
                    const len = textareaEl.value.length
                    textareaEl.setSelectionRange(len, len)
                    textareaEl.style.height = 'auto'
                    textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 200)}px`
                  }
                })
                return
              }

              // Down when browsing history → move forward toward draft
              if (
                event.key === 'ArrowDown' &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !shellMode() &&
                historyIndex() !== -1
              ) {
                event.preventDefault()
                historyForward()
                requestAnimationFrame(() => {
                  if (textareaEl) {
                    const len = textareaEl.value.length
                    textareaEl.setSelectionRange(len, len)
                    textareaEl.style.height = 'auto'
                    textareaEl.style.height = `${Math.min(textareaEl.scrollHeight, 200)}px`
                  }
                })
                return
              }

              if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
                event.preventDefault()
                // Reset history cursor so next Up starts at most-recent message again
                setHistoryIndex(-1)
                setSavedDraft('')
                props.onSend()
              }

              if (event.key === 'Enter' && event.altKey && props.isStreaming) {
                event.preventDefault()
                props.onQueueMode((current) =>
                  current === 'prompt' ? 'steer' : current === 'steer' ? 'followup' : 'prompt'
                )
              }
            }}
          />

          {/* ── Bottom toolbar ────────────────────────────────────────── */}
          <div class="composer-toolbar">
            <div class="composer-toolbar-left">
              {/* ── Add context button ─────────────────────────────────── */}
              <div
                ref={(el) => {
                  pickerRef = el
                }}
                class="composer-picker"
              >
                <button
                  type="button"
                  class={`composer-tool-btn composer-add-ctx-btn${pickerOpen() ? ' is-open' : ''}`}
                  onClick={() => {
                    setPickerOpen((v) => !v)
                    setModelOpen(false)
                    setThinkingOpen(false)
                  }}
                  title="Add context file (⌘/)"
                  aria-label="Add context file"
                >
                  <Paperclip size={13} strokeWidth={2} />
                </button>

                <Show when={pickerOpen()}>
                  <ContextPicker
                    cwd={props.cwd}
                    attachedPaths={attachedSet()}
                    onSelect={(f) => props.onAddFile(f.relativePath)}
                    onClose={() => setPickerOpen(false)}
                  />
                </Show>
              </div>

              {/* Divider */}
              <span class="composer-toolbar-divider" aria-hidden />

              {/* Model picker */}
              <div
                ref={(el) => {
                  modelRef = el
                }}
                class="composer-picker"
              >
                <button
                  type="button"
                  class="composer-tool-btn"
                  onClick={() => {
                    setModelOpen((v) => !v)
                    setThinkingOpen(false)
                    setPickerOpen(false)
                    if (!modelOpen()) setTimeout(() => modelSearchRef?.focus(), 30)
                  }}
                  title="Select model"
                >
                  <span class="composer-tool-label">{props.currentModel?.name ?? 'No model'}</span>
                  <ChevronDown size={11} strokeWidth={2} />
                </button>

                <Show when={modelOpen()}>
                  <div class="composer-dropdown composer-dropdown-up composer-model-dropdown">
                    <div class="cmd-header">
                      <div class="cmd-search-wrap">
                        <input
                          ref={(el) => {
                            modelSearchRef = el
                          }}
                          class="cmd-search"
                          placeholder="Search models"
                          value={modelSearch()}
                          onInput={(e) => setModelSearch(e.currentTarget.value)}
                        />
                      </div>

                      <button
                        type="button"
                        class="cmd-icon-btn"
                        title="Connect provider"
                        onClick={() => {
                          setModelOpen(false)
                          props.onConnectProvider()
                        }}
                      >
                        <Plus size={13} strokeWidth={2} />
                      </button>

                      <button
                        type="button"
                        class="cmd-icon-btn"
                        title="Manage models"
                        onClick={() => {
                          setModelOpen(false)
                          props.onManageModels()
                        }}
                      >
                        <SlidersHorizontal size={13} strokeWidth={2} />
                      </button>
                    </div>

                    <For each={filteredModels()}>
                      {(m) => {
                        const active = () =>
                          props.currentModel?.id === m.id &&
                          props.currentModel?.provider === m.provider

                        return (
                          <button
                            type="button"
                            class={`composer-drop-item ${active() ? 'is-active' : ''}`}
                            onClick={() => {
                              props.onSelectModel(m)
                              setModelOpen(false)
                              setModelSearch('')
                            }}
                          >
                            <span class="composer-drop-name">{m.name}</span>
                            <span class="composer-drop-sub">{m.provider}</span>
                          </button>
                        )
                      }}
                    </For>

                    <Show when={filteredModels().length === 0}>
                      <div class="cmd-empty">No models match</div>
                    </Show>
                  </div>
                </Show>
              </div>

              {/* Thinking level picker */}
              <div
                ref={(el) => {
                  thinkingRef = el
                }}
                class="composer-picker"
              >
                <button
                  type="button"
                  class="composer-tool-btn"
                  onClick={() => {
                    setThinkingOpen((v) => !v)
                    setModelOpen(false)
                    setPickerOpen(false)
                  }}
                  title="Thinking level"
                >
                  <span class="composer-tool-label">{props.thinkingLevel}</span>
                  <ChevronDown size={11} strokeWidth={2} />
                </button>

                <Show when={thinkingOpen()}>
                  <div class="composer-dropdown composer-dropdown-up">
                    <For each={THINKING_LEVELS}>
                      {(level) => (
                        <button
                          type="button"
                          class={`composer-drop-item ${props.thinkingLevel === level ? 'is-active' : ''}`}
                          onClick={() => {
                            props.onThinkingLevel(level)
                            setThinkingOpen(false)
                          }}
                        >
                          <span class="composer-drop-name">{level}</span>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>

              {/* Context usage indicator */}
              <Show when={props.contextPercent !== null && props.contextPercent !== undefined}>
                <span class="composer-toolbar-divider" aria-hidden />
                <ContextUsageButton percent={props.contextPercent as number} />
              </Show>
            </div>

            {/* Send / Stop */}
            <div class="composer-toolbar-right">
              <Show when={props.isStreaming}>
                {/* Delivery mode selector — only visible while the agent is running */}
                <div class="delivery-seg">
                  <button
                    type="button"
                    class={`delivery-btn${props.queueMode === 'steer' ? ' is-on' : ''}`}
                    onClick={() => props.onQueueMode((m) => (m === 'steer' ? 'prompt' : 'steer'))}
                    title="Interrupt — injected after current tool calls, before next LLM call"
                    aria-pressed={props.queueMode === 'steer'}
                  >
                    <Zap size={11} />
                    <span>Interrupt</span>
                  </button>
                  <button
                    type="button"
                    class={`delivery-btn is-queue-variant${props.queueMode === 'followup' ? ' is-on' : ''}`}
                    onClick={() =>
                      props.onQueueMode((m) => (m === 'followup' ? 'prompt' : 'followup'))
                    }
                    title="Queue — delivered when agent fully stops"
                    aria-pressed={props.queueMode === 'followup'}
                  >
                    <Clock size={11} />
                    <span>Queue</span>
                  </button>
                </div>

                {/* Reset to normal prompt mode — shown when a delivery mode is active */}
                <Show when={props.queueMode !== 'prompt'}>
                  <button
                    type="button"
                    class={`delivery-reset-btn${
                      props.queueMode === 'steer' ? ' is-steer' : ' is-followup'
                    }`}
                    onClick={() => props.onQueueMode('prompt')}
                    title={`Reset to normal prompt mode (${props.queueMode === 'steer' ? 'Alt+↑' : 'Alt+↓'} to re-activate)`}
                    aria-label="Reset delivery mode to normal"
                  >
                    <RotateCcw size={11} strokeWidth={2} />
                  </button>
                </Show>

                <span class="composer-toolbar-divider" aria-hidden />
              </Show>

              <Show
                when={props.isStreaming}
                fallback={
                  <button
                    type="button"
                    class="composer-send-btn"
                    onClick={() => (shellMode() ? props.onShellSend() : props.onSend())}
                    disabled={
                      shellMode()
                        ? !props.input.trim() || props.isShellRunning
                        : !props.input.trim() &&
                          props.attachedFiles.length === 0 &&
                          props.lineComments.length === 0 &&
                          props.loadedSkills.length === 0
                    }
                    title={shellMode() ? 'Run shell command (Enter)' : 'Send (Enter)'}
                  >
                    <ArrowUp size={14} strokeWidth={2.5} />
                  </button>
                }
              >
                {/* During streaming: only the stop button — Enter key sends in the active delivery mode */}
                <button
                  type="button"
                  class="composer-stop-btn"
                  onClick={props.onAbort}
                  title="Stop agent"
                >
                  <Square size={13} strokeWidth={2} />
                </button>
              </Show>
            </div>
          </div>
        </div>

        <p class="composer-hint">
          {shellMode()
            ? 'enter to run shell · esc cancel · ⌘⇧X shell mode'
            : props.isStreaming && !shellMode()
              ? props.queueMode === 'steer'
                ? 'interrupt mode · injects after tool calls · enter to send · alt+enter switch'
                : props.queueMode === 'followup'
                  ? 'queue mode · delivers when agent stops · enter to send · alt+enter switch'
                  : 'enter to send · alt+enter switch delivery mode'
              : 'enter to send · shift+enter new line · ↑ recall last · ⌘/ add context · ⌘⇧X shell'}
        </p>
      </div>
    </div>
  )
}
