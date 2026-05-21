// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/noSvgWithoutTitle: existing composer picker/progress markup is tracked separately from this release.
import fuzzysort from 'fuzzysort'
import {
  ArrowUp,
  ChevronDown,
  Clock,
  Paperclip,
  Plus,
  RotateCcw,
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
import {
  type FileMentionTrigger,
  findFileMentionTrigger,
  removeFileMentionToken,
} from '../lib/fileMentions'
import type { FffFileResult, SkillItem } from '../lib/ipc'
import {
  buildKeybindingEntries,
  eventMatchesBinding,
  findBinding,
  KEYBINDINGS_CHANGED_EVENT,
  type KeybindingActionId,
  type KeybindingOverrides,
  loadCustomKeybindings,
} from '../lib/keybindings'
import { ContextUsageButton, TpsBadge } from './composer/Badges'
import { AgentChip, FileChip, LineCommentChip, SkillChip } from './composer/Chips'
import { SkillPicker, SlashCommandPicker } from './composer/CommandPicker'
import { ContextPicker } from './composer/ContextPicker'
import { formatSlashCommandInput, THINKING_LEVELS, truncate } from './composer/helpers'
import { MentionPicker } from './composer/MentionPicker'
import type { ComposerProps, SlashCommand } from './composer/types'
import { GoalBanner } from './GoalBanner'

export { formatSlashCommandInput } from './composer/helpers'

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

  // Agent mention chips (local state — encodes @mentions visible in the input text)
  const [agentMentions, setAgentMentions] = createSignal<{ name: string; description: string }[]>(
    []
  )

  // Filtered agent types for @mention autocomplete
  const filteredAgents = createMemo(() => {
    const types = props.availableAgentTypes
    if (!types || types.length === 0) return []
    const trigger = fileMentionTrigger()
    const query = (trigger?.query ?? '').toLowerCase()
    if (!query) return types
    return types.filter(
      (a) => a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)
    )
  })

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

  const applyAgentMention = (name: string) => {
    const trigger = fileMentionTrigger()
    if (!trigger) return

    // Add chip state — do NOT insert @name into the input text; the chip IS the visual
    const agentType = props.availableAgentTypes?.find((a) => a.name === name)
    const description = agentType?.description ?? `${name} subagent`
    setAgentMentions((prev) => {
      if (prev.some((a) => a.name === name)) return prev
      return [...prev, { name, description }]
    })

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

  const removeAgentMention = (name: string) => {
    setAgentMentions((prev) => prev.filter((a) => a.name !== name))
  }

  // Wrap onSend to prepend agent mention tokens, then clear chips
  const handleSend = () => {
    const mentions = agentMentions()
    if (mentions.length > 0) {
      const prefix = mentions.map((a) => `@${a.name}`).join(' ')
      props.onInput(`${prefix} ${props.input}`)
    }
    setAgentMentions([])
    props.onSend()
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
          <MentionPicker
            query={fileMentionTrigger()?.query ?? ''}
            fileResults={fileMentionResults()}
            agentResults={filteredAgents()}
            activeIdx={fileMentionActiveIdx()}
            attachedPaths={attachedSet()}
            onSelectFile={applyFileMention}
            onSelectAgent={applyAgentMention}
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
          elapsed={props.activeGoalElapsed}
          progress={props.activeGoalProgress}
          onDismiss={() => props.onSetActiveGoal(null)}
          onAbort={props.onAbort}
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
              props.loadedSkills.length > 0 ||
              agentMentions().length > 0
            }
          >
            <div class="ctx-chips-row">
              <For each={agentMentions()}>
                {(agent) => (
                  <AgentChip
                    name={agent.name}
                    description={agent.description}
                    onRemove={() => removeAgentMention(agent.name)}
                  />
                )}
              </For>
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

              // Inline @ mention picker intercepts navigation keys first
              if (fileMentionOpen()) {
                const agentResults = filteredAgents()
                const totalItems = agentResults.length + currentMentionResults.length
                const activeIdx = fileMentionActiveIdx()
                if (event.key === 'ArrowDown' && totalItems > 0) {
                  event.preventDefault()
                  setFileMentionActiveIdx((i) => Math.min(i + 1, totalItems - 1))
                  return
                }
                if (event.key === 'ArrowUp' && totalItems > 0) {
                  event.preventDefault()
                  setFileMentionActiveIdx((i) => Math.max(i - 1, 0))
                  return
                }
                if (event.key === 'Enter' || event.key === 'Tab') {
                  event.preventDefault()
                  if (activeIdx < agentResults.length) {
                    const agent = agentResults[activeIdx]
                    if (agent) applyAgentMention(agent.name)
                  } else {
                    const fileIdx = activeIdx - agentResults.length
                    const file = currentMentionResults[fileIdx]
                    if (file) applyFileMention(file)
                  }
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
                handleSend()
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

              <Show
                when={props.agentTps !== null && props.agentTps !== undefined && props.agentTps > 0}
              >
                <TpsBadge tps={props.agentTps as number} />
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
                    onClick={() => (shellMode() ? props.onShellSend() : handleSend())}
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
