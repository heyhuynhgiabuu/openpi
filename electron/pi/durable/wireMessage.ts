import type { AssistantMessage, AssistantMessageEvent, ToolCall } from '@earendil-works/pi-ai'
import type { MessageChange } from '@earendil-works/pi-durable'

/**
 * Phase 8.3k: the in-flight assistant message. pi-durable streams `changes[]` relative to the
 * message; the renderer wants the whole partial message plus one `assistantMessageEvent` per change.
 */

type Block = AssistantMessage['content'][number]

function withBlock(message: AssistantMessage, index: number, block: Block): AssistantMessage {
  const content = [...message.content]
  content[index] = block
  return { ...message, content }
}

/** Apply one in-flight change to the partial message and name the renderer event it becomes. */
export function applyChange(
  partial: AssistantMessage,
  change: MessageChange
): { partial: AssistantMessage; event?: AssistantMessageEvent } {
  switch (change.type) {
    case 'text_start':
    case 'thinking_start':
    case 'toolcall_start': {
      const next = withBlock(partial, change.contentIndex, change.block)
      return {
        partial: next,
        event: { type: change.type, contentIndex: change.contentIndex, partial: next },
      }
    }
    case 'text_delta': {
      const block = partial.content[change.contentIndex]
      const next =
        block?.type === 'text'
          ? withBlock(partial, change.contentIndex, { ...block, text: block.text + change.delta })
          : partial
      return {
        partial: next,
        event: {
          type: 'text_delta',
          contentIndex: change.contentIndex,
          delta: change.delta,
          partial: next,
        },
      }
    }
    case 'thinking_delta': {
      const block = partial.content[change.contentIndex]
      const next =
        block?.type === 'thinking'
          ? withBlock(partial, change.contentIndex, {
              ...block,
              thinking: block.thinking + change.delta,
            })
          : partial
      return {
        partial: next,
        event: {
          type: 'thinking_delta',
          contentIndex: change.contentIndex,
          delta: change.delta,
          partial: next,
        },
      }
    }
    case 'toolcall_delta':
      // Arguments are rebuilt from the finished block; the renderer ignores tool-call deltas.
      return {
        partial,
        event: {
          type: 'toolcall_delta',
          contentIndex: change.contentIndex,
          delta: change.delta,
          partial,
        },
      }
    case 'block': {
      const next = withBlock(partial, change.contentIndex, change.block)
      const block = change.block
      const index = change.contentIndex
      if (block.type === 'text')
        return {
          partial: next,
          event: { type: 'text_end', contentIndex: index, content: block.text, partial: next },
        }
      if (block.type === 'thinking')
        return {
          partial: next,
          event: {
            type: 'thinking_end',
            contentIndex: index,
            content: block.thinking,
            partial: next,
          },
        }
      if (block.type === 'toolCall') {
        const toolCall: ToolCall = block
        return {
          partial: next,
          event: { type: 'toolcall_end', contentIndex: index, toolCall, partial: next },
        }
      }
      return { partial: next }
    }
    case 'message':
      return { partial: change.message }
    default: {
      const unreachable: never = change
      return unreachable
    }
  }
}
