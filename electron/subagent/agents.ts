import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type AgentConfig = {
  name: string
  description: string
  prompt: string
  /** Explicit tool allowlist. If set, only these tools are available. */
  tools?: string[]
  /** Tool blocklist. Applied after tools allowlist. */
  disallowedTools?: string[]
  /** When false, global extensions load for this agent (scout needs pi-search). Default true. */
  noExtensions?: boolean
  /** Default model override (e.g. 'anthropic/claude-sonnet-4-20250514') */
  model?: string
  /** Default thinking level */
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** Max turns before abort */
  maxTurns?: number
  /** 'replace' (default) = full prompt replaces system; 'append' = appended to system */
  promptMode?: 'replace' | 'append'
  /** Inherit parent conversation context */
  inheritContext?: boolean
  /** Block extension tools from loading */
  isolated?: boolean
  /** Whether this agent is active (default true) */
  enabled?: boolean
  source: 'builtin' | 'global' | 'project'
  /** Human-readable label (falls back to name) */
  displayName?: string
}

const READ_ONLY_TOOLS = ['read', 'grep', 'find', 'ls', 'bash']

// Tools from global extensions (loaded when noExtensions=false).
// The tools allowlist blocks recursive subagent tools (Agent etc.)
// while letting through the ones each agent needs.

const SRCWALK_TOOLS = [
  'srcwalk_search',
  'srcwalk_read',
  'srcwalk_files',
  'srcwalk_deps',
  'srcwalk_map',
  'srcwalk_callers',
  'srcwalk_callees',
  'srcwalk_flow',
  'srcwalk_impact',
]

const WEBCLAW_TOOLS = ['webclaw_scrape', 'webclaw_batch']

const SEARCH_TOOLS = ['grepsearch', 'websearch', 'codesearch', 'context7', 'web_fetch']

// ─── Built-in agent prompt files ────────────────────────────────────────────
// Each built-in agent's system prompt lives in electron/subagents/<name>.txt.

const currentDir = path.dirname(fileURLToPath(import.meta.url))

function findSubagentsDir(): string {
  const candidates = [
    path.join(currentDir, 'subagents'),
    path.resolve(currentDir, '..', '..', 'electron', 'subagents'),
    path.resolve(currentDir, '..', 'electron', 'subagents'),
    path.join(process.cwd(), 'electron', 'subagents'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir
  }
  return path.join(currentDir, 'subagents')
}

const SUBAGENTS_DIR = findSubagentsDir()

function readPrompt(name: string): string {
  const filePath = path.join(SUBAGENTS_DIR, `${name}.txt`)
  try {
    return fs.readFileSync(filePath, 'utf8').trim()
  } catch {
    return `You are an OpenPi subagent. Complete the delegated task: {task}`
  }
}

// ─── Built-in agent definitions ─────────────────────────────────────────────

const BUILTIN_AGENTS: AgentConfig[] = [
  {
    name: 'explorer',
    description:
      'Read-only codebase cartographer. Uses srcwalk tools (srcwalk_search, srcwalk_callers, srcwalk_map, etc.) plus grep/read/find for thorough exploration.',
    source: 'builtin',
    tools: [...READ_ONLY_TOOLS, ...SRCWALK_TOOLS],
    noExtensions: false,
    prompt: readPrompt('explorer'),
  },
  {
    name: 'worker',
    description:
      'Surgical implementer for small, well-defined tasks (1-3 files). Executes fast with auto-fix deviation rules and verification.',
    source: 'builtin',
    prompt: readPrompt('worker'),
  },
  {
    name: 'scout',
    description:
      'External research specialist. Uses pi-search tools (websearch, grepsearch, context7, codesearch, web_fetch) plus webclaw and srcwalk for thorough investigation.',
    source: 'builtin',
    tools: [
      ...READ_ONLY_TOOLS,
      ...SEARCH_TOOLS,
      'srcwalk_search',
      'srcwalk_read',
      'srcwalk_files',
      ...WEBCLAW_TOOLS,
    ],
    noExtensions: false,
    prompt: readPrompt('scout'),
  },
  {
    name: 'planner',
    description:
      'Read-only planning agent for architecture, decomposition, and executable implementation plans. Uses srcwalk for codebase analysis.',
    source: 'builtin',
    tools: [...READ_ONLY_TOOLS, ...SRCWALK_TOOLS],
    noExtensions: false,
    prompt: readPrompt('planner'),
  },
  {
    name: 'reviewer',
    description:
      'Read-only code review and debugging specialist. Uses srcwalk for cross-file tracing and dependency analysis. Severity-ranked findings with file:line evidence.',
    source: 'builtin',
    tools: [...READ_ONLY_TOOLS, ...SRCWALK_TOOLS],
    noExtensions: false,
    prompt: readPrompt('reviewer'),
  },
]

function parseFrontmatterValue(value: string): string | number | boolean | string[] {
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return parseInt(value, 10)
  if (/^\d+\.\d+$/.test(value)) return parseFloat(value)
  return value
}

/** Parse YAML-like frontmatter block into a record of known fields. */
export function parseFrontmatter(fm: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  const lines = fm.split('\n')
  let currentKey: string | null = null
  let listAccum: string[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    // List continuation (indented dash item)
    if (currentKey && /^\s+-\s/.test(line)) {
      listAccum.push(line.replace(/^\s*-\s*/, '').trim())
      continue
    }
    // Flush list accumulator when key changes
    if (currentKey && listAccum.length > 0) {
      result[currentKey] = listAccum
      listAccum = []
      currentKey = null
    }
    // Top-level key: value
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/)
    if (!match) continue
    currentKey = match[1]
    const rest = match[2].trim()
    if (rest === '') {
      // List-style value starts on next line (we'll capture indented - items)
      listAccum = []
      continue
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      // inline list: [item1, item2]
      result[currentKey] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      currentKey = null
      continue
    }
    result[currentKey] = parseFrontmatterValue(rest)
    currentKey = null
  }
  // Flush any remaining list
  if (currentKey && listAccum.length > 0) {
    result[currentKey] = listAccum
  }
  return result
}

function readAgentFile(filePath: string, source: AgentConfig['source']): AgentConfig | null {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const trimmed = raw.trimStart()
    let body: string
    let fm: Record<string, unknown> = {}
    if (trimmed.startsWith('---')) {
      const closeIdx = trimmed.slice(3).indexOf('\n---')
      if (closeIdx === -1) {
        body = raw.trim()
      } else {
        const frontmatter = trimmed.slice(3, closeIdx + 3)
        body = trimmed.slice(closeIdx + 7).trim()
        fm = parseFrontmatter(frontmatter)
      }
    } else {
      body = raw.trim()
    }
    if (!body) return null
    const name = String(fm.name ?? path.basename(filePath, '.md'))
    const firstHeading = body.match(/^#\s+(.+)$/m)?.[1]?.trim()
    const displayName = typeof fm.display_name === 'string' ? fm.display_name : undefined
    const description =
      typeof fm.description === 'string'
        ? fm.description
        : (displayName ?? firstHeading ?? `${name} subagent`)
    return {
      name,
      description,
      displayName,
      prompt: body,
      source,
      tools: Array.isArray(fm.tools) ? (fm.tools as string[]) : undefined,
      disallowedTools: Array.isArray(fm.disallowed_tools)
        ? (fm.disallowed_tools as string[])
        : undefined,
      model: typeof fm.model === 'string' ? fm.model : undefined,
      thinking:
        typeof fm.thinking === 'string' &&
        ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(fm.thinking as string)
          ? (fm.thinking as AgentConfig['thinking'])
          : undefined,
      maxTurns: typeof fm.max_turns === 'number' ? fm.max_turns : undefined,
      promptMode: fm.prompt_mode === 'append' ? 'append' : 'replace',
      inheritContext: fm.inherit_context === true,
      isolated: fm.isolated === true,
      enabled: fm.enabled !== false,
      noExtensions: fm.isolated === true ? true : fm.no_extensions === false ? false : undefined,
    }
  } catch {
    return null
  }
}

function loadAgentFiles(dir: string, source: AgentConfig['source']): AgentConfig[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => readAgentFile(path.join(dir, entry.name), source))
      .filter((agent): agent is AgentConfig => agent !== null)
  } catch {
    return []
  }
}

function deduplicateAgents(agents: AgentConfig[]): AgentConfig[] {
  const seen = new Map<string, number>()
  const result: AgentConfig[] = []
  // Later entries override earlier ones (project > global > builtin)
  for (const agent of agents) {
    const existing = seen.get(agent.name)
    if (existing !== undefined) {
      result[existing] = agent
    } else {
      seen.set(agent.name, result.length)
      result.push(agent)
    }
  }
  // Remove disabled agents
  return result.filter((a) => a.enabled !== false)
}

export function discoverAgents(
  cwd: string,
  agentDir: string,
  workspaceTrusted: boolean
): AgentConfig[] {
  const agents: AgentConfig[] = []
  // Builtin first (lowest priority)
  agents.push(...BUILTIN_AGENTS)
  // Global agents override builtin
  agents.push(...loadAgentFiles(path.join(agentDir, 'agents'), 'global'))
  // Project agents override everything — only if workspace is trusted
  if (workspaceTrusted) {
    agents.push(...loadAgentFiles(path.join(cwd, '.pi', 'agents'), 'project'))
  }
  return deduplicateAgents(agents)
}
