import { readFile } from "node:fs/promises";

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
  type StudioPreparedReferenceAsset,
  type StudioReferenceAsset,
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
  referenceAsset?: Pick<StudioReferenceAsset, "originalFileName" | "width" | "height">;
}

interface CreateInitialVideoArgs {
  prompt: string;
  model: StudioVideoModel;
  size: StudioFormat;
  seconds: 4 | 8 | 12;
  referenceAsset?: StudioPreparedReferenceAsset;
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
  const pacingGuidance = buildPacingGuidanceLines(args.roughIdea, expectedExtensionCount);

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
          args.referenceAsset
            ? `A reference asset will also be supplied to Sora: ${args.referenceAsset.originalFileName} (${args.referenceAsset.width}x${args.referenceAsset.height}). Treat it as a visual identity anchor and preserve its recognizable structure when it appears in-frame.`
            : "No reference asset will be supplied.",
          "Return structured JSON only.",
          "Master prompt rules:",
          "- Write like a premium director brief, not vague user language.",
          "- Keep one continuous scene and visual world instead of a montage.",
          "- Be specific about subject, action, camera, lighting, palette, texture, pace, and motion.",
          "- Optimize for social media watchability and clean visual intent.",
          args.referenceAsset
            ? "- If the reference asset is staged in the video, preserve its key letterforms, silhouette, geometry, and core color logic instead of morphing it into a different brand mark or prop."
            : "- If you introduce branding, keep it coherent and readable.",
          "Pacing rules:",
          ...pacingGuidance,
          "Initial prompt rules:",
          "- Establish the subject, setting, camera language, lighting motivation, palette, and movement clearly.",
          "- Make the first seconds immediately compelling.",
          "Extension prompt rules:",
          `- Return exactly ${Math.max(args.executionPlan.length - 1, 0)} extension prompts.`,
          "- Every extension prompt must continue directly from the previous finished frame.",
          "- Explicitly preserve subject continuity, camera direction, lighting logic, palette, motion continuity, and scene intent.",
          "- Do not reset the scene, introduce abrupt cuts, or jump to unrelated compositions.",
          "- Every non-final extension must keep forward momentum and should hand off into the next beat while motion or intent is still active.",
          "- Only the final extension may settle into a hero hold or brand lock, and that hold should happen in the final 10-15% of the total video rather than early.",
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
  const inputReference = args.referenceAsset
    ? await createVideoInputReference(args.referenceAsset.localPath, args.referenceAsset.mimeType)
    : undefined;

  return createVideoJob({
    model: args.model,
    prompt: args.prompt,
    size: args.size,
    seconds: String(args.seconds) as OpenAI.Videos.VideoSeconds,
    input_reference: inputReference,
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
          "Keep middle-section momentum active and reserve any true hero hold or brand settle for only the tail of the final extension.",
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

export function buildPacingGuidanceLines(
  roughIdea: string,
  expectedExtensionCount: number,
) {
  const dialogueLed = isDialogueLedBrief(roughIdea);

  const guidance = [
    "- Quiet atmosphere is allowed when visual progression remains active, but do not create dead air where the subject, camera, and environment all stall at once.",
    "- Use the first moments for hook/setup and the final moments for payoff/landing; do not spend that breathing room as an early mid-video settle.",
  ];

  if (expectedExtensionCount > 0) {
    guidance.push(
      "- The middle stretch of the video must keep progressing through action, camera movement, UI evolution, expression change, or environmental motion.",
    );
  }

  if (dialogueLed) {
    guidance.push(
      "- This brief is dialogue-led, so avoid long idle beats between spoken ideas. If one line finishes, bridge into the next visual or performance beat within about 1 second unless this is the final hold.",
    );
    guidance.push(
      "- Do not let the speaker emotionally resolve too early. Keep performance energy and blocking active until the final payoff window.",
    );
  } else {
    guidance.push(
      "- This brief may rely more on visual storytelling, so cinematic breathing room is fine, but avoid any 3-5 second flatline before the final payoff.",
    );
  }

  return guidance;
}

export function isDialogueLedBrief(roughIdea: string) {
  return /\b(spoken script|spokesperson|voiceover|speaks?|talks?|says|direct to camera|narrat(?:e|ion|or)|dialogue)\b/i.test(
    roughIdea,
  ) || /["“”]/.test(roughIdea);
}

export async function createVideoInputReference(localPath: string, mimeType: string) {
  const fileBytes = await readFile(localPath);
  return {
    image_url: toDataUrl(fileBytes, mimeType),
  } satisfies OpenAI.Videos.ImageInputReferenceParam;
}

export function toDataUrl(bytes: Uint8Array, mimeType: string) {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

async function createVideoJob(body: {
  model: StudioVideoModel;
  prompt: string;
  size: StudioFormat;
  seconds: OpenAI.Videos.VideoSeconds;
  input_reference?: OpenAI.Videos.ImageInputReferenceParam;
}) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY. Add it to your local environment before generating.");
  }

  // The current Node SDK hardcodes videos.create() to multipart. A direct JSON call is
  // more reliable for input_reference objects that contain large data URLs.
  const response = await fetch("https://api.openai.com/v1/videos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const payload = (await response.json()) as OpenAI.Videos.Video & {
    error?: { message?: string } | null;
  };

  if (!response.ok) {
    throw new Error(payload.error?.message ?? "Failed to create the initial Sora video.");
  }

  return payload;
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
