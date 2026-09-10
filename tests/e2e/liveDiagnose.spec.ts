import { expect, test } from '@playwright/test'

// Live diagnosis against a running app webHost (same path as zrok remote, minus tunnel).
// Run: OPENPI_LIVE_URL=http://127.0.0.1:<port> npx playwright test liveDiagnose
// Gated: skips unless OPENPI_LIVE_URL is set.

const LIVE_URL = process.env.OPENPI_LIVE_URL ?? ''
// Session from user repro (Drop-In, 3 days old)
const SESSION_PATH =
  '/home/andrea/.pi/agent/sessions/--home-andrea-Projects-Drop-In--/2026-09-02T17-24-34-129Z_01a06326-acd1-7f8c-b1ef-b9c5dcdd3ace.jsonl'

test.describe('live remote open-session diagnosis', () => {
  test.skip(!LIVE_URL, 'needs OPENPI_LIVE_URL')

  test('open-session over webHost: HTTP, WS events, UI state', async ({ page }) => {
    const consoleLines: string[] = []
    const pageErrors: string[] = []
    page.on('console', (m) => {
      const t = `[${m.type()}] ${m.text()}`
      if (
        t.includes('webBridge') ||
        t.includes('openpi') ||
        t.includes('webHost') ||
        m.type() === 'error' ||
        m.type() === 'warning'
      )
        consoleLines.push(t.slice(0, 400))
    })
    page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 400)))

    // Spy on every WebSocket the app itself creates (init script runs before page code)
    await page.addInitScript(() => {
      const w = window as unknown as {
        __wsSpy: Array<{
          url: string
          opened: boolean
          closed: boolean
          messages: string[]
          errors: number
        }>
      }
      w.__wsSpy = []
      const OrigWS = window.WebSocket
      const recs = w.__wsSpy
      class SpyWS extends OrigWS {
        constructor(url: string | URL, protocols?: string | string[]) {
          super(url, protocols)
          const rec = {
            url: String(url),
            opened: false,
            closed: false,
            messages: [] as string[],
            errors: 0,
          }
          recs.push(rec)
          this.addEventListener('open', () => {
            rec.opened = true
          })
          this.addEventListener('close', () => {
            rec.closed = true
          })
          this.addEventListener('error', () => {
            rec.errors += 1
          })
          this.addEventListener('message', (ev: MessageEvent) => {
            try {
              const msg = JSON.parse(ev.data as string) as { event: string }
              rec.messages.push(msg.event)
            } catch {
              rec.messages.push('(unparseable)')
            }
          })
        }
      }
      window.WebSocket = SpyWS as unknown as typeof WebSocket
    })

    await page.goto(LIVE_URL, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('.homescreen')).toBeVisible({ timeout: 15_000 })
    await page.screenshot({ path: 'test-results/live-01-homescreen.png' })

    // Probe WS + trigger open-session from inside the page (exact webBridge path)
    const result = await page.evaluate(
      async ({ sessionPath }) => {
        const out: {
          wsOpened: boolean
          wsError: string | null
          httpStatus: number | null
          httpBody: string | null
          wsMessages: Array<{ event: string; summary: string }>
          isWebBridge: boolean
          appReadyFired: boolean
          appReadyPayload: string | null
          openSessionThrew: string | null
        } = {
          wsOpened: false,
          wsError: null,
          httpStatus: null,
          httpBody: null,
          wsMessages: [],
          isWebBridge: false,
          appReadyFired: false,
          appReadyPayload: null,
          openSessionThrew: null,
        }
        const w = window as unknown as {
          openpi: {
            __isWebBridge?: boolean
            onSessionReady: (cb: (p: unknown) => void) => void
            openSession: (p: unknown) => Promise<void>
          }
        }
        out.isWebBridge = Boolean(w.openpi?.__isWebBridge)
        // subscribe like useOpenPiSession does, BEFORE triggering
        try {
          w.openpi.onSessionReady((p) => {
            out.appReadyFired = true
            try {
              out.appReadyPayload = JSON.stringify(p).slice(0, 200)
            } catch {
              out.appReadyPayload = '(unserializable)'
            }
          })
        } catch (e) {
          out.appReadyPayload = `subscribe threw: ${String(e).slice(0, 150)}`
        }
        const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/api/events`
        const ws = new WebSocket(wsUrl)
        const opened = await new Promise<boolean>((res) => {
          const t = setTimeout(() => res(false), 5000)
          ws.onopen = () => {
            clearTimeout(t)
            res(true)
          }
          ws.onerror = () => {
            clearTimeout(t)
            res(false)
          }
        })
        out.wsOpened = opened
        if (!opened) {
          out.wsError = 'ws /api/events did not open'
          return out
        }
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data as string) as { event: string; data: unknown }
            out.wsMessages.push({
              event: msg.event,
              summary: JSON.stringify(msg.data).slice(0, 200),
            })
          } catch {
            // ignore
          }
        }
        // same call the UI makes: window.openpi.openSession (webBridge path)
        try {
          await w.openpi.openSession({ path: sessionPath })
          out.httpStatus = 200
          out.httpBody = 'openSession resolved'
        } catch (e) {
          out.httpStatus = 500
          out.openSessionThrew = String(e).slice(0, 300)
        }
        // wait for SESSION_READY over WS
        await new Promise((r) => setTimeout(r, 8000))
        ws.close()
        return out
      },
      { sessionPath: SESSION_PATH }
    )

    console.log('isWebBridge:', result.isWebBridge)
    console.log('WS opened:', result.wsOpened, result.wsError ?? '')
    console.log('HTTP:', result.httpStatus, result.httpBody, result.openSessionThrew ?? '')
    console.log('APP onSessionReady fired:', result.appReadyFired, result.appReadyPayload)
    const wsSpy = await page.evaluate(() => {
      const w = window as unknown as {
        __wsSpy: Array<{
          url: string
          opened: boolean
          closed: boolean
          messages: string[]
          errors: number
        }>
      }
      return (w.__wsSpy ?? []).map((r) => ({
        url: r.url,
        opened: r.opened,
        closed: r.closed,
        errors: r.errors,
        nMessages: r.messages.length,
        events: r.messages.slice(0, 12),
      }))
    })
    console.log('APP WS SPY:', JSON.stringify(wsSpy, null, 1).slice(0, 2500))
    console.log('WS messages:', JSON.stringify(result.wsMessages, null, 1).slice(0, 2000))

    await page.screenshot({ path: 'test-results/live-02-after-open.png' })
    const bodyText = await page.locator('body').innerText()
    console.log('BODY markers:', {
      hasConversation: bodyText.includes('Type a message') || bodyText.includes('composer'),
      hasError: /error|failed|unauthorized|not found/i.test(bodyText.slice(0, 2000)),
    })
    console.log(
      'CONSOLE (filtered):',
      JSON.stringify(consoleLines.slice(0, 30), null, 1).slice(0, 3000)
    )
    console.log('PAGEERRORS:', JSON.stringify(pageErrors.slice(0, 10)))
  })
})
