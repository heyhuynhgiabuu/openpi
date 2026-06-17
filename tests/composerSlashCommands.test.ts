import { describe, expect, it } from 'vitest'
import {
  isSkillSlashEntry,
  mergeSlashCommandsForPicker,
  type SlashCommandDto,
} from '../src/lib/composerSlashCommands'

describe('composerSlashCommands', () => {
  it('drops skill: entries from the slash picker', () => {
    const dtos: SlashCommandDto[] = [
      { name: 'skill:commit', description: 'Skill', source: 'skill' },
      { name: 'om:status', description: 'OM status', source: 'extension' },
    ]
    const merged = mergeSlashCommandsForPicker(dtos)
    expect(merged.map((c) => c.name)).toEqual(['/om:status'])
  })

  it('merges builtin, extension, and prompt with dedupe by name', () => {
    const dtos: SlashCommandDto[] = [
      { name: 'compact', description: 'Builtin compact', source: 'builtin' },
      { name: 'om:status', description: 'Extension', source: 'extension' },
      { name: 'review', description: 'Prompt template', source: 'prompt', argHint: '[path]' },
      { name: '/review', description: 'Duplicate prompt', source: 'prompt' },
    ]
    const merged = mergeSlashCommandsForPicker(dtos)
    expect(merged).toHaveLength(3)
    expect(merged.find((c) => c.name === '/review')?.argHint).toBe('[path]')
    expect(merged.find((c) => c.name === '/om:status')?.description).toBe('Extension')
  })

  it('prefers lower source rank on duplicate names', () => {
    const dtos: SlashCommandDto[] = [
      { name: 'goal', description: 'Prompt', source: 'prompt' },
      { name: 'goal', description: 'Builtin', source: 'builtin' },
    ]
    const merged = mergeSlashCommandsForPicker(dtos)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.description).toBe('Builtin')
  })

  it('isSkillSlashEntry', () => {
    expect(isSkillSlashEntry('skill:foo')).toBe(true)
    expect(isSkillSlashEntry('om:status')).toBe(false)
  })
})
