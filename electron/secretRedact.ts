/**
 * secretRedact — main-process utility for scrubbing secrets from strings
 * before they are written to logs, diagnostics exports, or the output panel.
 *
 * Authority: Electron main owns redaction. The renderer never sees raw
 * safeStorage content and must not bypass this module.
 *
 * Design:
 *   - Pattern-based: catches common secret shapes (API keys, tokens, passwords).
 *   - Path-based: removes absolute paths to sensitive files.
 *   - Opt-in extra patterns: callers can supply additional patterns (e.g.
 *     project-specific env var names found in workspace config).
 *
 * Intentional scope limits:
 *   - Does NOT inspect Pi AuthStorage or model API keys — those are owned by the
 *     Pi SDK's AuthStorage and never flow through OpenPi-owned code paths.
 *   - Does NOT redact Pi session JSONL content — Pi produces that content and
 *     it is surfaced read-only in the renderer history view.
 *   - The redaction regex list is conservative: false negatives are acceptable
 *     but false positives (redacting benign data) must be avoided.
 */

import os from 'node:os'
import path from 'node:path'

// ---------------------------------------------------------------------------
// Built-in redaction patterns
// ---------------------------------------------------------------------------

const HOME = os.homedir()

/** Replacement token surfaced in redacted output */
const REDACTED = '[REDACTED]'

type RedactionRule = {
  label: string
  pattern: RegExp
  replacement: string
}

/**
 * Patterns that match common secret-shaped strings.
 * Each capture group (if present) is replaced with REDACTED.
 */
const PATTERN_RULES: RedactionRule[] = [
  // GitHub tokens: ghp_, gho_, ghu_, ghs_, ghr_, github_pat_
  {
    label: 'github-token',
    pattern: /(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{36,})/g,
    replacement: REDACTED,
  },
  // Anthropic API key
  {
    label: 'anthropic-key',
    pattern: /(sk-ant-[A-Za-z0-9\-_]{20,})/g,
    replacement: REDACTED,
  },
  // OpenAI API key
  {
    label: 'openai-key',
    pattern: /(sk-[A-Za-z0-9]{20,})/g,
    replacement: REDACTED,
  },
  // Generic Bearer token in headers
  {
    label: 'bearer-token',
    pattern: /(Bearer\s+)[A-Za-z0-9\-_.=+/]{20,}/gi,
    replacement: `$1${REDACTED}`,
  },
  // AWS access key id / secret patterns
  {
    label: 'aws-access-key',
    pattern: /\b(AKIA[A-Z0-9]{16})\b/g,
    replacement: REDACTED,
  },
  {
    label: 'aws-secret-key',
    pattern: /(aws_secret_access_key\s*=\s*)[A-Za-z0-9/+]{40}/gi,
    replacement: `$1${REDACTED}`,
  },
  // Generic env-var assignment patterns: SECRET=..., TOKEN=..., PASSWORD=..., API_KEY=...
  {
    label: 'env-secret-assignment',
    pattern:
      /\b((?:SECRET|TOKEN|PASSWORD|API[_\s]?KEY|PRIVATE[_\s]?KEY|ACCESS[_\s]?KEY)\s*=\s*)(['"]?)(?!\1)[^\s'"]{8,}\2/gi,
    replacement: `$1${REDACTED}`,
  },
]

/**
 * Paths to sensitive files — occurrences in output are replaced with a
 * basename-only form to avoid leaking home directory structure.
 */
const SENSITIVE_PATH_PREFIXES = [
  path.join(HOME, '.ssh'),
  path.join(HOME, '.gnupg'),
  path.join(HOME, '.pi', 'agent', 'auth'),
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type RedactOptions = {
  /** Additional regex patterns the caller wants to suppress */
  extraPatterns?: RegExp[]
}

/**
 * Redact secrets from a string. Safe to call on arbitrary text including
 * shell output, log lines, and diagnostic bundle entries.
 *
 * @param input    Raw string that may contain secrets.
 * @param options  Optional extra patterns to suppress.
 * @returns        Sanitised copy of the string.
 */
export function redact(input: string, options: RedactOptions = {}): string {
  let output = input

  // Pattern-based redaction
  for (const rule of PATTERN_RULES) {
    // Reset lastIndex for global regexes between calls
    rule.pattern.lastIndex = 0
    output = output.replace(rule.pattern, rule.replacement)
  }

  // Path-based redaction: replace full path occurrences with just the basename
  for (const prefix of SENSITIVE_PATH_PREFIXES) {
    if (output.includes(prefix)) {
      // Escape special regex characters in the path
      const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      output = output.replace(new RegExp(escaped + '[^\\s,\'"\\)\\]>]*', 'g'), (match) => {
        return `${path.basename(prefix)}/${path.relative(prefix, match)}`
      })
    }
  }

  // Caller-supplied extra patterns
  if (options.extraPatterns) {
    for (const pattern of options.extraPatterns) {
      pattern.lastIndex = 0
      output = output.replace(pattern, REDACTED)
    }
  }

  return output
}

/**
 * Redact an array of strings in-place, returning the mutated array.
 * Convenience wrapper for log line arrays.
 */
export function redactLines(lines: string[], options: RedactOptions = {}): string[] {
  return lines.map((line) => redact(line, options))
}

/**
 * Redact a nested plain object (e.g. a diagnostic bundle JSON) by recursively
 * redacting all string values. Arrays and objects are traversed; non-string
 * primitives are left untouched.
 */
export function redactObject<T>(value: T, options: RedactOptions = {}): T {
  if (typeof value === 'string') {
    return redact(value, options) as unknown as T
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item, options)) as unknown as T
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactObject(val, options)
    }
    return result as unknown as T
  }
  return value
}
