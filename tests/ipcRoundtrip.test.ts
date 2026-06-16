import { describe, expect, it } from 'vitest'

import { appInfoSchema, sessionPromptSchema } from '../src/lib/ipc'

describe('IPC schemas', () => {
  it('round-trips app info payloads', () => {
    const payload = { name: 'OpenPi', version: '0.2.0', releaseChannel: null }

    expect(appInfoSchema.parse(payload)).toEqual(payload)
  })

  it('rejects empty session prompts', () => {
    expect(() => sessionPromptSchema.parse({ text: '' })).toThrow()
  })
})
