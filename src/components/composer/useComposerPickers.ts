import fuzzysort from 'fuzzysort'
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import {
  type FileMentionTrigger,
  findFileMentionTrigger,
  removeFileMentionToken,
} from '../../lib/fileMentions'
import type { FffFileResult, SkillItem } from '../../lib/ipc'
import { formatSlashCommandInput } from './helpers'
import type { SlashCommand } from './types'

export interface ComposerPickers {
  /** Slash command picker */
  slashOpen: () => boolean
  slashQuery: () => string
  slashActiveIdx: () => number
  setSlashActiveIdx: (idx: number | ((prev: number) => number)) => void
  setSlashQuery: (q: string | ((prev: string) => string)) => void
  filteredCmds: () => SlashCommand[]
  applySlashCommand: (cmd: SlashCommand) => void
  setSlashOpen: (v: boolean | ((prev: boolean) => boolean)) => void

  /** Skill picker */
  skillOpen: () => boolean
  skillQuery: () => string
  skillActiveIdx: () => number
  setSkillActiveIdx: (idx: number | ((prev: number) => number)) => void
  setSkillQuery: (q: string | ((prev: string) => string)) => void
  filteredSkills: () => SkillItem[]
  applySkill: (skill: SkillItem) => void
  setSkillOpen: (v: boolean | ((prev: boolean) => boolean)) => void

  /** File mention picker */
  fileMentionOpen: () => boolean
  fileMentionTrigger: () => FileMentionTrigger | null
  fileMentionResults: () => FffFileResult[]
  fileMentionActiveIdx: () => number
  setFileMentionActiveIdx: (idx: number | ((prev: number) => number)) => void
  filteredAgents: () => { name: string; description: string }[]
  agentMentions: () => { name: string; description: string }[]

  updateFileMentionPicker: (value: string, cursor: number) => FileMentionTrigger | null
  closeFileMentionPicker: () => void
  applyFileMention: (file: FffFileResult) => void
  applyAgentMention: (name: string) => void
  removeAgentMention: (name: string) => void
  clearAgentMentions: () => void
}

interface UseComposerPickersConfig {
  cwd: string | null
  input: () => string
  shellMode: () => boolean
  onInput: (val: string) => void
  attachedPaths: () => Set<string>
  onAddFile: (relPath: string) => void
  onAddSkill: (skill: SkillItem) => void
  availableAgentTypes?: { name: string; description: string }[]
  textareaEl?: () => HTMLTextAreaElement | undefined
}

export function useComposerPickers(config: UseComposerPickersConfig): ComposerPickers {
  // ─ Slash command picker state ───────────────────────────────────────────
  const [slashOpen, setSlashOpen] = createSignal(false)
  const [slashQuery, setSlashQuery] = createSignal('')
  const [slashActiveIdx, setSlashActiveIdx] = createSignal(0)
  const [promptCommands, setPromptCommands] = createSignal<SlashCommand[]>([])

  // Load prompt templates (merged with built-ins for the combined command list)
  createEffect(() => {
    const currentCwd = config.cwd
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
    config.onInput(newVal)
    setSlashOpen(false)
    setFileMentionOpen(false)
    requestAnimationFrame(() => {
      const el = config.textareaEl?.()
      if (el) {
        el.style.height = 'auto'
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`
        el.setSelectionRange(newVal.length, newVal.length)
        el.focus()
      }
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
    const currentCwd = config.cwd
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
    config.onInput('')
    setSkillOpen(false)
    closeFileMentionPicker()
    config.onAddSkill(skill)
    requestAnimationFrame(() => config.textareaEl?.()?.focus())
  }

  // ─ File mention picker state ─────────────────────────────────────────────
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
    const types = config.availableAgentTypes
    if (!types || types.length === 0) return []
    const trigger = fileMentionTrigger()
    const query = (trigger?.query ?? '').toLowerCase()
    if (!query) return types
    return types.filter(
      (a) => a.name.toLowerCase().includes(query) || a.description.toLowerCase().includes(query)
    )
  })

  const closeFileMentionPicker = () => {
    setFileMentionOpen(false)
    setFileMentionTrigger(null)
    setFileMentionResults([])
    setFileMentionActiveIdx(0)
  }

  const updateFileMentionPicker = (value: string, cursor: number) => {
    const trigger = findFileMentionTrigger(value, cursor)
    if (!trigger || config.shellMode()) {
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
    const cwd = config.cwd
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

    if (!config.attachedPaths().has(file.relativePath)) {
      config.onAddFile(file.relativePath)
    }

    const next = removeFileMentionToken(config.input(), trigger)
    config.onInput(next.text)
    closeFileMentionPicker()
    requestAnimationFrame(() => {
      const el = config.textareaEl?.()
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
      el.setSelectionRange(next.cursor, next.cursor)
      el.focus()
    })
  }

  const applyAgentMention = (name: string) => {
    const trigger = fileMentionTrigger()
    if (!trigger) return

    // Add chip state — do NOT insert @name into the input text; the chip IS the visual
    const agentType = config.availableAgentTypes?.find((a) => a.name === name)
    const description = agentType?.description ?? `${name} subagent`
    setAgentMentions((prev) => {
      if (prev.some((a) => a.name === name)) return prev
      return [...prev, { name, description }]
    })

    const next = removeFileMentionToken(config.input(), trigger)
    config.onInput(next.text)
    closeFileMentionPicker()
    requestAnimationFrame(() => {
      const el = config.textareaEl?.()
      if (!el) return
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
      el.setSelectionRange(next.cursor, next.cursor)
      el.focus()
    })
  }

  const removeAgentMention = (name: string) => {
    setAgentMentions((prev) => prev.filter((a) => a.name !== name))
  }

  const clearAgentMentions = () => {
    setAgentMentions([])
  }

  return {
    slashOpen,
    slashQuery,
    setSlashQuery,
    setSlashOpen,
    slashActiveIdx,
    setSlashActiveIdx,
    filteredCmds,
    applySlashCommand,
    skillOpen,
    skillQuery,
    setSkillQuery,
    setSkillOpen,
    skillActiveIdx,
    setSkillActiveIdx,
    filteredSkills,
    applySkill,
    agentMentions,
    fileMentionOpen,
    fileMentionTrigger,
    fileMentionResults,
    fileMentionActiveIdx,
    setFileMentionActiveIdx,
    filteredAgents,
    updateFileMentionPicker,
    closeFileMentionPicker,
    applyFileMention,
    applyAgentMention,
    removeAgentMention,
    clearAgentMentions,
  }
}
