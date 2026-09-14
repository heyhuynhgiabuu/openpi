/**
 * Shared parsing for Pi `Usage` payloads and other loosely-typed numeric
 * fields arriving from the session event stream.
 *
 * Providers differ in shape (nested `cost.total` vs a numeric `cost`) and
 * partial events omit fields entirely, so every read is defensive.
 */

export interface ParsedUsage {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
  cost: number
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Normalizes a provider usage payload; missing fields become 0. */
export function parseUsage(value: unknown): ParsedUsage {
  const usage = isRecord(value) ? value : {}
  const input = numeric(usage.input)
  const output = numeric(usage.output)
  const cacheRead = numeric(usage.cacheRead)
  const cacheWrite = numeric(usage.cacheWrite)
  const cost = usage.cost
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: numeric(usage.totalTokens) || input + output + cacheRead + cacheWrite,
    cost: typeof cost === 'number' ? cost : numeric(isRecord(cost) ? cost.total : undefined),
  }
}
