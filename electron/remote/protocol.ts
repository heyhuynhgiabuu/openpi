/**
 * remote/protocol — Zod schemas for the remote HTTP boundary.
 *
 * Every remote request body is decoded here before any handler runs; unknown
 * fields are rejected. These are the remote counterparts of the desktop IPC
 * schemas and share their discipline: decode `unknown` into trusted types.
 */

import { z } from 'zod'

/** Body of POST /api/pair. The name is what the desktop device list shows. */
export const pairRequestSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/),
    name: z.string().trim().min(1).max(64),
  })
  .strict()
export type PairRequest = z.infer<typeof pairRequestSchema>

/** Body of the gate endpoints; the hunk payload only appears on pre-apply gates.
 *  SLICE-3 OBLIGATION: approvedIndexes entries are unbounded above here because
 *  the bound is the gate's hunk count — the gates registry must range-check
 *  them exactly like the desktop parseReviewAnswer does (out-of-range → empty
 *  approval), before any promise resolution.
 */
export const gateDecisionSchema = z
  .object({
    gateToken: z.string().min(16).max(256),
    approvedIndexes: z.array(z.number().int().nonnegative()).max(1000).optional(),
  })
  .strict()
export type GateDecision = z.infer<typeof gateDecisionSchema>
