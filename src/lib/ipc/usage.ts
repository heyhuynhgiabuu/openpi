import { z } from 'zod'

export const usageSummaryRequestSchema = z
  .object({
    workspacePath: z.string().min(1).optional(),
    days: z.number().int().positive().max(366).optional(),
  })
  .optional()
  .default({})
export type UsageSummaryRequest = z.infer<typeof usageSummaryRequestSchema>

export const usageTotalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cacheReadTokens: z.number(),
  cacheWriteTokens: z.number(),
  totalTokens: z.number(),
  durationMs: z.number(),
  cost: z.number(),
  turnCount: z.number(),
  sessionCount: z.number(),
  cacheHitRate: z.number().nullable().optional(),
})
export type UsageTotals = z.infer<typeof usageTotalsSchema>

export const usageDaySchema = usageTotalsSchema.extend({ date: z.string() })
export type UsageDay = z.infer<typeof usageDaySchema>

export const tokenRatesSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
})
export type TokenRates = z.infer<typeof tokenRatesSchema>

export const usageModelBucketSchema = usageTotalsSchema.extend({
  model: z.string(),
  provider: z.string().optional(),
  rates: tokenRatesSchema.nullable().optional(),
})
export type UsageModelBucket = z.infer<typeof usageModelBucketSchema>

export const usageDayModelSchema = usageTotalsSchema.extend({
  date: z.string(),
  model: z.string(),
  provider: z.string().optional(),
})
export type UsageDayModel = z.infer<typeof usageDayModelSchema>

export const usageSummarySchema = z.object({
  generatedAt: z.string(),
  workspacePath: z.string().nullable(),
  days: z.number(),
  lifetime: usageTotalsSchema.extend({
    activeDays: z.number(),
    longestTaskMs: z.number().nullable(),
  }),
  today: usageTotalsSchema,
  last7Days: usageTotalsSchema,
  last30Days: usageTotalsSchema,
  currentStreakDays: z.number(),
  longestStreakDays: z.number(),
  peakDay: usageDaySchema.nullable(),
  daily: z.array(usageDaySchema),
  models: z.array(usageModelBucketSchema),
  dailyModels: z.array(usageDayModelSchema),
  previousRange: z.object({
    days: z.number(),
    models: z.array(usageModelBucketSchema),
  }),
})
export type UsageSummary = z.infer<typeof usageSummarySchema>
