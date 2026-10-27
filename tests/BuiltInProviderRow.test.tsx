import { cleanup, render } from '@solidjs/testing-library'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BuiltInProviderRow } from '../src/components/providers/BuiltInProviderRow'
import type { ProviderInfo } from '../src/lib/ipc'

afterEach(cleanup)

function renderRow(provider: Partial<ProviderInfo> = {}) {
  const info: ProviderInfo = {
    id: 'azure',
    displayName: 'Azure',
    configured: false,
    modelCount: 4,
    authMethods: ['api_key'],
    ...provider,
  }
  return render(() => (
    <BuiltInProviderRow
      provider={info}
      expanded={false}
      apiKeyInput=""
      listError={null}
      listSaving={false}
      onExpand={vi.fn()}
      onApiKeyInput={vi.fn()}
      onCancel={vi.fn()}
      onSave={vi.fn()}
      onRemove={vi.fn()}
    />
  ))
}

describe('BuiltInProviderRow Azure rename', () => {
  it('shows the Azure OpenAI label and description for the azure id', () => {
    const { getByText, queryByRole } = renderRow()
    expect(getByText('Azure OpenAI')).toBeTruthy()
    expect(getByText('Azure-hosted OpenAI and Foundry models')).toBeTruthy()
    expect(queryByRole('note')).toBeNull()
  })

  it('tells the user to reconnect under azure when a legacy credential is detected', () => {
    const { getByRole } = renderRow({ legacyCredentialId: 'azure-openai-responses' })
    const notice = getByRole('note')
    expect(notice.textContent).toContain('"azure-openai-responses"')
    expect(notice.textContent).toContain('under "azure"')
    expect(notice.textContent).toContain('does not migrate')
  })
})
