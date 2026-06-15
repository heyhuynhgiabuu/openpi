// biome-ignore-all lint/a11y/noStaticElementInteractions lint/a11y/noSvgWithoutTitle: existing composer picker/progress markup is tracked separately from this release.
import { Paperclip } from 'lucide-solid'
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js'
import { isMacPlatform } from '../lib/shortcutFormat'
import { ContextUsageButton, TpsBadge } from './composer/Badges'
import { AgentChip, FileChip, LineCommentChip, SkillChip } from './composer/Chips'
import { SkillPicker, SlashCommandPicker } from './composer/CommandPicker'
import { ComposerHint } from './composer/ComposerHint'
import { ContextPicker } from './composer/ContextPicker'
import { DeliveryMode } from './composer/DeliveryMode'
import { MentionPicker } from './composer/MentionPicker'
import { ModelPicker } from './composer/ModelPicker'
import { QueueList } from './composer/QueueList'
import { SendButton } from './composer/SendButton'
import { ShellBanner } from './composer/ShellBanner'
import { ThinkingPicker } from './composer/ThinkingPicker'
import type { ComposerProps } from './composer/types'
import { useComposerInput } from './composer/useComposerInput'
import { useComposerKeybindings } from './composer/useComposerKeybindings'
import { useComposerPickers } from './composer/useComposerPickers'
import { useComposerTextareaKeyboard } from './composer/useComposerTextareaKeyboard'
import { usePromptHistory } from './composer/usePromptHistory'

export { formatSlashCommandInput } from './composer/helpers'

// ─── Main Composer ───────────────────────────────────────────────────────────

export const Composer: Component<ComposerProps> = (props) => {
  const [shellMode, setShellMode] = createSignal(false)

  let textareaEl: HTMLTextAreaElement | undefined

  const {
    slashOpen,
    filteredCmds,
    slashActiveIdx,
    setSlashActiveIdx,
    setSlashQuery,
    setSlashOpen,
    applySlashCommand,
    skillOpen,
    filteredSkills,
    skillActiveIdx,
    setSkillActiveIdx,
    setSkillQuery,
    setSkillOpen,
    applySkill,
    fileMentionOpen,
    fileMentionTrigger,
    fileMentionResults,
    fileMentionActiveIdx,
    setFileMentionActiveIdx,
    filteredAgents,
    agentMentions,
    updateFileMentionPicker,
    closeFileMentionPicker,
    applyFileMention,
    applyAgentMention,
    removeAgentMention,
    clearAgentMentions,
  } = useComposerPickers({
    cwd: props.cwd,
    input: () => props.input,
    shellMode,
    onInput: props.onInput,
    attachedPaths: () => attachedSet(),
    onAddFile: props.onAddFile,
    onAddSkill: props.onAddSkill,
    availableAgentTypes: props.availableAgentTypes,
    textareaEl: () => textareaEl,
  })

  const { historyIndex, setHistoryIndex, setSavedDraft, historyBack, historyForward } =
    usePromptHistory({
      input: () => props.input,
      onInput: props.onInput,
      promptHistory: () => props.promptHistory,
    })

  const attachedSet = createMemo(() => new Set(props.attachedFiles))

  // Wrap onSend to prepend agent mention tokens, then clear chips
  const handleSend = () => {
    const mentions = agentMentions()
    if (mentions.length > 0) {
      const prefix = mentions.map((a) => `@${a.name}`).join(' ')
      props.onInput(`${prefix} ${props.input}`)
    }
    clearAgentMentions()
    props.onSend()
  }

  const textareaOnKeyDown = useComposerTextareaKeyboard({
    shellMode,
    setShellMode,
    onShellSend: props.onShellSend,
    isStreaming: () => props.isStreaming,
    input: () => props.input,
    promptHistoryLength: () => props.promptHistory.length,

    fileMentionOpen,
    fileMentionResults,
    fileMentionActiveIdx,
    filteredAgents,
    slashOpen,
    filteredCmds,
    slashActiveIdx,
    skillOpen,
    filteredSkills,
    skillActiveIdx,

    historyIndex,

    applyFileMention,
    applyAgentMention,
    applySlashCommand,
    applySkill,
    closeFileMentionPicker,
    setFileMentionActiveIdx,
    setSlashActiveIdx,
    setSlashOpen,
    setSkillActiveIdx,
    setSkillOpen,

    setHistoryIndex,
    setSavedDraft,
    historyBack,
    historyForward,

    handleSend,
    onQueueMode: props.onQueueMode as (mode: string | ((prev: string) => string)) => void,
  })

  const textareaOnInput = useComposerInput({
    shellMode,
    historyIndex,
    setHistoryIndex,
    slashOpen,
    setSlashOpen,
    setSlashQuery,
    skillOpen,
    setSkillOpen,
    setSkillQuery,
    textareaEl: () => textareaEl,
    onInput: props.onInput,
    updateFileMentionPicker,
    closeFileMentionPicker,
  })

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

  useComposerKeybindings({
    input: () => props.input,
    isStreaming: () => props.isStreaming,
    shellMode,
    setShellMode,
    setPickerOpen,
    modelOpen,
    setModelOpen,
    setThinkingOpen,
    modelSearchRef: () => modelSearchRef,
    textareaEl: () => textareaEl,
    closeFileMentionPicker,
    setSlashOpen,
    setSkillOpen,
    thinkingLevel: props.thinkingLevel,
    onThinkingLevel: props.onThinkingLevel,
    onInput: props.onInput,
    onQueueMode: props.onQueueMode as (fn: (m: string) => string) => void,
  })

  // Close dropdowns on outside click

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
        <QueueList steeringQueue={props.steeringQueue} followUpQueue={props.followUpQueue} />

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

          <ShellBanner shellMode={shellMode()} onCancel={() => setShellMode(false)} />

          <textarea
            ref={(el) => {
              textareaEl = el
              props.setTextareaRef(el)
            }}
            rows={3}
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
            onInput={textareaOnInput}
            onKeyDown={textareaOnKeyDown}
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
                  title={`Add context file (${isMacPlatform() ? '⌘/' : 'Ctrl+/'})`}
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

              <ModelPicker
                modelOpen={modelOpen()}
                modelSearch={modelSearch()}
                currentModel={props.currentModel}
                filteredModels={filteredModels}
                onToggle={() => {
                  setModelOpen((v) => !v)
                  setThinkingOpen(false)
                  setPickerOpen(false)
                }}
                onSearchChange={(v) => setModelSearch(v)}
                onSelectModel={(m) => {
                  props.onSelectModel(m)
                  setModelSearch('')
                }}
                onConnectProvider={props.onConnectProvider}
                onManageModels={props.onManageModels}
                onClose={() => {
                  setModelOpen(false)
                  setModelSearch('')
                }}
                wrapperRef={(el) => {
                  modelRef = el
                }}
              />

              <ThinkingPicker
                thinkingOpen={thinkingOpen()}
                thinkingLevel={props.thinkingLevel}
                onToggle={() => {
                  setThinkingOpen((v) => !v)
                  setModelOpen(false)
                  setPickerOpen(false)
                }}
                onSelect={(level) => props.onThinkingLevel(level)}
                onClose={() => setThinkingOpen(false)}
                wrapperRef={(el) => {
                  thinkingRef = el
                }}
              />

              {/* Context usage indicator */}
              <Show when={props.contextPercent !== null && props.contextPercent !== undefined}>
                <span class="composer-toolbar-divider" aria-hidden />
                <ContextUsageButton
                  percent={props.contextPercent as number}
                  stats={props.sessionStats}
                />
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
                <DeliveryMode queueMode={props.queueMode} onQueueMode={props.onQueueMode} />
                <span class="composer-toolbar-divider" aria-hidden />
              </Show>

              <SendButton
                isStreaming={props.isStreaming}
                isShellRunning={props.isShellRunning}
                shellMode={shellMode()}
                input={props.input}
                attachedFilesCount={props.attachedFiles.length}
                lineCommentsCount={props.lineComments.length}
                loadedSkillsCount={props.loadedSkills.length}
                onSend={handleSend}
                onShellSend={props.onShellSend}
                onAbort={props.onAbort}
              />
            </div>
          </div>
        </div>

        <ComposerHint
          shellMode={shellMode()}
          isStreaming={props.isStreaming}
          queueMode={props.queueMode}
        />
      </div>
    </div>
  )
}
