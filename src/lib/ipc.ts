/**
 * IPC channel definitions and Zod schemas (barrel).
 *
 * All payloads crossing the preload boundary are validated here.
 * Renderer imports types only — never imports electron or node builtins.
 *
 * Content re-exported from ipc/ submodules for backward compatibility.
 * See lib/ipc/ directory for the actual definitions.
 */
export * from './ipc/index'
