import { isRecord, parseUsage, type ParsedUsage } from './usageParse'

/** Token/cost totals for one agent run — every turn since the last `agent_start`. */
export interface RunUsage extends ParsedUsage {
  turns: number
}

export const EMPTY_RUN_USAGE: RunUsage = {
  turns: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  cost: 0,
}

/**
 * Folds a `turn_end` event into the running total. A turn counts even when the
 * provider reported no usage (aborted or empty response), so the turn count
 * stays truthful while the token totals simply do not move.
 */
export function addTurnUsage(run: RunUsage, event: unknown): RunUsage {
  const message = isRecord(event) ? event.message : undefined
  const usage = parseUsage(isRecord(message) ? message.usage : undefined)
  return {
    turns: run.turns + 1,
    input: run.input + usage.input,
    output: run.output + usage.output,
    cacheRead: run.cacheRead + usage.cacheRead,
    cacheWrite: run.cacheWrite + usage.cacheWrite,
    total: run.total + usage.total,
    cost: run.cost + usage.cost,
  }
}
