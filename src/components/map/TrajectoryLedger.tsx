/**
 * TrajectoryLedger — flat, chronological ledger of the branch the session is
 * on: one row per entry with timing, token, and cost metrics from OpenPi's
 * indexer. Every row carries its entry id, so clicking a message jumps the
 * conversation to it (same guard rails as the session map) and the map can
 * highlight it. Display only — no authority over the session.
 */
import type { Component } from 'solid-js'
import { createMemo, For, Show } from 'solid-js'
import type { TrajectoryRow } from '../../lib/ipc'

export interface TrajectoryLedgerProps {
  rows: TrajectoryRow[]
  query: string
  isEntryLoaded: (entryId: string) => boolean
  onNavigate: (entryId: string) => void
  onNotice: (message: string) => void
}

function kindLabel(row: TrajectoryRow): string {
  if (row.type === 'message') return row.role === 'user' ? 'You' : 'Assistant'
  if (row.type === 'compaction') return 'Compaction'
  if (row.type === 'model_change') return 'Model'
  if (row.type === 'branch_summary') return 'Branch summary'
  if (row.type === 'label') return 'Label'
  if (row.type === 'session_info') return 'Name'
  if (row.type === 'thinking_level_change') return 'Thinking'
  return row.type
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleTimeString(undefined, { hour12: false })
}

function formatDuration(durationMs: number): string {
  if (!durationMs) return '—'
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function formatCost(cost: number): string {
  if (!cost) return '—'
  return `$${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(2)}`
}

function formatTokens(row: TrajectoryRow): string {
  if (!row.totalTokens) return '—'
  return row.totalTokens.toLocaleString()
}

export const TrajectoryLedger: Component<TrajectoryLedgerProps> = (props) => {
  const rows = createMemo(() => {
    const needle = props.query.trim().toLowerCase()
    if (!needle) return props.rows
    return props.rows.filter((row) =>
      `${kindLabel(row)} ${row.preview} ${row.model ?? ''}`.toLowerCase().includes(needle)
    )
  })

  const totals = createMemo(() => {
    let totalTokens = 0
    let cost = 0
    for (const row of rows()) {
      totalTokens += row.totalTokens
      cost += row.cost
    }
    return { totalTokens, cost }
  })

  const select = (row: TrajectoryRow) => {
    if (!row.navigable) {
      props.onNotice('This entry has no message in the conversation.')
      return
    }
    if (!props.isEntryLoaded(row.entryId)) {
      props.onNotice(
        'Not loaded in the conversation yet — scroll back in the chat to load older history.'
      )
      return
    }
    props.onNavigate(row.entryId)
  }

  return (
    <div class="trajectory-ledger">
      <div class="trajectory-ledger-header">
        <span>{rows().length} entries on the current branch</span>
        <span title="Totals for the rows shown">
          {totals().totalTokens.toLocaleString()} tokens · {formatCost(totals().cost)}
        </span>
      </div>
      <Show when={rows().length > 0} fallback={<div class="file-mention-empty">No entries</div>}>
        <div class="trajectory-rows">
          <For each={rows()}>
            {(row) => (
              <button
                type="button"
                class={`trajectory-row${row.navigable ? ' is-navigable' : ' is-meta'}${
                  row.entryId === props.rows[props.rows.length - 1]?.entryId ? ' is-leaf' : ''
                }`}
                onClick={() => select(row)}
                title={`${kindLabel(row)} · ${formatDuration(row.durationMs)} · in ${row.inputTokens.toLocaleString()} / out ${row.outputTokens.toLocaleString()}${
                  row.cacheReadTokens ? ` · cache ${row.cacheReadTokens.toLocaleString()}` : ''
                }`}
              >
                <span class="trajectory-time">{formatTime(row.timestamp)}</span>
                <span class="trajectory-kind">{kindLabel(row)}</span>
                <Show when={row.type === 'model_change' && row.model}>
                  <span class="trajectory-model">{row.model}</span>
                </Show>
                <span class="trajectory-preview">{row.preview}</span>
                <span class="trajectory-metrics">
                  <Show when={row.freedTokens != null}>
                    <span class="trajectory-freed">{`freed ${row.freedTokens?.toLocaleString()}`}</span>
                  </Show>
                  <Show when={row.durationMs > 0}>
                    <span>{formatDuration(row.durationMs)}</span>
                  </Show>
                  <Show when={row.totalTokens > 0}>
                    <span
                      title={`in ${row.inputTokens.toLocaleString()} / out ${row.outputTokens.toLocaleString()}`}
                    >
                      {`${formatTokens(row)} tok`}
                    </span>
                  </Show>
                  <Show when={row.cost > 0}>
                    <span>{formatCost(row.cost)}</span>
                  </Show>
                </span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}
