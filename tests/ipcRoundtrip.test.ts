/**
 * IPC Zod schema roundtrip tests.
 *
 * Validates that every key IPC payload schema parses valid data correctly
 * and rejects invalid data.  Schemas are the contract between Electron main
 * and the renderer — a parse failure at runtime is a hard crash risk.
 */

