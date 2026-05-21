import { Check, ListChecks, Sparkle } from 'lucide-solid'
import { type Component, For, Show } from 'solid-js'
import type { ToolCard } from '../../types/session'

const PLAN_TOOL = 'update_plan'

type PlanItemStatus = 'pending' | 'in_progress' | 'completed'

interface PlanItem {
  step: string
  status: PlanItemStatus
}

interface PlanSummary {
  items: PlanItem[]
  explanation: string
  completed: number
  active: PlanItem | null
}

export function isPlanToolCard(card: unknown): card is ToolCard {
  return Boolean(
    card && typeof card === 'object' && (card as { toolName?: unknown }).toolName === PLAN_TOOL
  )
}

export function latestPlanCard(messages: unknown[]): ToolCard | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || typeof message !== 'object') continue
    const cards = (message as { toolCards?: unknown }).toolCards
    if (!Array.isArray(cards)) continue

    for (let j = cards.length - 1; j >= 0; j--) {
      const card = cards[j]
      if (isPlanToolCard(card)) return card
    }
  }
  return null
}

function isPlanItemStatus(value: unknown): value is PlanItemStatus {
  return value === 'pending' || value === 'in_progress' || value === 'completed'
}

function parsePlanItems(card: ToolCard): PlanItem[] {
  const raw = card.args.plan
  if (!Array.isArray(raw)) return []

  return raw
    .map((item): PlanItem | null => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const step = typeof record.step === 'string' ? record.step.trim() : ''
      const status = record.status
      if (!step || !isPlanItemStatus(status)) return null
      return { step, status }
    })
    .filter((item): item is PlanItem => item !== null)
}

function planSummary(card: ToolCard): PlanSummary {
  const items = parsePlanItems(card)
  const explanation = typeof card.args.explanation === 'string' ? card.args.explanation.trim() : ''
  return {
    items,
    explanation,
    completed: items.filter((item) => item.status === 'completed').length,
    active: items.find((item) => item.status === 'in_progress') ?? null,
  }
}

function statusLabel(status: PlanItemStatus): string {
  switch (status) {
    case 'completed':
      return 'done'
    case 'in_progress':
      return 'now'
    case 'pending':
      return 'next'
  }
}

function statusIcon(status: PlanItemStatus) {
  if (status === 'completed') return <Check size={12} strokeWidth={2.4} />
  if (status === 'in_progress') return <Sparkle size={12} strokeWidth={2.2} />
  return <span aria-hidden="true">◻</span>
}

interface PlanDockProps {
  card: ToolCard | null
}

export const PlanDock: Component<PlanDockProps> = (props) => {
  const summary = () => (props.card ? planSummary(props.card) : null)
  const isActive = () => Boolean(props.card?.streaming || summary()?.active)
  const isComplete = () => {
    const value = summary()
    return Boolean(value && value.items.length > 0 && value.completed === value.items.length)
  }

  return (
    <Show when={props.card && summary()}>
      {(value) => (
        <aside
          class={`plan-dock${isActive() ? ' is-active' : ''}${isComplete() ? ' is-complete' : ''}`}
          aria-label="Current plan"
          aria-live="polite"
        >
          <div class="plan-dock-header">
            <span class="plan-dock-icon" aria-hidden="true">
              <ListChecks size={14} strokeWidth={2.2} />
            </span>
            <div class="plan-dock-title-group">
              <span class="plan-dock-title">Plan</span>
              <Show
                when={value().active}
                fallback={
                  <span class="plan-dock-subtitle">
                    {value().completed} / {value().items.length} done
                  </span>
                }
              >
                {(item) => <span class="plan-dock-subtitle">Now: {item().step}</span>}
              </Show>
            </div>
            <span class="plan-dock-count">
              {value().completed}/{value().items.length}
            </span>
          </div>

          <Show when={value().explanation}>
            <div class="plan-dock-explanation">{value().explanation}</div>
          </Show>

          <ol class="plan-dock-list">
            <For each={value().items}>
              {(item) => (
                <li class={`plan-dock-item plan-dock-item--${item.status}`}>
                  <span class="plan-dock-marker" aria-hidden="true">
                    {statusIcon(item.status)}
                  </span>
                  <span class="plan-dock-step">{item.step}</span>
                  <span class="plan-dock-status">{statusLabel(item.status)}</span>
                </li>
              )}
            </For>
          </ol>
        </aside>
      )}
    </Show>
  )
}
