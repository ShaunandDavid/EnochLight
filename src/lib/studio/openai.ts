import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

import {
  FORMAT_OPTIONS,
  OPENAI_VIDEO_POLL_INTERVAL_MS,
  OPENAI_VIDEO_POLL_TIMEOUT_MS,
  PLANNER_OPTIONS,
  PLATFORM_PRESETS,
  STYLE_PRESETS,
} from "@/lib/studio/constants";
import { formatStudioError } from "@/lib/studio/errors";
import {
  promptPlanSchema,
  type VideoPromptPlan,
  type StudioFormat,
  type StudioPlannerMode,
  type StudioVideoModel,
} from "@/lib/studio/types";

interface PlanVideoPromptsArgs {
  roughIdea: string;
  platformPreset: keyof typeof PLATFORM_PRESETS;
  format: StudioFormat;
  totalDuration: number;
  executionPlan: number[];
  style: keyof typeof STYLE_PRESETS;
  avoidList: string[];
  selectedModel: StudioVideoModel;
  plannerMode: StudioPlannerMode;
}

interface CreateInitialVideoArgs {
  prompt: string;
  model: StudioVideoModel;
  size: StudioFormat;
  seconds: 4 | 8 | 12;
}

interface ExtendVideoArgs {
  videoId: string;
  prompt: string;
  seconds: 4 | 8 | 12 | 16 | 20;
}

interface PollVideoUntilCompleteArgs {
  videoId: string;
  onUpdate?: (video: OpenAI.Videos.Video) => Promise<void> | void;
  timeoutMs?: number;
  intervalMs?: number;
}

let cachedClient: OpenAI | null = null;

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY. Add it to your local environment before generating.");
  }

  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey });
  }

  return cachedClient;
}

export async function planVideoPrompts(args: PlanVideoPromptsArgs) {
  const client = getOpenAIClient();
  const format = FORMAT_OPTIONS[args.format];
  const platform = PLATFORM_PRESETS[args.platformPreset];
  const style = STYLE_PRESETS[args.style];
  const planner = PLANNER_OPTIONS[args.plannerMode];
  const expectedExtensionCount = Math.max(args.executionPlan.length - 1, 0);

  const response = await client.responses.parse({
    model: planner.model,
    reasoning: { effort: planner.reasoningEffort },
    input: [
      {
        role: "system",
        content:
          "You are a high-end creative director and cinematographer. Build Sora-ready prompt plans for continuous social video generation. Be visually concrete, disciplined, and continuity-aware.",
      },
      {
        role: "user",
        content: [
          `The user's rough idea: ${args.roughIdea}`,
          `Platform preset: ${platform.label}. ${platform.description}`,
          `Requested style / vibe: ${style.label}. ${style.description}`,
          `Requested duration: ${args.totalDuration} seconds.`,
          `Execution segment plan is fixed and must be returned exactly as ${JSON.stringify(args.executionPlan)}.`,
          `The first segment is a fresh generation. Remaining segments are video extensions chained for continuity.`,
          `Chosen delivery format: ${format.label}. Actual OpenAI render size: ${format.id}. ${format.note}`,
          `Use the ${planner.label} setting while planning. The current planner model is ${planner.model}.`,
          `Chosen generation model from the UI: ${args.selectedModel}. You may still recommend sora-2 or sora-2-pro in the JSON.`,
          `Avoid directives from the user: ${
            args.avoidList.length > 0 ? args.avoidList.join(", ") : "none supplied"
          }.`,
          "Return structured JSON only.",
          "Master prompt rules:",
          "- Write like a premium director brief, not vague user language.",
          "- Keep one continuous scene and visual world instead of a montage.",
          "- Be specific about subject, action, camera, lighting, palette, texture, pace, and motion.",
          "- Optimize for social media watchability and clean visual intent.",
          "Initial prompt rules:",
          "- Establish the subject, setting, camera language, lighting motivation, palette, and movement clearly.",
          "- Make the first seconds immediately compelling.",
          "Extension prompt rules:",
          `- Return exactly ${Math.max(args.executionPlan.length - 1, 0)} extension prompts.`,
          "- Every extension prompt must continue directly from the previous finished frame.",
          "- Explicitly preserve subject continuity, camera direction, lighting logic, palette, motion continuity, and scene intent.",
          "- Do not reset the scene, introduce abrupt cuts, or jump to unrelated compositions.",
          "Avoid list rules:",
          "- Include the user's avoid items plus any continuity hazards you think matter.",
        ].join("\n"),
      },
    ],
    text: {
      format: zodTextFormat(promptPlanSchema, "sora_social_prompt_plan"),
    },
  });

  const parsed = response.output_parsed;
  if (!parsed) {
    throw new Error("Prompt planner returned an empty result.");
  }

  const repairedPlan =
    parsed.extensionPrompts.length === expectedExtensionCount
      ? parsed
      : await repairPromptPlan({
          client,
          planner,
          originalPlan: parsed,
          expectedExtensionCount,
          executionPlan: args.executionPlan,
        });

  const alignedPlan = coercePromptPlanExtensionCount(repairedPlan, expectedExtensionCount);

  if (alignedPlan.extensionPrompts.length !== expectedExtensionCount) {
    throw new Error(
      `Prompt planner returned ${alignedPlan.extensionPrompts.length} extension prompts for a ${args.executionPlan.length}-segment execution plan.`,
    );
  }

  return {
    ...alignedPlan,
    segmentPlan: [...args.executionPlan],
  };
}

export async function createInitialVideo(args: CreateInitialVideoArgs) {
  return getOpenAIClient().videos.create({
    model: args.model,
    prompt: args.prompt,
    size: args.size,
    seconds: String(args.seconds) as OpenAI.Videos.VideoSeconds,
  });
}

export async function extendVideo(args: ExtendVideoArgs) {
  const body = {
    video: { id: args.videoId },
    prompt: args.prompt,
    // The SDK types lag the docs here. The current API guide allows 16s and 20s extensions.
    seconds: String(args.seconds),
  };

  return getOpenAIClient().videos.extend(
    body as unknown as OpenAI.Videos.VideoExtendParams,
  );
}

export async function pollVideoUntilComplete({
  videoId,
  onUpdate,
  timeoutMs = OPENAI_VIDEO_POLL_TIMEOUT_MS,
  intervalMs = OPENAI_VIDEO_POLL_INTERVAL_MS,
}: PollVideoUntilCompleteArgs) {
  const client = getOpenAIClient();
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const video = await client.videos.retrieve(videoId);
    await onUpdate?.(video);

    if (video.status === "completed") {
      return video;
    }

    if (video.status === "failed") {
      throw new Error(video.error?.message ?? "Video generation failed.");
    }

    await sleep(intervalMs);
  }

  throw new Error("Timed out while waiting for the video to complete.");
}

export async function downloadVideoContent(videoId: string) {
  const response = await getOpenAIClient().videos.downloadContent(videoId, {
    variant: "video",
  });

  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export function formatOpenAIError(error: unknown, stage: string) {
  return formatStudioError(error, stage);
}

async function repairPromptPlan(args: {
  client: OpenAI;
  planner: (typeof PLANNER_OPTIONS)[keyof typeof PLANNER_OPTIONS];
  originalPlan: VideoPromptPlan;
  expectedExtensionCount: number;
  executionPlan: number[];
}) {
  const response = await args.client.responses.parse({
    model: args.planner.model,
    reasoning: { effort: args.planner.reasoningEffort },
    input: [
      {
        role: "system",
        content:
          "You repair structured Sora prompt plans. Keep the creative direction intact, but fix prompt counts so the plan exactly matches the execution chain.",
      },
      {
        role: "user",
        content: [
          `The execution segment plan is fixed at ${JSON.stringify(args.executionPlan)}.`,
          `The initialPrompt already covers segment 1.`,
          `Return exactly ${args.expectedExtensionCount} extension prompts for the continuation segments only.`,
          "Do not add or remove any fields from the JSON schema.",
          "If there are too many extension prompts, merge or remove the least necessary extras while preserving continuity.",
          "If there are too few extension prompts, split or expand the later beats so every remaining segment has one continuation prompt.",
          `Original plan JSON: ${JSON.stringify(args.originalPlan)}`,
        ].join("\n"),
      },
    ],
    text: {
      format: zodTextFormat(promptPlanSchema, "sora_social_prompt_plan_repair"),
    },
  });

  return response.output_parsed ?? args.originalPlan;
}

export function coercePromptPlanExtensionCount(
  plan: VideoPromptPlan,
  expectedExtensionCount: number,
): VideoPromptPlan {
  if (plan.extensionPrompts.length === expectedExtensionCount) {
    return plan;
  }

  if (expectedExtensionCount === 0) {
    return {
      ...plan,
      extensionPrompts: [],
    };
  }

  if (plan.extensionPrompts.length > expectedExtensionCount) {
    return {
      ...plan,
      extensionPrompts: plan.extensionPrompts.slice(0, expectedExtensionCount),
    };
  }

  const prompts = [...plan.extensionPrompts];
  const seedPrompt = prompts.at(-1) ?? plan.initialPrompt;

  while (prompts.length < expectedExtensionCount) {
    prompts.push(
      `${seedPrompt} Continue directly from the final frame and preserve continuity for the next extension segment.`,
    );
  }

  return {
    ...plan,
    extensionPrompts: prompts,
  };
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
