import type { SlashCommand } from '../components/composer/types'

export type SlashCommandSource = 'builtin' | 'extension' | 'prompt' | 'skill'

export interface SlashCommandDto {
  name: string
  description: string
  argHint?: string
  source: SlashCommandSource
}

/** Pi SDK exposes skill entries as `skill:name` — keep them out of the `/` command picker. */
export function isSkillSlashEntry(name: string): boolean {
  return name.startsWith('skill:')
}

export function slashCommandDtoToPickerItem(dto: SlashCommandDto): SlashCommand {
  const name = dto.name.startsWith('/') ? dto.name : `/${dto.name}`
  return {
    name,
    description: dto.description,
    argHint: dto.argHint,
  }
}

const SOURCE_RANK: Record<SlashCommandSource, number> = {
  builtin: 0,
  extension: 1,
  prompt: 2,
  skill: 3,
}

/** Merge Pi session commands with stable ordering and dedupe by slash name. */
export function mergeSlashCommandsForPicker(dtos: SlashCommandDto[]): SlashCommand[] {
  const byName = new Map<string, { dto: SlashCommandDto; rank: number }>()

  for (const dto of dtos) {
    if (dto.source === 'builtin' || isSkillSlashEntry(dto.name)) continue
    const item = slashCommandDtoToPickerItem(dto)
    const key = item.name.toLowerCase()
    const rank = SOURCE_RANK[dto.source] ?? 99
    const existing = byName.get(key)
    if (!existing || rank < existing.rank) {
      byName.set(key, { dto, rank })
    }
  }

  return [...byName.values()]
    .map((entry) => slashCommandDtoToPickerItem(entry.dto))
    .sort((a, b) => a.name.localeCompare(b.name))
}
