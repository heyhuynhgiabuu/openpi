export const POPULAR_PROVIDER_IDS = new Set([
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'vercel-ai-gateway',
  'opencode',
  'opencode-go',
  'groq',
  'deepseek',
  'mistral',
  'xai',
  'amazon-bedrock',
  'azure-openai-responses',
  'cloudflare-ai-gateway',
])

export const SUBSCRIPTION_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Claude Pro/Max',
    provider: 'Anthropic',
    description: 'Use your Claude Pro or Max subscription',
    note: 'Billed per token from extra usage, not against plan limits',
  },
  {
    id: 'openai-codex',
    name: 'ChatGPT Plus/Pro',
    provider: 'OpenAI Codex',
    description: 'Use your ChatGPT Plus or Pro subscription',
    note: 'Officially endorsed by OpenAI for open-source coding agents',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    provider: 'GitHub',
    description: 'Use your GitHub Copilot subscription',
    note: 'Requires active Copilot subscription. If model is unsupported, enable it in VS Code first.',
  },
]

export const SUBSCRIPTION_IDS = new Set(SUBSCRIPTION_PROVIDERS.map((p) => p.id))

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  anthropic: 'Direct access to Claude models via API key',
  openai: 'GPT models for fast, capable general AI tasks',
  'openai-codex': 'ChatGPT Plus/Pro Codex subscription',
  google: 'Google Gemini models',
  'github-copilot': 'AI models via GitHub Copilot',
  openrouter: 'Access multiple models through one API',
  'vercel-ai-gateway': 'Vercel AI Gateway proxy',
  opencode: 'OpenCode Zen — reliable optimized models',
  'opencode-go': 'OpenCode Go — low cost subscription',
  groq: 'Ultra-fast inference for open models',
  deepseek: 'DeepSeek reasoning models',
  mistral: 'Open and proprietary European AI models',
  xai: 'Grok models from xAI',
  'amazon-bedrock': 'AWS Bedrock model access',
  'azure-openai-responses': 'Azure-hosted OpenAI models',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway proxy',
}

export const CUSTOM_PROVIDER_ID_RE = /^[a-z][a-z0-9_-]*$/

export type View = 'list' | 'custom-form'

export type LoginPhase =
  | { phase: 'idle' }
  | {
      phase: 'connecting'
      providerId: string
      message: string
      authUrl?: string
      authInstructions?: string
    }
  | {
      phase: 'prompting'
      providerId: string
      message: string
      placeholder?: string
      allowEmpty?: boolean
    }
  | {
      phase: 'selecting'
      providerId: string
      message: string
      options: { id: string; label: string }[]
    }
  | { phase: 'error'; providerId: string; message: string }

export type ModelRow = { id: string; name: string }
export type HeaderRow = { key: string; value: string }

export type FormState = {
  providerId: string
  displayName: string
  baseUrl: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
}

export type FormErrors = Partial<Record<keyof FormState | 'submit' | `model_${number}`, string>>

export function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {}

  if (!form.providerId) {
    errors.providerId = 'Provider ID is required'
  } else if (!CUSTOM_PROVIDER_ID_RE.test(form.providerId)) {
    errors.providerId = 'Lowercase letters, numbers, hyphens, or underscores'
  }

  if (!form.baseUrl) {
    errors.baseUrl = 'Base URL is required'
  } else {
    try {
      new URL(form.baseUrl)
    } catch {
      errors.baseUrl = 'Must be a valid URL (e.g. https://api.example.com/v1)'
    }
  }

  const nonEmptyModels = form.models.filter((m) => m.id.trim())
  if (nonEmptyModels.length === 0) {
    errors.models = 'Add at least one model'
  }
  form.models.forEach((m, i) => {
    if (m.id.trim() === '' && (m.name.trim() !== '' || form.models.length === 1)) {
      errors[`model_${i}`] = 'Model ID is required'
    }
  })

  return errors
}
