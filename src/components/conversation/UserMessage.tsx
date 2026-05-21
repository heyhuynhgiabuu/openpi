import type { Component } from 'solid-js'
import type { SessionHistoryMessage } from '../../lib/ipc'
import { MarkdownContent } from './MarkdownContent'
import { MessageActions } from './MessageActions'

interface UserMessageProps {
  message: SessionHistoryMessage
  onFork?: (id: string) => void
}

export const UserMessage: Component<UserMessageProps> = (props) => {
  return (
    <div class="message-row user-message-row">
      <div class="user-msg-stack">
        <div class="user-bubble">
          <MarkdownContent text={props.message.text} />
        </div>
        <MessageActions
          messageId={props.message.id}
          getText={() => props.message.text}
          streaming={props.message.streaming}
          onFork={props.onFork}
        />
      </div>
    </div>
  )
}
