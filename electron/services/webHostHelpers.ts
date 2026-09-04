import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import { app } from 'electron'

export function resolveRendererPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'out', 'renderer')
  const dev = path.join(app.getAppPath(), 'out', 'renderer')
  if (fs.existsSync(dev)) return dev
  return path.resolve(process.cwd(), 'out', 'renderer')
}

export function contentType(filePath: string): string {
  switch (path.extname(filePath)) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.ico':
      return 'image/x-icon'
    case '.map':
      return 'application/json'
    default:
      return 'application/octet-stream'
  }
}

export function securityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
}

export function etagFor(buf: Buffer): string {
  return `"${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}"`
}

export function readBody(req: http.IncomingMessage, limit = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}
