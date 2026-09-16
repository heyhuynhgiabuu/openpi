/**
 * Time-range keys shared by the usage card UI: labels, day windows.
 */

export const RANGE_KEYS = ['7d', '30d', '90d', 'all'] as const

export type RangeKey = (typeof RANGE_KEYS)[number]

export function rangeLabel(key: RangeKey): string {
  if (key === '7d') return '1W'
  if (key === '30d') return '1M'
  if (key === '90d') return '3M'
  return 'All'
}

export function rangeToDays(key: RangeKey): number {
  if (key === '7d') return 7
  if (key === '30d') return 30
  if (key === '90d') return 90
  return 365
}
