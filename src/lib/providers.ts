/**
 * Shared provider label utilities used by ConnectProviderModal and ManageModelsModal.
 */

/** Known display names for built-in Pi providers */
export const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  'amazon-bedrock': 'Amazon Bedrock',
  'ant-ling': 'Ant Ling',
  anthropic: 'Anthropic',
  'azure-openai-responses': 'Azure OpenAI',
  cerebras: 'Cerebras',
  'cloudflare-ai-gateway': 'Cloudflare AI Gateway',
  'cloudflare-workers-ai': 'Cloudflare Workers AI',
  deepseek: 'DeepSeek',
  fireworks: 'Fireworks',
  'github-copilot': 'GitHub Copilot',
  google: 'Google Gemini',
  'google-vertex': 'Google Vertex AI',
  groq: 'Groq',
  huggingface: 'Hugging Face',
  'kimi-coding': 'Kimi For Coding',
  minimax: 'MiniMax',
  'minimax-cn': 'MiniMax (China)',
  mistral: 'Mistral',
  moonshotai: 'Moonshot AI',
  nvidia: 'NVIDIA NIM',
  'moonshotai-cn': 'Moonshot AI (China)',
  openai: 'OpenAI',
  'openai-codex': 'ChatGPT Plus/Pro',
  opencode: 'OpenCode Zen',
  'opencode-go': 'OpenCode Go',
  openrouter: 'OpenRouter',
  together: 'Together AI',
  'vercel-ai-gateway': 'Vercel AI Gateway',
  xai: 'xAI',
  xiaomi: 'Xiaomi MiMo',
  'xiaomi-token-plan-ams': 'Xiaomi MiMo (Amsterdam)',
  'xiaomi-token-plan-cn': 'Xiaomi MiMo (China)',
  'xiaomi-token-plan-sgp': 'Xiaomi MiMo (Singapore)',
  zai: 'ZAI',
}

/** Return a human-readable provider label, falling back to title-casing the id */
export function getProviderLabel(id: string): string {
  if (PROVIDER_DISPLAY_NAMES[id]) return PROVIDER_DISPLAY_NAMES[id]
  // Fallback: replace dashes/underscores with spaces, title-case each word
  return id
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
