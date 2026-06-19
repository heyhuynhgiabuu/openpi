import type { UsageSummary } from '../../lib/ipc'

export function downloadUsageJson(summary: UsageSummary, label: string): void {
  const blob = new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' })
  triggerDownload(blob, usageFilename(label, 'json'))
}

export function buildUsageCsvContent(summary: UsageSummary, label: string): string {
  const lines: string[] = []
  lines.push(
    '# OpenPi usage export',
    `# scope: ${label}`,
    `# generated: ${summary.generatedAt}`,
    `# range_days: ${summary.days}`,
    ''
  )
  lines.push(
    'section,date,model,provider,input,output,cache_read,cache_write,total_tokens,turns,sessions,cost,cache_hit_rate'
  )
  for (const day of summary.daily) {
    lines.push(
      csvRow([
        'daily',
        day.date,
        '',
        '',
        day.inputTokens,
        day.outputTokens,
        day.cacheReadTokens,
        day.cacheWriteTokens,
        day.totalTokens,
        day.turnCount,
        day.sessionCount,
        day.cost,
        day.cacheHitRate ?? '',
      ])
    )
  }
  for (const m of summary.models) {
    lines.push(
      csvRow([
        'model',
        '',
        m.model,
        m.provider ?? '',
        m.inputTokens,
        m.outputTokens,
        m.cacheReadTokens,
        m.cacheWriteTokens,
        m.totalTokens,
        m.turnCount,
        m.sessionCount,
        m.cost,
        m.cacheHitRate ?? '',
      ])
    )
  }
  return lines.join('\n')
}

export function downloadUsageCsv(summary: UsageSummary, label: string): void {
  const blob = new Blob([buildUsageCsvContent(summary, label)], {
    type: 'text/csv;charset=utf-8',
  })
  triggerDownload(blob, usageFilename(label, 'csv'))
}

function csvRow(cells: (string | number)[]): string {
  return cells
    .map((c) => {
      const s = String(c)
      if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`
      }
      return s
    })
    .join(',')
}

function usageFilename(label: string, ext: string): string {
  const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'usage'
  const day = new Date().toISOString().slice(0, 10)
  return `openpi-usage-${safe}-${day}.${ext}`
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
