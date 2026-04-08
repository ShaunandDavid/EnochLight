import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { JOB_STATUS_POLL_INTERVAL_MS, PLANNER_OPTIONS } from "@/lib/studio/constants";
import { resolveStudioDuration } from "@/lib/studio/duration-plan";
import { formatStudioError } from "@/lib/studio/errors";
import {
  createInitialVideo,
  downloadVideoContent,
  extendVideo,
  hasOpenAIKey,
  planVideoPrompts,
  pollVideoUntilComplete,
} from "@/lib/studio/openai";
import {
  ensureStudioStorage,
  getStudioVideoPath,
  listStudioJobs,
  readStudioJob,
  writeStudioJob,
} from "@/lib/studio/storage";
import {
  generateVideoRequestSchema,
  type GenerateVideoRequest,
  type StudioJob,
  type StudioJobSummary,
  type StudioSegmentState,
} from "@/lib/studio/types";

type ActiveRunMap = Map<string, Promise<void>>;

const studioGlobal = globalThis as typeof globalThis & {
  __studioActiveRuns?: ActiveRunMap;
};

const activeRuns = studioGlobal.__studioActiveRuns ?? new Map<string, Promise<void>>();
studioGlobal.__studioActiveRuns = activeRuns;

export async function createStudioJob(rawInput: GenerateVideoRequest): Promise<StudioJob> {
  const parsedInput = generateVideoRequestSchema.parse(rawInput);
  const durationResolution = resolveStudioDuration(parsedInput);
  const executionPlan = durationResolution.segmentPlan.segments;
  const jobId = `studio_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const resolvedInput = {
    ...parsedInput,
    totalDuration: durationResolution.totalDuration,
  };

  const job: StudioJob = {
    id: jobId,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    phase: "created",
    progress: 0,
    input: {
      ...resolvedInput,
      avoidList: normalizeAvoidList(resolvedInput.avoid),
    },
    durationRecommendation: durationResolution.recommendation,
    executionPlan,
    segmentStates: executionPlan.map((seconds, index) => ({
      index,
      kind: index === 0 ? "initial" : "extension",
      seconds,
      status: "pending",
    })),
    completedVideoIds: [],
    retryable: false,
    retryFromSegmentIndex: null,
    logs: [
      createLogEntry(
        hasOpenAIKey()
          ? durationResolution.recommendation.mode === "smart"
            ? `Job queued. Smart snap set the target to ${durationResolution.totalDuration}s.`
            : "Job queued. Waiting for prompt planning."
          : "Job queued, but OPENAI_API_KEY is missing.",
      ),
    ],
  };

  await writeStudioJob(job);
  enqueueStudioJob(job.id);
  return job;
}

export async function retryStudioJob(jobId: string): Promise<StudioJob> {
  const job = await loadStudioJob(jobId);
  if (!job.retryable) {
    throw new Error("This job is not retryable from a later extension segment.");
  }

  if (activeRuns.has(jobId)) {
    return job;
  }

  const resetSegments = job.segmentStates.map((segment, index) => {
    if (job.retryFromSegmentIndex === null || index < job.retryFromSegmentIndex) {
      return segment;
    }

    return {
      ...segment,
      status: "pending" as const,
      videoId: undefined,
      startedAt: undefined,
      completedAt: undefined,
      error: undefined,
    };
  });

  const updatedJob = await persistJob({
    ...job,
    status: "queued",
    phase: "created",
    progress: Math.min(job.progress, 85),
    retryable: false,
    retryFromSegmentIndex: null,
    error: undefined,
    segmentStates: resetSegments,
    logs: [...job.logs, createLogEntry("Retry requested. Resuming from the last completed segment.")],
  });

  enqueueStudioJob(jobId);
  return updatedJob;
}

export async function getStudioJob(jobId: string): Promise<StudioJob | null> {
  return readStudioJob(jobId);
}

export async function getStudioJobSummaries(limit = 12): Promise<StudioJobSummary[]> {
  const jobs = await listStudioJobs(limit);
  return jobs.map(toStudioJobSummary);
}

export function toStudioJobSummary(job: StudioJob): StudioJobSummary {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    title: job.title,
    roughIdea: job.input.roughIdea,
    model: job.input.model,
    format: job.input.format,
    targetDuration: job.input.totalDuration,
    finalDuration: job.finalDuration ?? null,
    previewUrl: job.finalAsset?.videoUrl ?? null,
    downloadUrl: job.finalAsset?.downloadUrl ?? null,
    finalOpenAiVideoId: job.finalOpenAiVideoId ?? null,
    retryable: job.retryable,
  };
}

export { JOB_STATUS_POLL_INTERVAL_MS };

function enqueueStudioJob(jobId: string) {
  if (activeRuns.has(jobId)) {
    return;
  }

  const run = runStudioJob(jobId).finally(() => {
    activeRuns.delete(jobId);
  });

  activeRuns.set(jobId, run);
}

async function runStudioJob(jobId: string): Promise<void> {
  await ensureStudioStorage();
  let job = await loadStudioJob(jobId);

  if (!hasOpenAIKey()) {
    throw await failJob(job, new Error("Missing OPENAI_API_KEY."), "planning");
  }

  if (!job.promptPlan) {
    job = await persistJob({
      ...job,
      status: "in_progress",
      phase: "planning",
      progress: 6,
      logs: [
        ...job.logs,
        createLogEntry(
          `Building the Sora prompt plan with ${PLANNER_OPTIONS[job.input.plannerMode].model}.`,
        ),
      ],
    });

    const promptPlan = await planVideoPrompts({
      roughIdea: job.input.roughIdea,
      platformPreset: job.input.platformPreset,
      format: job.input.format,
      totalDuration: job.input.totalDuration,
      executionPlan: job.executionPlan,
      style: job.input.style,
      plannerMode: job.input.plannerMode,
      avoidList: job.input.avoidList,
      selectedModel: job.input.model,
    }).catch(async (error) => {
      throw await failJob(job, error, "planning");
    });

    job = await persistJob({
      ...job,
      title: promptPlan.title,
      promptPlan,
      status: "in_progress",
      phase: "planning",
      progress: 14,
      logs: [...job.logs, createLogEntry(`Prompt plan ready: ${promptPlan.title}`)],
      segmentStates: job.executionPlan.map((seconds, index) => ({
        ...job.segmentStates[index],
        prompt: index === 0 ? promptPlan.initialPrompt : promptPlan.extensionPrompts[index - 1],
      })),
    });
  }

  const nextSegmentIndex = job.segmentStates.findIndex((segment) => segment.status !== "completed");
  if (nextSegmentIndex === -1) {
    if (!job.finalAsset && job.currentVideoId) {
      await finalizeStudioJob(job);
    }
    return;
  }

  for (let index = nextSegmentIndex; index < job.segmentStates.length; index += 1) {
    job = await loadStudioJob(jobId);
    const segment = job.segmentStates[index];
    const prompt =
      segment.prompt ??
      (index === 0 ? job.promptPlan?.initialPrompt : job.promptPlan?.extensionPrompts[index - 1]);

    if (!prompt) {
      throw await failJob(job, new Error(`Missing prompt for segment ${index + 1}.`), "planning");
    }

    const phase = index === 0 ? "creating_initial_video" : "extending_video";
    const logMessage =
      index === 0
        ? `Generating the opening ${segment.seconds}s clip.`
        : `Extending the video by ${segment.seconds}s for segment ${index + 1}.`;

    job = await updateSegment(job, index, {
      status: "in_progress",
      startedAt: new Date().toISOString(),
      error: undefined,
    });
    job = await persistJob({
      ...job,
      status: "in_progress",
      phase,
      progress: computeOverallProgress(index, 0, job.segmentStates.length),
      retryable: false,
      retryFromSegmentIndex: null,
      error: undefined,
      logs: [...job.logs, createLogEntry(logMessage)],
    });

    let video: Awaited<ReturnType<typeof createInitialVideo>>;
    try {
      video =
        index === 0
          ? await createInitialVideo({
              prompt,
              model: job.input.model,
              size: job.input.format,
              seconds: segment.seconds as 4 | 8 | 12,
            })
          : await extendVideo({
              videoId: job.currentVideoId ?? "",
              prompt,
              seconds: segment.seconds as 4 | 8 | 12 | 16 | 20,
            });
    } catch (error) {
      throw await failCurrentSegment(job, index, error, phase);
    }

    try {
      const completedVideo = await pollVideoUntilComplete({
        videoId: video.id,
        onUpdate: async (latestVideo) => {
          const refreshed = await loadStudioJob(jobId);
          job = await persistJob({
            ...refreshed,
            status: latestVideo.status === "queued" ? "queued" : "in_progress",
            phase: "polling_segment",
            latestVideoStatus: latestVideo.status,
            latestVideoProgress: latestVideo.progress ?? null,
            progress: computeOverallProgress(
              index,
              latestVideo.progress ?? 0,
              refreshed.segmentStates.length,
            ),
          });
        },
      });

      job = await updateSegment(job, index, {
        status: "completed",
        videoId: completedVideo.id,
        sourceVideoId: index === 0 ? undefined : job.currentVideoId ?? undefined,
        completedAt: new Date().toISOString(),
      });
      job = await persistJob({
        ...job,
        status: "in_progress",
        phase: "polling_segment",
        progress: computeOverallProgress(index + 1, 0, job.segmentStates.length),
        latestVideoStatus: completedVideo.status,
        latestVideoProgress: 100,
        currentVideoId: completedVideo.id,
        completedVideoIds: appendUnique(job.completedVideoIds, completedVideo.id),
        finalOpenAiVideoId: completedVideo.id,
        finalDuration: job.executionPlan.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
        downloadExpiresAt: completedVideo.expires_at ?? null,
        logs: [...job.logs, createLogEntry(`Segment ${index + 1} finished successfully.`)],
      });
    } catch (error) {
      throw await failCurrentSegment(job, index, error, "polling_segment");
    }
  }

  job = await loadStudioJob(jobId);
  await finalizeStudioJob(job);
}

async function finalizeStudioJob(job: StudioJob): Promise<void> {
  if (!job.currentVideoId) {
    throw await failJob(job, new Error("No completed OpenAI video ID is available to download."), "downloading");
  }
  const finalVideoId = job.currentVideoId;

  job = await persistJob({
    ...job,
    status: "in_progress",
    phase: "downloading",
    progress: 96,
    logs: [...job.logs, createLogEntry("Downloading and saving the final MP4 locally.")],
  });

  let buffer: Buffer;
  try {
    buffer = await downloadVideoContent(finalVideoId);
  } catch (error) {
    throw await failJob(job, error, "downloading");
  }

  const safeTitle = slugify(job.title ?? "sora-video");
  const fileName = `${job.id}-${safeTitle || "sora-video"}.mp4`;
  const localPath = getStudioVideoPath(fileName);
  await writeFile(localPath, buffer);

  await persistJob({
    ...job,
    status: "completed",
    phase: "completed",
    progress: 100,
    finalAsset: {
      localPath,
      fileName,
      bytes: buffer.byteLength,
      videoUrl: `/api/studio/jobs/${job.id}/video`,
      downloadUrl: `/api/studio/jobs/${job.id}/video?download=1`,
    },
    logs: [...job.logs, createLogEntry(`Saved final video to ${path.basename(localPath)}.`)],
  });
}

async function failCurrentSegment(
  job: StudioJob,
  index: number,
  error: unknown,
  stage: string,
): Promise<Error> {
  const studioError = formatStudioError(error, stage);
  const updated = await updateSegment(job, index, {
    status: "failed",
    error: studioError,
  });

  await persistJob({
    ...updated,
    status: "failed",
    phase: "failed",
    retryable: index > 0 && Boolean(updated.currentVideoId),
    retryFromSegmentIndex: index > 0 && updated.currentVideoId ? index : null,
    error: studioError,
    logs: [...updated.logs, createLogEntry(`Segment ${index + 1} failed: ${studioError.message}`)],
  });

  return new Error(studioError.message);
}

async function failJob(job: StudioJob, error: unknown, stage: string): Promise<Error> {
  const studioError = formatStudioError(error, stage);
  await persistJob({
    ...job,
    status: "failed",
    phase: "failed",
    retryable: false,
    retryFromSegmentIndex: null,
    error: studioError,
    logs: [...job.logs, createLogEntry(`${stage} failed: ${studioError.message}`)],
  });

  return new Error(studioError.message);
}

async function updateSegment(
  job: StudioJob,
  index: number,
  updates: Partial<StudioSegmentState>,
): Promise<StudioJob> {
  const nextSegments = job.segmentStates.map((segment) =>
    segment.index === index ? { ...segment, ...updates } : segment,
  );

  return persistJob({
    ...job,
    segmentStates: nextSegments,
  });
}

async function persistJob(job: StudioJob): Promise<StudioJob> {
  return writeStudioJob({
    ...job,
    updatedAt: new Date().toISOString(),
  });
}

async function loadStudioJob(jobId: string): Promise<StudioJob> {
  const job = await readStudioJob(jobId);
  if (!job) {
    throw new Error(`Studio job ${jobId} was not found.`);
  }

  return job;
}

function computeOverallProgress(
  completedSegments: number,
  segmentProgress: number,
  segmentCount: number,
): number {
  const planningSlice = 14;
  const renderingSlice = 78;
  const completedValue = completedSegments / segmentCount;
  const inFlightValue = segmentProgress / 100 / segmentCount;
  return Math.max(
    planningSlice,
    Math.min(95, Math.round(planningSlice + (completedValue + inFlightValue) * renderingSlice)),
  );
}

function normalizeAvoidList(avoidText: string): string[] {
  return avoidText
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createLogEntry(message: string) {
  return {
    id: crypto.randomUUID(),
    time: new Date().toISOString(),
    message,
  };
}

function appendUnique(values: string[], nextValue: string): string[] {
  return values.includes(nextValue) ? values : [...values, nextValue];
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
