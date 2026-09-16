/**
 * remote/shell — static PWA shell serving for the remote server.
 *
 * Three fixed files, fixed names (`/`, `/app.js`, `/app.css`): the request
 * path is never used to build a filesystem path, so there is no traversal
 * surface at all. The shell is public (no secrets compiled in; every data
 * route stays bearer-gated). Responses carry a strict CSP and no-store.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { ServerResponse } from 'node:http'

const SHELL_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/app.css': { file: 'app.css', type: 'text/css; charset=utf-8' },
} as const

export type ShellRoute = keyof typeof SHELL_FILES

const CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
  "img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"

/** Serves one of the fixed shell files from `dir`; 404 when not built. */
export function serveShellFile(
  shellDir: string,
  route: ShellRoute,
  response: ServerResponse
): void {
  const spec = SHELL_FILES[route]
  // Slash variants ('//', '/app.js/') can reach the shell handler even though
  // they are not real routes; answer 501 instead of crashing to 500.
  if (!spec) {
    response.writeHead(501, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'not_in_allowlist' }))
    return
  }
  const fullPath = path.join(shellDir, spec.file)
  let body: Buffer
  try {
    body = fs.readFileSync(fullPath)
  } catch {
    // The PWA build output is missing; say so without leaking paths.
    response.writeHead(404, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ error: 'shell_not_built' }))
    return
  }
  response.writeHead(200, {
    'content-type': spec.type,
    'content-security-policy': CSP,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  response.end(body)
}
