import { BookOpen, Bot, MessageSquare } from 'lucide-solid'
import type { Component } from 'solid-js'
import { FileIcon } from '../../lib/fileIcons'
import type { FileLineComment } from '../../lib/fileLineComments'
import { formatLineRange } from '../../lib/fileLineComments'
import type { SkillItem } from '../../lib/ipc'

type FileChipProps = { relPath: string; onRemove: () => void }

export const FileChip: Component<FileChipProps> = (props) => {
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

type LineCommentChipProps = { comment: FileLineComment; onRemove: () => void }

export const LineCommentChip: Component<LineCommentChipProps> = (props) => {
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

type AgentChipProps = { name: string; description: string; onRemove: () => void }

export const AgentChip: Component<AgentChipProps> = (props) => {
  return (
    <span class="ctx-chip ctx-chip--agent" title={props.description}>
      <span class="ctx-chip-icon ctx-chip-icon--agent">
        <Bot size={10} strokeWidth={2.5} />
      </span>
      <span class="ctx-chip-name">{props.name.charAt(0).toUpperCase() + props.name.slice(1)}</span>
      <button
        type="button"
        class="ctx-chip-remove"
        onClick={props.onRemove}
        tabIndex={-1}
        aria-label={`Remove @${props.name}`}
      >
        ×
      </button>
    </span>
  )
}

type SkillChipProps = { skill: SkillItem; onRemove: () => void }

export const SkillChip: Component<SkillChipProps> = (props) => {
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
