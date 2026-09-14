import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskToolRow } from '../src/components/conversation/TaskToolRow'
import type { ToolCard } from '../src/types/session'

function taskCard(overrides: Partial<ToolCard> = {}): ToolCard {
  return {
    toolCallId: 'call-1',
    toolName: 'task',
    args: { agent_type: 'scout', description: 'Research SDK docs', background: false },
    output: 'Goal: research the SDK.\n\nFindings: the docs describe navigateTree.',
    isError: false,
    streaming: false,
    details: {
      task_id: 'm1abc-x1y2',
      agent_type: 'scout',
      description: 'Research SDK docs',
      phase: 'done',
      tool_uses: 7,
      duration_ms: 65_000,
    },
    ...overrides,
  }
}

function renderRow(card: ToolCard = taskCard(), onOpenSubSession?: (id: string | null) => void) {
  return render(() => <TaskToolRow card={card} onOpenSubSession={onOpenSubSession} />)
}

afterEach(() => {
  cleanup()
})

describe('TaskToolRow', () => {
  it('starts collapsed and expands on click', async () => {
    const { getByRole, queryByText, findByText } = renderRow(taskCard(), () => {})
    const header = getByRole('button', { name: /Task · scout · Research SDK docs/ })

    expect(header.getAttribute('aria-expanded')).toBe('false')
    expect(queryByText(/phase done/)).toBeNull()

    fireEvent.click(header)

    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(await findByText(/phase done/)).toBeTruthy()
    expect(getByRole('button', { name: /Open sub-session/ })).toBeTruthy()
  })

  it('summarizes the run and previews the result', async () => {
    const { getByRole, findByText, getByText } = renderRow()

    fireEvent.click(getByRole('button', { name: /Task · scout/ }))

    const facts = await findByText(/phase done/)
    expect(facts.textContent).toContain('foreground')
    expect(facts.textContent).toContain('7 tool calls')
    expect(facts.textContent).toContain('1m 5s')
    expect(getByText(/Findings: the docs describe navigateTree/)).toBeTruthy()
  })

  it('opens the sub-session from the panel, not from the header', async () => {
    const onOpenSubSession = vi.fn()
    const { getByRole } = renderRow(taskCard(), onOpenSubSession)

    fireEvent.click(getByRole('button', { name: /Task · scout/ }))
    expect(onOpenSubSession).not.toHaveBeenCalled()

    fireEvent.click(getByRole('button', { name: /Open sub-session/ }))
    expect(onOpenSubSession).toHaveBeenCalledWith('m1abc-x1y2')
  })

  it('truncates a long result and offers no jump without a task id', async () => {
    const long = 'x'.repeat(4200)
    const { getByRole, findByText, queryByRole } = renderRow(
      taskCard({ output: long, details: { agent_type: 'scout', description: 'Long' } })
    )

    fireEvent.click(getByRole('button', { name: /Task · scout/ }))

    const preview = await findByText(/^x+…$/)
    expect(preview.textContent?.length).toBe(4001)
    expect(queryByRole('button', { name: /Open sub-session/ })).toBeNull()
  })

  it('shows a handed-off background task as pending', async () => {
    // pi-task answers a background launch immediately with "Started task …" and
    // no phase; the run continues after the tool call returns.
    const { getByRole, getByText } = renderRow(
      taskCard({
        output: 'Started task m1abc-x1y2 in the background. Do not poll.',
        details: { agent_type: 'scout', description: 'Slow research', background: true },
      })
    )

    const header = getByRole('button', { name: /Task · scout/ })
    expect(header.closest('.task-tool')?.getAttribute('data-status')).toBe('pending')
    expect(getByText('running')).toBeTruthy()
    expect(getByText('background')).toBeTruthy()
  })
})
