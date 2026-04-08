import {
  SMART_DURATION_BRAND_HOLD_SECONDS,
  SMART_DURATION_ENDING_BUFFER_SECONDS,
  SMART_DURATION_OPENING_BUFFER_SECONDS,
  EXTENSION_SEGMENT_SECONDS,
  INITIAL_SEGMENT_SECONDS,
  TOTAL_DURATION_OPTIONS,
} from "@/lib/studio/constants";
import type {
  AllowedSegmentSeconds,
  GenerateVideoRequest,
  InitialSegmentSeconds,
  StudioDurationRecommendation,
} from "@/lib/studio/types";

const descendingInitialSegments = [...INITIAL_SEGMENT_SECONDS].sort((a, b) => b - a);
const descendingExtensionSegments = [...EXTENSION_SEGMENT_SECONDS].sort((a, b) => b - a);
const maxSupportedDuration = TOTAL_DURATION_OPTIONS[TOTAL_DURATION_OPTIONS.length - 1];

export interface SegmentPlanResult {
  segments: AllowedSegmentSeconds[];
  totalSeconds: number;
  initialSeconds: InitialSegmentSeconds;
  extensionSeconds: AllowedSegmentSeconds[];
}

interface SmartDurationArgs {
  roughIdea: string;
  platformPreset: GenerateVideoRequest["platformPreset"];
  style: GenerateVideoRequest["style"];
  requestedDuration: number;
}

interface DurationResolutionResult {
  totalDuration: number;
  segmentPlan: SegmentPlanResult;
  recommendation: StudioDurationRecommendation;
}

export function buildSegmentPlan(totalSeconds: number): SegmentPlanResult {
  if (!Number.isInteger(totalSeconds) || totalSeconds < 4 || totalSeconds % 4 !== 0) {
    throw new Error("Total duration must be a whole number and a multiple of 4.");
  }

  let bestSegmentCount = Number.POSITIVE_INFINITY;
  const candidates: AllowedSegmentSeconds[][] = [];

  const search = (
    remaining: number,
    isInitial: boolean,
    current: AllowedSegmentSeconds[],
  ) => {
    if (current.length > bestSegmentCount) {
      return;
    }

    if (remaining === 0) {
      if (current.length < bestSegmentCount) {
        bestSegmentCount = current.length;
        candidates.length = 0;
      }

      candidates.push([...current]);
      return;
    }

    const options = isInitial ? descendingInitialSegments : descendingExtensionSegments;
    for (const option of options) {
      if (option > remaining) {
        continue;
      }

      current.push(option);
      search(remaining - option, false, current);
      current.pop();
    }
  };

  search(totalSeconds, true, []);

  if (candidates.length === 0) {
    throw new Error("Unable to create a valid extension plan for that duration.");
  }

  candidates.sort(comparePlans);
  const selectedPlan = candidates[0];

  return {
    segments: selectedPlan,
    totalSeconds,
    initialSeconds: selectedPlan[0] as InitialSegmentSeconds,
    extensionSeconds: selectedPlan.slice(1),
  };
}

export function resolveStudioDuration(
  input: Pick<
    GenerateVideoRequest,
    "durationMode" | "roughIdea" | "platformPreset" | "style" | "totalDuration"
  >,
): DurationResolutionResult {
  if (input.durationMode === "smart") {
    const recommendation = recommendSmartDuration({
      roughIdea: input.roughIdea,
      platformPreset: input.platformPreset,
      style: input.style,
      requestedDuration: input.totalDuration,
    });

    return {
      totalDuration: recommendation.resolvedDuration,
      segmentPlan: buildSegmentPlan(recommendation.resolvedDuration),
      recommendation,
    };
  }

  const segmentPlan = buildSegmentPlan(input.totalDuration);
  return {
    totalDuration: input.totalDuration,
    segmentPlan,
    recommendation: {
      mode: "manual",
      requestedDuration: input.totalDuration,
      resolvedDuration: input.totalDuration,
      estimatedNarrationSeconds: 0,
      estimatedVisualSeconds: 0,
      openingBufferSeconds: 0,
      endingBufferSeconds: 0,
      brandHoldSeconds: 0,
      cappedToMax: false,
      executionPlan: [...segmentPlan.segments],
      summary: `Manual duration locked at ${input.totalDuration} seconds.`,
      reasons: ["Manual duration override is active."],
    },
  };
}

export function recommendSmartDuration({
  roughIdea,
  platformPreset,
  style,
  requestedDuration,
}: SmartDurationArgs): StudioDurationRecommendation {
  const normalizedIdea = roughIdea.trim();
  if (!normalizedIdea) {
    const fallbackDuration = snapDurationUp(requestedDuration);
    const segmentPlan = buildSegmentPlan(fallbackDuration);
    return {
      mode: "smart",
      requestedDuration,
      resolvedDuration: fallbackDuration,
      estimatedNarrationSeconds: 0,
      estimatedVisualSeconds: 0,
      openingBufferSeconds: SMART_DURATION_OPENING_BUFFER_SECONDS,
      endingBufferSeconds: SMART_DURATION_ENDING_BUFFER_SECONDS,
      brandHoldSeconds: 0,
      cappedToMax: false,
      executionPlan: [...segmentPlan.segments],
      summary:
        "Smart snap needs a fuller prompt to estimate timing, so it fell back to the nearest supported duration.",
      reasons: ["No rough idea text was available for timing analysis."],
    };
  }

  const explicitDurationSeconds = extractExplicitDurationSeconds(normalizedIdea);
  const narrationSeconds = explicitDurationSeconds ?? estimateNarrationSeconds(normalizedIdea, style);
  const visualSeconds = estimateVisualSeconds(normalizedIdea, platformPreset, style);
  const brandHoldSeconds = shouldAddBrandHold(normalizedIdea)
    ? SMART_DURATION_BRAND_HOLD_SECONDS
    : 0;
  const rawRecommendedSeconds =
    Math.max(narrationSeconds, visualSeconds, 4) +
    SMART_DURATION_OPENING_BUFFER_SECONDS +
    SMART_DURATION_ENDING_BUFFER_SECONDS +
    brandHoldSeconds;

  const resolvedDuration = snapDurationUp(rawRecommendedSeconds);
  const segmentPlan = buildSegmentPlan(resolvedDuration);
  const reasons = buildReasonSummary({
    roughIdea: normalizedIdea,
    narrationSeconds,
    visualSeconds,
    platformPreset,
    explicitDurationSeconds,
    brandHoldSeconds,
  });

  const summaryParts = [
    `Estimated ${formatSeconds(Math.max(narrationSeconds, visualSeconds))} of active content`,
    `plus ${SMART_DURATION_OPENING_BUFFER_SECONDS}s opening buffer`,
    `and ${SMART_DURATION_ENDING_BUFFER_SECONDS}s ending buffer`,
  ];

  if (brandHoldSeconds > 0) {
    summaryParts.push(`and ${brandHoldSeconds}s brand/hero hold`);
  }

  return {
    mode: "smart",
    requestedDuration,
    resolvedDuration,
    estimatedNarrationSeconds: roundToTenths(narrationSeconds),
    estimatedVisualSeconds: roundToTenths(visualSeconds),
    openingBufferSeconds: SMART_DURATION_OPENING_BUFFER_SECONDS,
    endingBufferSeconds: SMART_DURATION_ENDING_BUFFER_SECONDS,
    brandHoldSeconds,
    explicitDurationSeconds: explicitDurationSeconds ? roundToTenths(explicitDurationSeconds) : undefined,
    cappedToMax: rawRecommendedSeconds > maxSupportedDuration,
    executionPlan: [...segmentPlan.segments],
    summary: `${summaryParts.join(", ")}, then snapped up to ${resolvedDuration}s for a cleaner finish.`,
    reasons,
  };
}

function comparePlans(
  left: AllowedSegmentSeconds[],
  right: AllowedSegmentSeconds[],
): number {
  const leftShortSegments = left.filter((segment) => segment < 8).length;
  const rightShortSegments = right.filter((segment) => segment < 8).length;
  if (leftShortSegments !== rightShortSegments) {
    return leftShortSegments - rightShortSegments;
  }

  const leftSpread = Math.max(...left) - Math.min(...left);
  const rightSpread = Math.max(...right) - Math.min(...right);
  if (leftSpread !== rightSpread) {
    return leftSpread - rightSpread;
  }

  if (left[0] !== right[0]) {
    return right[0] - left[0];
  }

  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    if (leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }

  return 0;
}

function snapDurationUp(totalSeconds: number) {
  const option = TOTAL_DURATION_OPTIONS.find((duration) => duration >= totalSeconds);
  return option ?? maxSupportedDuration;
}

function extractExplicitDurationSeconds(roughIdea: string) {
  const match = roughIdea.match(/\b(\d{1,3})(?:\s*|-)?(?:sec(?:ond)?s?|s)\b/i);
  if (!match) {
    return null;
  }

  const seconds = Number.parseInt(match[1], 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return seconds;
}

function estimateNarrationSeconds(
  roughIdea: string,
  style: GenerateVideoRequest["style"],
) {
  const words = roughIdea.match(/\b[\p{L}\p{N}'-]+\b/gu) ?? [];
  if (words.length === 0) {
    return 0;
  }

  const speakingRates = {
    cinematic: 2.35,
    "raw-gritty": 2.5,
    uplifting: 2.7,
    luxury: 2.2,
    documentary: 2.15,
    "ad-promo": 2.9,
  } as const;

  return words.length / speakingRates[style];
}

function estimateVisualSeconds(
  roughIdea: string,
  platformPreset: GenerateVideoRequest["platformPreset"],
  style: GenerateVideoRequest["style"],
) {
  const lowerIdea = roughIdea.toLowerCase();
  const sentenceBreaks = roughIdea
    .split(/[.!?\n]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;
  const clauseBreaks = (roughIdea.match(/[,;:]+/g) ?? []).length;
  const transitionCues = countMatches(
    lowerIdea,
    /\b(then|into|from|through|reveal|show|shift|transition|build|logo|brand|cta|call to action)\b/g,
  );
  const conceptCues = countMatches(
    lowerIdea,
    /\b(3d|ai|visuals?|animation|scene|sequence|product|dashboard|bottleneck|workflow|sunrise|darkness|hero)\b/g,
  );

  const beatCount = Math.min(
    7,
    1 + sentenceBreaks + Math.min(clauseBreaks, 2) + Math.min(transitionCues, 2) + Math.min(conceptCues, 2),
  );

  const platformBeatDuration =
    platformPreset === "youtube-horizontal"
      ? 3.6
      : platformPreset === "custom"
        ? 3.4
        : 3.1;
  const styleAdjustment =
    style === "documentary" || style === "cinematic" || style === "luxury"
      ? 0.35
      : style === "ad-promo" || style === "uplifting"
        ? -0.2
        : 0;

  return Math.max(4, beatCount * (platformBeatDuration + styleAdjustment));
}

function shouldAddBrandHold(roughIdea: string) {
  return /\b(logo|brand|company|title card|lockup|cta|call to action|name is|named)\b/i.test(roughIdea);
}

function buildReasonSummary(args: {
  roughIdea: string;
  narrationSeconds: number;
  visualSeconds: number;
  platformPreset: GenerateVideoRequest["platformPreset"];
  explicitDurationSeconds: number | null;
  brandHoldSeconds: number;
}) {
  const reasons = [];

  if (args.explicitDurationSeconds) {
    reasons.push(`Detected an explicit ${formatSeconds(args.explicitDurationSeconds)} timing cue in the brief.`);
  } else if (args.narrationSeconds > 0) {
    reasons.push(`Estimated ${formatSeconds(args.narrationSeconds)} for spoken or narrated content pacing.`);
  }

  reasons.push(`Estimated ${formatSeconds(args.visualSeconds)} for visual beats and camera transitions.`);

  if (args.platformPreset === "tiktok-reels-shorts") {
    reasons.push("Kept the pacing tight for vertical short-form viewing.");
  } else if (args.platformPreset === "youtube-horizontal") {
    reasons.push("Allowed a little more breathing room for widescreen storytelling.");
  }

  if (args.brandHoldSeconds > 0) {
    reasons.push(`Added ${args.brandHoldSeconds}s so the brand or hero image can land without a hard cutoff.`);
  }

  reasons.push(
    `Always added ${SMART_DURATION_OPENING_BUFFER_SECONDS}s at the front and ${SMART_DURATION_ENDING_BUFFER_SECONDS}s at the end for a cleaner intro/outro.`,
  );

  return reasons;
}

function countMatches(value: string, expression: RegExp) {
  return (value.match(expression) ?? []).length;
}

function roundToTenths(value: number) {
  return Math.round(value * 10) / 10;
}

function formatSeconds(value: number) {
  return `${roundToTenths(value)}s`;
}
