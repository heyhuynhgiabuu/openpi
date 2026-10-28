import { readFile } from 'node:fs/promises'
import { fauxAssistantMessage, fauxText } from '@earendil-works/pi-ai'
import { z } from 'zod'
import type { SidecarMessage } from '../../electron/pi/sidecarTypes'

/** Shared reading helpers for the fork tests: the exported file, line ids and the sent messages. */

const lineSchema = z.object({
  type: z.string(),
  id: z.string(),
  parentId: z.string().nullable().optional(),
  message: z.object({ role: z.string(), content: z.unknown(), timestamp: z.number() }).optional(),
})
export type Line = z.infer<typeof lineSchema>

export async function lines(path: string): Promise<Line[]> {
  const text = await readFile(path, 'utf8')
  return text
    .trim()
    .split('\n')
    .map((line) => lineSchema.parse(JSON.parse(line)))
}

export const textOf = (line: Line) => JSON.stringify(line.message?.content ?? '')
export const mentions = (all: Line[], word: string) =>
  all.some((line) => textOf(line).includes(word))
export const idOf = (all: Line[], word: string): string => {
  const found = all.find((line) => line.type === 'message' && textOf(line).includes(word))
  if (!found) throw new Error(`no line mentions ${word}`)
  return found.id
}

export type Ready = Extract<SidecarMessage, { type: 'session_ready' }>
export const readies = (sent: SidecarMessage[]) =>
  sent.filter((m): m is Ready => m.type === 'session_ready')
export const answer = (text: string) =>
  fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' as const })

export function fork(entryId: string, requestId = 'f1') {
  return { type: 'fork_session' as const, entryId, workspaceTrusted: false, requestId }
}

const textPart = z.object({ type: z.literal('text'), text: z.string() })

function partText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part: unknown) => {
      const parsed = textPart.safeParse(part)
      return parsed.success ? parsed.data.text : ''
    })
    .join('')
}

/**
 * What the model could read in a request: each message's role and text, nothing else. Searching the
 * raw JSON instead also scans random ids and timestamps, where a short word like `q2` turns up by
 * chance now and then.
 */
export function readable(messages: readonly { role: string }[]): string {
  return messages
    .map((message) => `${message.role}: ${partText('content' in message ? message.content : '')}`)
    .join('\n')
}
