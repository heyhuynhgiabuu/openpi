import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it } from 'vitest'

import { AssistantMessageGroup } from '../src/components/conversation/Messages'
import { DEFAULT_DISPLAY_PREFERENCES } from '../src/lib/displayPreferences'
import type { SessionHistoryMessage } from '../src/lib/ipc'
import { applySessionEvent } from '../src/lib/sessionEvents'
import type { Message } from '../src/types/session'
import { appendHistoryEntry, type HistoryReadState } from '../electron/session/sessionHistory'
import {
  codemodeToolEvents,
  codemodeTurnEvents,
  parseEvents,
  persistedCodemodeEntries,
} from './helpers/nestedToolEvents'

const baseMessage: SessionHistoryMessage = {
  id: 'msg-1',
  role: 'assistant',
  text: '',
  streaming: false,
  toolCards: [
    {
      toolCallId: 'tool-1',
      toolName: 'read',
      args: { path: 'src/index.ts' },
      output: 'ok',
      isError: false,
      streaming: false,
    },
    {
      toolCallId: 'tool-2',
      toolName: 'bash',
      args: { command: 'npm test' },
      output: 'running',
      isError: false,
      streaming: true,
    },
  ],
}

afterEach(() => cleanup())

describe('AssistantMessageGroup', () => {
  it('shimmers the running tool card while agent streaming is active', () => {
    const { container } = render(() => (
      <AssistantMessageGroup
        messages={[baseMessage]}
        agentStreaming={true}
        displayPreferences={DEFAULT_DISPLAY_PREFERENCES}
      />
    ))

    expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(2)
    expect(container.querySelectorAll('.tool-shimmer-scope.is-tool-shimmering')).toHaveLength(1)
  })

  it('shimmers the latest visible tool while tool streaming state is between events', () => {
    const betweenEvents: SessionHistoryMessage = {
      ...baseMessage,
      toolCards: baseMessage.toolCards.map((c) => ({ ...c, streaming: false })),
    }
    const { container } = render(() => (
      <AssistantMessageGroup
        messages={[betweenEvents]}
        agentStreaming={true}
        displayPreferences={DEFAULT_DISPLAY_PREFERENCES}
      />
    ))

    expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(2)
    expect(container.querySelectorAll('.tool-shimmer-scope.is-tool-shimmering')).toHaveLength(1)
  })

  it('does not shimmer any tool card when none are running', () => {
    const stopped: SessionHistoryMessage = {
      ...baseMessage,
      toolCards: baseMessage.toolCards.map((c) => ({ ...c, streaming: false })),
    }
    const { container } = render(() => (
      <AssistantMessageGroup
        messages={[stopped]}
        agentStreaming={false}
        displayPreferences={DEFAULT_DISPLAY_PREFERENCES}
      />
    ))

    expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(2)
    expect(container.querySelectorAll('.tool-shimmer-scope.is-tool-shimmering')).toHaveLength(0)
  })
})

describe('AssistantMessageGroup with a codemode run and its nested write', () => {
  const assistantRows = (messages: Message[]) =>
    messages.filter((m): m is SessionHistoryMessage => m.role === 'assistant')
  const fold = (events: ReturnType<typeof parseEvents>) =>
    events.reduce<Message[]>((messages, event) => applySessionEvent(messages, event), [])

  function renderRail(messages: SessionHistoryMessage[], agentStreaming: boolean) {
    return render(() => (
      <AssistantMessageGroup
        messages={messages}
        agentStreaming={agentStreaming}
        displayPreferences={DEFAULT_DISPLAY_PREFERENCES}
      />
    )).container
  }

  it('draws one running card while the nested call runs, not one per call', () => {
    const tool = codemodeToolEvents()
    const live = fold(
      parseEvents([
        { type: 'message_start', message: { role: 'assistant', timestamp: 1 } },
        tool.start,
        tool.nestedStart,
        tool.nestedEnd,
      ])
    )
    const container = renderRail(assistantRows(live), true)

    expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(1)
    expect(container.querySelectorAll('.tool-shimmer-scope.is-tool-shimmering')).toHaveLength(1)
  })

  it('draws the same single settled card live and after the history reloads', () => {
    const live = renderRail(assistantRows(fold(codemodeTurnEvents())), false)
    const resumed: SessionHistoryMessage[] = []
    const state: HistoryReadState = { lastUserTimestampMs: null }
    for (const entry of persistedCodemodeEntries()) appendHistoryEntry(resumed, entry, state)
    const reloaded = renderRail(
      resumed.filter((m) => m.role === 'assistant'),
      false
    )

    for (const container of [live, reloaded]) {
      expect(container.querySelectorAll('.tool-shimmer-scope')).toHaveLength(1)
      expect(container.querySelectorAll('.is-tool-shimmering')).toHaveLength(0)
    }
    expect(live.querySelector('.tool-row')?.outerHTML).toBe(
      reloaded.querySelector('.tool-row')?.outerHTML
    )
  })
})
