import { z } from "zod";

import {
  DURATION_MODE_IDS,
  EXTENSION_SEGMENT_SECONDS,
  FORMAT_IDS,
  INITIAL_SEGMENT_SECONDS,
  isFormatSupportedByModel,
  JOB_PHASES,
  JOB_STATUSES,
  PLANNER_MODE_IDS,
  PLATFORM_PRESET_IDS,
  SEGMENT_STATUSES,
  STYLE_PRESET_IDS,
  VIDEO_MODELS,
} from "@/lib/studio/constants";

export const platformPresetSchema = z.enum(PLATFORM_PRESET_IDS);
export const formatSchema = z.enum(FORMAT_IDS);
export const stylePresetSchema = z.enum(STYLE_PRESET_IDS);
export const videoModelSchema = z.enum(VIDEO_MODELS);
export const plannerModeSchema = z.enum(PLANNER_MODE_IDS);
export const durationModeSchema = z.enum(DURATION_MODE_IDS);
export const jobStatusSchema = z.enum(JOB_STATUSES);
export const jobPhaseSchema = z.enum(JOB_PHASES);
export const segmentStatusSchema = z.enum(SEGMENT_STATUSES);
export const initialSegmentSecondsSchema = z.enum(
  INITIAL_SEGMENT_SECONDS.map(String) as [string, ...string[]],
);
export const extensionSegmentSecondsSchema = z.enum(
  EXTENSION_SEGMENT_SECONDS.map(String) as [string, ...string[]],
);

export const generateVideoRequestSchema = z
  .object({
    roughIdea: z.string().trim().min(1, "Rough idea is required."),
    platformPreset: platformPresetSchema,
    format: formatSchema,
    totalDuration: z
      .number()
      .int()
      .min(4, "Total duration must be at least 4 seconds.")
      .max(120, "Total duration must be 120 seconds or less."),
    model: videoModelSchema,
    durationMode: durationModeSchema.optional().default("manual"),
    plannerMode: plannerModeSchema.optional().default("standard"),
    style: stylePresetSchema,
    avoid: z.string().trim().max(800).optional().default(""),
  })
  .superRefine((value, context) => {
    if (!isFormatSupportedByModel(value.model, value.format)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["format"],
        message: `${value.model} does not support ${value.format}. Choose a compatible render size.`,
      });
    }
  });

export const promptPlanSchema = z.object({
  title: z.string().trim().min(1),
  masterPrompt: z.string().trim().min(1),
  initialPrompt: z.string().trim().min(1),
  extensionPrompts: z.array(z.string().trim().min(1)),
  recommendedModel: videoModelSchema,
  recommendedSize: formatSchema,
  segmentPlan: z.array(z.number().int().positive()).min(1),
  captionSuggestion: z.string().trim().min(1),
  avoidList: z.array(z.string().trim().min(1)),
});

export const studioErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  type: z.string().optional(),
  stage: z.string().optional(),
});

export const studioLogEntrySchema = z.object({
  id: z.string(),
  time: z.string(),
  message: z.string(),
});

export const studioSegmentStateSchema = z.object({
  index: z.number().int().nonnegative(),
  kind: z.enum(["initial", "extension"]),
  seconds: z.number().int().positive(),
  prompt: z.string().optional(),
  status: segmentStatusSchema,
  sourceVideoId: z.string().optional(),
  videoId: z.string().optional(),
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  error: studioErrorSchema.optional(),
});

export const studioFinalAssetSchema = z.object({
  localPath: z.string(),
  fileName: z.string(),
  bytes: z.number().int().nonnegative(),
  videoUrl: z.string(),
  downloadUrl: z.string(),
});

export const studioDurationRecommendationSchema = z.object({
  mode: durationModeSchema,
  requestedDuration: z.number().int().positive(),
  resolvedDuration: z.number().int().positive(),
  estimatedNarrationSeconds: z.number().nonnegative(),
  estimatedVisualSeconds: z.number().nonnegative(),
  openingBufferSeconds: z.number().int().nonnegative(),
  endingBufferSeconds: z.number().int().nonnegative(),
  brandHoldSeconds: z.number().int().nonnegative(),
  explicitDurationSeconds: z.number().positive().optional(),
  cappedToMax: z.boolean(),
  executionPlan: z.array(z.number().int().positive()).min(1),
  summary: z.string().trim().min(1),
  reasons: z.array(z.string().trim().min(1)),
});

export const studioJobInputSchema = generateVideoRequestSchema.extend({
  avoidList: z.array(z.string()),
});

export const studioJobSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: jobStatusSchema,
  phase: jobPhaseSchema,
  progress: z.number().min(0).max(100),
  title: z.string().optional(),
  input: studioJobInputSchema,
  executionPlan: z.array(z.number().int().positive()).min(1),
  promptPlan: promptPlanSchema.optional(),
  segmentStates: z.array(studioSegmentStateSchema),
  currentVideoId: z.string().nullable().optional(),
  latestVideoStatus: jobStatusSchema.nullable().optional(),
  latestVideoProgress: z.number().nullable().optional(),
  completedVideoIds: z.array(z.string()),
  finalOpenAiVideoId: z.string().optional(),
  finalDuration: z.number().int().positive().optional(),
  downloadExpiresAt: z.number().nullable().optional(),
  finalAsset: studioFinalAssetSchema.optional(),
  durationRecommendation: studioDurationRecommendationSchema.optional(),
  retryable: z.boolean(),
  retryFromSegmentIndex: z.number().int().nullable(),
  error: studioErrorSchema.optional(),
  logs: z.array(studioLogEntrySchema),
});

export const studioJobSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  status: jobStatusSchema,
  phase: jobPhaseSchema,
  progress: z.number().min(0).max(100),
  title: z.string().optional(),
  roughIdea: z.string(),
  model: videoModelSchema,
  format: formatSchema,
  targetDuration: z.number().int().positive(),
  finalDuration: z.number().int().positive().nullable(),
  previewUrl: z.string().nullable(),
  downloadUrl: z.string().nullable(),
  finalOpenAiVideoId: z.string().nullable(),
  retryable: z.boolean(),
});

export type PlatformPresetId = z.infer<typeof platformPresetSchema>;
export type StudioFormat = z.infer<typeof formatSchema>;
export type StudioStylePreset = z.infer<typeof stylePresetSchema>;
export type StudioVideoModel = z.infer<typeof videoModelSchema>;
export type StudioPlannerMode = z.infer<typeof plannerModeSchema>;
export type StudioDurationMode = z.infer<typeof durationModeSchema>;
export type StudioJobStatus = z.infer<typeof jobStatusSchema>;
export type StudioJobPhase = z.infer<typeof jobPhaseSchema>;
export type StudioSegmentStatus = z.infer<typeof segmentStatusSchema>;
export type GenerateVideoRequest = z.infer<typeof generateVideoRequestSchema>;
export type VideoPromptPlan = z.infer<typeof promptPlanSchema>;
export type StudioError = z.infer<typeof studioErrorSchema>;
export type StudioLogEntry = z.infer<typeof studioLogEntrySchema>;
export type StudioSegmentState = z.infer<typeof studioSegmentStateSchema>;
export type StudioFinalAsset = z.infer<typeof studioFinalAssetSchema>;
export type StudioDurationRecommendation = z.infer<typeof studioDurationRecommendationSchema>;
export type StudioJobInput = z.infer<typeof studioJobInputSchema>;
export type StudioJob = z.infer<typeof studioJobSchema>;
export type StudioJobSummary = z.infer<typeof studioJobSummarySchema>;

export type InitialSegmentSeconds = (typeof INITIAL_SEGMENT_SECONDS)[number];
export type ExtensionSegmentSeconds = (typeof EXTENSION_SEGMENT_SECONDS)[number];
export type AllowedSegmentSeconds = ExtensionSegmentSeconds;
