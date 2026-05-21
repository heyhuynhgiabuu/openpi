import { BookOpen } from 'lucide-solid'
import type { Component } from 'solid-js'
import { createEffect, For, Show } from 'solid-js'
import type { SkillItem } from '../../lib/ipc'
import type { SlashCommand } from './types'

type SlashCommandPickerProps = {
  commands: SlashCommand[]
  activeIdx: number
  onSelect: (cmd: SlashCommand) => void
  onSetActiveIdx: (idx: number) => void
}

export const SlashCommandPicker: Component<SlashCommandPickerProps> = (props) => {
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

type SkillPickerProps = {
  skills: SkillItem[]
  activeIdx: number
  onSelect: (skill: SkillItem) => void
  onSetActiveIdx: (idx: number) => void
}

export const SkillPicker: Component<SkillPickerProps> = (props) => {
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
