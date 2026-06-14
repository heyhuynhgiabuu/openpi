/**
 * PTY host — Electron main process only.
 * Spawns and manages node-pty instances; forwards data/exit events to renderer.
 * Renderer never has direct PTY or node access.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as pty from '@lydell/node-pty'
import type { WebContents } from 'electron'
import { IPC } from '../../src/lib/ipc'

interface PtyEntry {
  id: string
  ptyProcess: pty.IPty
  cwd: string
}

interface ShellLaunchConfig {
  shell: string
  args: string[]
  env: Record<string, string>
}

const OPENPI_TERMINAL_ENV = 'OPENPI_TERMINAL'

const ZSH_INTEGRATION = String.raw`# OpenPi shell integration. Generated; do not edit.
if [[ -n "$OPENPI_USER_ZDOTDIR" && -r "$OPENPI_USER_ZDOTDIR/.zshrc" ]]; then
  source "$OPENPI_USER_ZDOTDIR/.zshrc"
elif [[ -r "$HOME/.zshrc" ]]; then
  source "$HOME/.zshrc"
fi

__openpi_emit_prompt_marker() {
  printf '\033]633;A\a\033]633;P;Cwd=%s\a' "$PWD"
}

autoload -Uz add-zsh-hook 2>/dev/null
if typeset -f add-zsh-hook >/dev/null 2>&1; then
  add-zsh-hook precmd __openpi_emit_prompt_marker
  add-zsh-hook chpwd __openpi_emit_prompt_marker
fi
__openpi_emit_prompt_marker
`

const BASH_INTEGRATION = String.raw`# OpenPi shell integration. Generated; do not edit.
if [[ -r "$HOME/.bashrc" ]]; then
  source "$HOME/.bashrc"
fi

__openpi_emit_prompt_marker() {
  printf '\033]633;A\a\033]633;P;Cwd=%s\a' "$PWD"
}

case ";$PROMPT_COMMAND;" in
  *"__openpi_emit_prompt_marker"*) ;;
  ";;") PROMPT_COMMAND="__openpi_emit_prompt_marker" ;;
  *) PROMPT_COMMAND="__openpi_emit_prompt_marker;\${PROMPT_COMMAND}" ;;
esac
__openpi_emit_prompt_marker
`

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const nextEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') nextEnv[key] = value
  }
  return nextEnv
}

function shellName(shellPath: string): string {
  return path
    .basename(shellPath)
    .replace(/\.exe$/i, '')
    .toLowerCase()
}

/**
 * Pick a sensible default shell for the current platform.
 *
 * Order of precedence:
 *  1. `OPENPI_SHELL` env var (escape hatch)
 *  2. Platform default: PowerShell on Windows, `$SHELL` elsewhere
 *  3. Common fallbacks: cmd.exe on Windows, bash/zsh on POSIX
 *
 * The previous implementation used `$SHELL ?? '/bin/zsh'`, which
 * always failed on Windows because `$SHELL` is not set and
 * `/bin/zsh` does not exist. Users on Windows now get
 * PowerShell by default, with a friendlier error if it can't be
 * found.
 */
function pickDefaultShell(): string {
  if (process.env.OPENPI_SHELL) return process.env.OPENPI_SHELL
  if (process.platform === 'win32') {
    if (process.env.ComSpec) return process.env.ComSpec
    const candidates = [
      'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      'cmd.exe',
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate
    }
    return 'powershell.exe'
  }
  if (process.env.SHELL && fs.existsSync(process.env.SHELL)) return process.env.SHELL
  const posixCandidates = [
    '/bin/zsh',
    '/bin/bash',
    '/usr/bin/zsh',
    '/usr/bin/bash',
    '/usr/local/bin/zsh',
  ]
  for (const candidate of posixCandidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return '/bin/sh'
}

function shellIntegrationRoot(): string {
  const root = path.join(os.homedir(), '.cache', 'openpi', 'shell-integration')
  fs.mkdirSync(root, { recursive: true })
  return root
}

function writeIfChanged(filePath: string, content: string): void {
  try {
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return
    fs.writeFileSync(filePath, content, { mode: 0o600 })
  } catch {
    // Shell integration is best-effort; the terminal should still open without it.
  }
}

export function buildShellLaunchConfig(shell: string, cwd: string): ShellLaunchConfig {
  const env: Record<string, string> = {
    ...stringEnv(process.env),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    [OPENPI_TERMINAL_ENV]: '1',
  }
  const name = shellName(shell)
  const args: string[] = []

  try {
    const root = shellIntegrationRoot()
    if (name === 'zsh') {
      const dir = path.join(root, 'zsh')
      fs.mkdirSync(dir, { recursive: true })
      const existingZdotdir = env.ZDOTDIR
      if (existingZdotdir) env.OPENPI_USER_ZDOTDIR = existingZdotdir
      env.ZDOTDIR = dir
      writeIfChanged(path.join(dir, '.zshrc'), ZSH_INTEGRATION)
      args.push('-i')
    } else if (name === 'bash') {
      const dir = path.join(root, 'bash')
      fs.mkdirSync(dir, { recursive: true })
      const rcfile = path.join(dir, 'bashrc')
      writeIfChanged(rcfile, BASH_INTEGRATION)
      args.push('--rcfile', rcfile, '-i')
    }
  } catch {
    // Keep terminal creation resilient if the integration directory cannot be created.
  }

  env.PWD = cwd || env.PWD || os.homedir()
  return { shell, args, env }
}

export class PtyHost {
  private entries = new Map<string, PtyEntry>()
  private sender: WebContents | null = null
  private nextId = 1

  setSender(webContents: WebContents): void {
    this.sender = webContents
  }

  private send(channel: string, ...args: unknown[]): void {
    if (this.sender && !this.sender.isDestroyed()) {
      this.sender.send(channel, ...args)
    }
  }

  create(cwd: string, cols: number, rows: number): string {
    const id = `pty-${this.nextId++}`
    const shell = pickDefaultShell()
    const workingDirectory = cwd || os.homedir()
    let launch: ShellLaunchConfig
    try {
      launch = buildShellLaunchConfig(shell, workingDirectory)
    } catch (err) {
      throw new Error(
        `Terminal shell not found: ${shell}. ` +
          `On Windows, install PowerShell or set the OPENPI_SHELL environment variable. ` +
          `Original error: ${(err as Error).message}`
      )
    }

    const p = pty.spawn(launch.shell, launch.args, {
      name: 'xterm-256color',
      cols: Math.max(1, cols),
      rows: Math.max(1, rows),
      cwd: workingDirectory,
      env: launch.env,
    })

    p.onData((data: string) => {
      this.send(IPC.PTY_DATA, { id, data })
    })

    p.onExit(({ exitCode }: { exitCode: number }) => {
      this.entries.delete(id)
      this.send(IPC.PTY_EXIT, { id, code: exitCode })
    })

    this.entries.set(id, { id, ptyProcess: p, cwd: workingDirectory })
    return id
  }

  write(id: string, data: string): void {
    this.entries.get(id)?.ptyProcess.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    if (!entry) return
    try {
      entry.ptyProcess.resize(Math.max(1, cols), Math.max(1, rows))
    } catch {
      // PTY may be closing; ignore
    }
  }

  close(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    try {
      entry.ptyProcess.kill()
    } catch {
      /* ignore */
    }
    this.entries.delete(id)
  }

  closeAll(): void {
    for (const entry of this.entries.values()) {
      try {
        entry.ptyProcess.kill()
      } catch {
        /* ignore */
      }
    }
    this.entries.clear()
  }
}

export const ptyHost = new PtyHost()
