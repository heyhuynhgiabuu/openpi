/**
 * sessionEntryUtils.ts — Small, standalone utility functions extracted from
 * sessionEntries.ts for working with session data.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { SessionEntry } from './sessionEntries'

export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text?: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

export function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function usageTotalTokens(usage: Record<string, unknown>): number {
  return (
    numeric(usage.totalTokens) ||
    (numeric(usage.input) || numeric(usage.inputTokens)) +
      (numeric(usage.output) || numeric(usage.outputTokens)) +
      (numeric(usage.cacheRead) || numeric(usage.cacheReadTokens)) +
      (numeric(usage.cacheWrite) || numeric(usage.cacheWriteTokens))
  )
}

export function entryTimestampMs(
  entry: SessionEntry,
  message: Record<string, unknown>
): number | null {
  const messageTimestamp = numeric(message.timestamp)
  if (messageTimestamp > 0) return messageTimestamp
  const parsed = Date.parse(entry.timestamp)
  return Number.isFinite(parsed) ? parsed : null
}

export function durationFrom(startMs: number | null, endMs: number | null): number | undefined {
  if (!startMs || !endMs || endMs <= startMs) return undefined
  return endMs - startMs
}

export function truncate(value: string, length: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized
}

export function canonicalizePath(value: string): string {
  try {
    return fs.realpathSync.native(value)
  } catch {
    return path.resolve(value)
  }
}

export function displayNameForPath(value: string): string {
  return path.basename(value) || value
}

export function toIso(value: Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
