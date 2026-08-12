export function formatTokenMetric(tokens: number): string {
  if (tokens >= 1_000_000_000) return `${(tokens / 1_000_000_000).toFixed(1)}B`
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return tokens.toLocaleString()
}

export function formatProviderLabel(provider: string | undefined): string {
  if (!provider) return ''
  const labels: Record<string, string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    google: 'Google',
    deepseek: 'DeepSeek',
    minimax: 'MiniMax',
    moonshot: 'Moonshot',
    zhipu: 'Zhipu',
    qwen: 'Qwen',
    xai: 'xAI',
  }
  const key = provider.toLowerCase()
  return labels[key] ?? provider.charAt(0).toUpperCase() + provider.slice(1)
}
