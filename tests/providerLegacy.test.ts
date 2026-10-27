import { describe, expect, it } from 'vitest'
import {
  POPULAR_PROVIDER_IDS,
  PROVIDER_DESCRIPTIONS,
} from '../src/components/providers/providerHelpers'
import { providerInfoSchema } from '../src/lib/ipc'
import { findLegacyCredentialId, getProviderLabel, LEGACY_PROVIDER_IDS } from '../src/lib/providers'

describe('Azure provider id rename (azure-openai-responses -> azure)', () => {
  it('labels the current and the legacy id as Azure OpenAI', () => {
    expect(getProviderLabel('azure')).toBe('Azure OpenAI')
    // Historical sessions and usage rows still carry the legacy provider id.
    expect(getProviderLabel('azure-openai-responses')).toBe('Azure OpenAI')
  })

  it('lists only the current id as popular', () => {
    expect(POPULAR_PROVIDER_IDS.has('azure')).toBe(true)
    expect(POPULAR_PROVIDER_IDS.has('azure-openai-responses')).toBe(false)
  })

  it('describes the current id and drops the stale description key', () => {
    expect(PROVIDER_DESCRIPTIONS.azure).toBe('Azure-hosted OpenAI and Foundry models')
    expect(PROVIDER_DESCRIPTIONS['azure-openai-responses']).toBeUndefined()
  })

  it('maps only the renamed Azure id', () => {
    expect(LEGACY_PROVIDER_IDS).toEqual({ 'azure-openai-responses': 'azure' })
  })
})

describe('findLegacyCredentialId', () => {
  it('returns the legacy id when a credential is stored under it', () => {
    expect(findLegacyCredentialId('azure', ['anthropic', 'azure-openai-responses'])).toBe(
      'azure-openai-responses'
    )
  })

  it('returns undefined when no legacy credential is stored', () => {
    expect(findLegacyCredentialId('azure', ['anthropic', 'azure'])).toBeUndefined()
    expect(findLegacyCredentialId('azure', [])).toBeUndefined()
  })

  it('ignores providers that are not the replacement of a legacy id', () => {
    expect(findLegacyCredentialId('anthropic', ['azure-openai-responses'])).toBeUndefined()
    expect(findLegacyCredentialId('azure-openai-responses', ['azure-openai-responses'])).toBe(
      undefined
    )
  })

  it('accepts any iterable of stored ids', () => {
    expect(findLegacyCredentialId('azure', new Set(['azure-openai-responses']))).toBe(
      'azure-openai-responses'
    )
  })
})

describe('providerInfoSchema legacyCredentialId', () => {
  const base = { id: 'azure', displayName: 'Azure', configured: false, modelCount: 3 }

  it('accepts the optional field', () => {
    const parsed = providerInfoSchema.parse({
      ...base,
      legacyCredentialId: 'azure-openai-responses',
    })
    expect(parsed.legacyCredentialId).toBe('azure-openai-responses')
  })

  it('stays valid when the field is omitted', () => {
    const parsed = providerInfoSchema.parse(base)
    expect(parsed.legacyCredentialId).toBeUndefined()
    expect(parsed.authMethods).toEqual([])
  })

  it('rejects a non-string value', () => {
    expect(providerInfoSchema.safeParse({ ...base, legacyCredentialId: 1 }).success).toBe(false)
  })
})
