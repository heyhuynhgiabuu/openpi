import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import {
  APPEARANCE_PREFERENCES_CHANGED_EVENT,
  type AppearancePreferences,
  buildTerminalFontStack,
  loadAppearancePreferences,
} from '../../lib/appearancePreferences'
import { parseTerminalIntegrationData } from './shellIntegration'
import 'nerdfonts-web/nf.css'

interface Props {
  id: string
  cwd: string
  isVisible: boolean
  /** Called when the PTY process exits */
  onExit?: (id: string) => void
  /** Called when shell integration reports a cwd change. */
  onCwdChange?: (id: string, cwd: string) => void
}

const NERD_SYMBOL_FONT = 'NerdFontsSymbols Nerd Font'
const TERMINAL_FONT_SIZE = 15

async function loadTerminalFonts(fontSize: number, preferredFont = ''): Promise<void> {
  if (!document.fonts?.load) return

  const fontNames = [preferredFont, NERD_SYMBOL_FONT]
    .flatMap((font) => font.split(','))
    .map((font) => font.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)

  await Promise.allSettled(fontNames.map((font) => document.fonts.load(`${fontSize}px "${font}"`)))
}

export function TerminalPane(props: Props) {
  let containerRef!: HTMLDivElement
  let term: Terminal | null = null
  let fitAddon: FitAddon | null = null
  let ptyId: string | null = null
  const [terminalReady, setTerminalReady] = createSignal(false)

  onMount(() => {
    let disposed = false
    let onDataDisposable: { dispose: () => void } | null = null
    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null

    const fontSize = TERMINAL_FONT_SIZE
    const nextTerm = new Terminal({
      theme: {
        background: '#070706',
        foreground: '#e9e1d6',
        cursor: '#f5efe6',
        cursorAccent: '#070706',
        selectionBackground: 'rgba(245, 239, 230, 0.18)',
        black: '#161514',
        brightBlack: '#5c5751',
        red: '#e06c75',
        brightRed: '#e06c75',
        green: '#98c379',
        brightGreen: '#98c379',
        yellow: '#e5c07b',
        brightYellow: '#e5c07b',
        blue: '#61afef',
        brightBlue: '#61afef',
        magenta: '#c678dd',
        brightMagenta: '#c678dd',
        cyan: '#56b6c2',
        brightCyan: '#56b6c2',
        white: '#d8d1c8',
        brightWhite: '#fff8ef',
      },
      fontFamily: buildTerminalFontStack(''),
      fontSize,
      lineHeight: 1.12,
      letterSpacing: 0,
      fontWeight: 400,
      fontWeightBold: 600,
      cursorStyle: 'block',

      cursorBlink: true,
      scrollback: 5000,
      customGlyphs: true,
      allowProposedApi: true,
    })

    const nextFitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    let webglAddon: WebglAddon | null = null
    nextTerm.loadAddon(nextFitAddon)
    nextTerm.loadAddon(webLinksAddon)

    try {
      webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        webglAddon?.dispose()
        webglAddon = null
      })
      nextTerm.loadAddon(webglAddon)
    } catch {
      // Fall back to the default canvas renderer when WebGL is unavailable.
    }

    const applyTerminalFont = (prefs: AppearancePreferences) => {
      nextTerm.options.fontFamily = buildTerminalFontStack(prefs.terminalFont)
      if (fitAddon && term) {
        try {
          fitAddon.fit()
          if (ptyId) window.openpi.pty.resize(ptyId, term.cols, term.rows)
        } catch {
          // ignore transient resize failures while the terminal is hidden.
        }
      }
    }

    const onAppearanceChanged = (event: Event) => {
      applyTerminalFont((event as CustomEvent<AppearancePreferences>).detail)
    }
    window.addEventListener(APPEARANCE_PREFERENCES_CHANGED_EVENT, onAppearanceChanged)

    const startTerminal = async () => {
      const appearance = await loadAppearancePreferences().catch(() => null)
      if (appearance) applyTerminalFont(appearance)
      await loadTerminalFonts(fontSize, appearance?.terminalFont ?? '')
      if (disposed) return

      nextTerm.open(containerRef)
      nextFitAddon.fit()

      term = nextTerm
      fitAddon = nextFitAddon
      setTerminalReady(true)

      const { cols, rows } = nextTerm
      window.openpi.pty
        .create(props.cwd, cols, rows)
        .then((id) => {
          if (disposed) {
            void window.openpi.pty.close(id)
            return
          }
          ptyId = id
          window.openpi.pty.resize(id, nextTerm.cols, nextTerm.rows)

          // Register xterm → PTY input listener after ptyId is set to avoid race
          onDataDisposable = nextTerm.onData((data) => {
            if (ptyId) window.openpi.pty.write(ptyId, data)
          })

          // Register PTY → xterm output listener after ptyId is set
          unsubData = window.openpi.pty.onData(({ id: msgId, data }) => {
            if (msgId !== ptyId) return
            const parsed = parseTerminalIntegrationData(data)
            if (parsed.cwd) props.onCwdChange?.(props.id, parsed.cwd)
            if (parsed.data) nextTerm.write(parsed.data)
          })

          unsubExit = window.openpi.pty.onExit(({ id: msgId }) => {
            if (msgId === ptyId) {
              nextTerm.write('\r\n[Process exited]\r\n')
              ptyId = null
            }
          })
        })
        .catch((err: unknown) => {
          if (!disposed) {
            nextTerm.write(`\r\n[Failed to create terminal: ${String(err)}]\r\n`)
          }
        })
    }

    void startTerminal()

    onCleanup(() => {
      disposed = true
      onDataDisposable?.dispose()
      unsubData?.()
      unsubExit?.()
      if (ptyId) {
        void window.openpi.pty.close(ptyId)
        ptyId = null
      }
      window.removeEventListener(APPEARANCE_PREFERENCES_CHANGED_EVENT, onAppearanceChanged)
      webglAddon?.dispose()
      nextTerm.dispose()
      term = null
      fitAddon = null
      setTerminalReady(false)
    })
  })

  createEffect(() => {
    if (!props.isVisible || !terminalReady() || !fitAddon || !term) return

    const fit = () => {
      if (!fitAddon || !term || !containerRef.offsetWidth || !containerRef.offsetHeight) return
      try {
        fitAddon.fit()
        if (ptyId) {
          window.openpi.pty.resize(ptyId, term.cols, term.rows)
        }
      } catch {
        // ignore transient fit failures while the panel is animating or hidden.
      }
    }

    const animationFrame = requestAnimationFrame(fit)
    const timer = setTimeout(fit, 80)
    const observer = new ResizeObserver(fit)
    observer.observe(containerRef)

    if (containerRef.parentElement) {
      observer.observe(containerRef.parentElement)
    }

    onCleanup(() => {
      cancelAnimationFrame(animationFrame)
      clearTimeout(timer)
      observer.disconnect()
    })
  })

  return (
    <div
      ref={(el) => {
        containerRef = el
      }}
      class="terminal-pane-inner"
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
    />
  )
}
