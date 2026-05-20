import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { isPathInside } from './shellEnv'

export function registerLocalFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'localfile', privileges: { secure: true, standard: false, supportFetchAPI: false } },
  ])
}

export function handleLocalFileProtocol(getCwd: () => string | null): void {
  protocol.handle('localfile', (request) => {
    const cwd = getCwd()
    if (!cwd) return new Response('No active workspace', { status: 404 })

    const filePath = path.resolve(decodeURIComponent(new URL(request.url).pathname))
    const workspaceRoot = path.resolve(cwd)
    if (!isPathInside(workspaceRoot, filePath)) {
      return new Response('File outside workspace', { status: 403 })
    }

    try {
      const stat = fs.lstatSync(filePath)
      if (!stat.isFile()) return new Response('Not a file', { status: 404 })

      const realWorkspaceRoot = fs.realpathSync(workspaceRoot)
      const realFilePath = fs.realpathSync(filePath)
      if (!isPathInside(realWorkspaceRoot, realFilePath)) {
        return new Response('File outside workspace', { status: 403 })
      }
    } catch {
      return new Response('File not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}
