import { contextBridge } from 'electron'
import { api } from './preload/api'

/**
 * Narrow, typed preload bridge.
 * Renderer accesses ONLY what is explicitly exposed here.
 * No Node built-ins, no raw ipcRenderer, no electron imports in renderer.
 */
contextBridge.exposeInMainWorld('openpi', api)

export type OpenPiAPI = typeof api
