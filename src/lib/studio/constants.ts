export const APP_TITLE = "Sora Social Video Studio";

export const VIDEO_MODELS = ["sora-2", "sora-2-pro"] as const;
export const PLANNER_MODE_IDS = ["standard", "premium"] as const;
export const DEFAULT_PLANNER_MODE = "standard";
export const DURATION_MODE_IDS = ["manual", "smart"] as const;
export const DEFAULT_DURATION_MODE = "manual";
export const PLATFORM_PRESET_IDS = [
  "tiktok-reels-shorts",
  "youtube-horizontal",
  "custom",
] as const;
export const STYLE_PRESET_IDS = [
  "cinematic",
  "raw-gritty",
  "uplifting",
  "luxury",
  "documentary",
  "ad-promo",
] as const;
export const FORMAT_IDS = [
  "1024x1792",
  "1792x1024",
  "720x1280",
  "1280x720",
] as const;
export const INITIAL_SEGMENT_SECONDS = [4, 8, 12] as const;
export const EXTENSION_SEGMENT_SECONDS = [4, 8, 12, 16, 20] as const;
export const TOTAL_DURATION_OPTIONS = [8, 12, 16, 20, 24, 32, 40, 60] as const;
export const SMART_DURATION_OPENING_BUFFER_SECONDS = 2;
export const SMART_DURATION_ENDING_BUFFER_SECONDS = 2;
export const SMART_DURATION_BRAND_HOLD_SECONDS = 2;

export const DURATION_MODE_OPTIONS = {
  manual: {
    id: "manual",
    label: "Manual duration",
    description: "Pick the exact target length yourself.",
  },
  smart: {
    id: "smart",
    label: "Smart snap (recommended)",
    description:
      "Estimates the content length, adds opening and ending buffer, then snaps up to a supported duration.",
  },
} as const;

export const PLANNER_OPTIONS = {
  standard: {
    id: "standard",
    label: "Standard planner (recommended, cheaper)",
    description: "Uses GPT-5 mini for faster, lower-cost structured prompt planning.",
    model: "gpt-5-mini",
    reasoningEffort: "low",
  },
  premium: {
    id: "premium",
    label: "Premium planner",
    description: "Uses GPT-5.4 when you want a heavier creative planning pass.",
    model: "gpt-5.4",
    reasoningEffort: "low",
  },
} as const;

export const PLATFORM_PRESETS = {
  "tiktok-reels-shorts": {
    id: "tiktok-reels-shorts",
    label: "TikTok / Reels / Shorts",
    description: "Vertical-first short-form social output.",
    defaultAspect: "vertical",
  },
  "youtube-horizontal": {
    id: "youtube-horizontal",
    label: "YouTube horizontal",
    description: "Landscape storytelling for YouTube and widescreen feeds.",
    defaultAspect: "horizontal",
  },
  custom: {
    id: "custom",
    label: "Custom",
    description: "Keep the current format and tune the brief manually.",
    defaultAspect: null,
  },
} as const;

export const STYLE_PRESETS = {
  cinematic: {
    id: "cinematic",
    label: "cinematic",
    description: "Polished framing, motivated lighting, and premium motion.",
  },
  "raw-gritty": {
    id: "raw-gritty",
    label: "raw / gritty",
    description: "Rough texture, imperfect beauty, and tactile realism.",
  },
  uplifting: {
    id: "uplifting",
    label: "uplifting",
    description: "Optimistic movement, brighter energy, and emotional lift.",
  },
  luxury: {
    id: "luxury",
    label: "luxury",
    description: "Controlled elegance, rich materials, and aspirational tone.",
  },
  documentary: {
    id: "documentary",
    label: "documentary",
    description: "Observational camera language and grounded authenticity.",
  },
  "ad-promo": {
    id: "ad-promo",
    label: "ad / promo",
    description: "Clear product-style intention with sharp commercial pacing.",
  },
} as const;

export const FORMAT_OPTIONS = {
  "1024x1792": {
    id: "1024x1792",
    label: "9:16 phone framing with higher resolution",
    shortLabel: "9:16 phone Full HD",
    aspect: "vertical",
    optionLabels: {
      "sora-2-pro": "9:16 (phone, Full HD) - renders at 1024x1792",
    },
    note: "Renders at 1024x1792, the closest Sora-supported vertical size to Full HD.",
  },
  "1792x1024": {
    id: "1792x1024",
    label: "16:9 widescreen framing with higher resolution",
    shortLabel: "16:9 widescreen Full HD",
    aspect: "horizontal",
    optionLabels: {
      "sora-2-pro": "16:9 (widescreen, Full HD) - renders at 1792x1024",
    },
    note: "Renders at 1792x1024, the closest Sora-supported widescreen size to Full HD.",
  },
  "720x1280": {
    id: "720x1280",
    label: "9:16 phone framing",
    shortLabel: "9:16 phone",
    aspect: "vertical",
    optionLabels: {
      "sora-2": "9:16 (phone) - renders at 720x1280",
      "sora-2-pro": "9:16 (phone, HD) - renders at 720x1280",
    },
    note: "Renders at 720x1280.",
  },
  "1280x720": {
    id: "1280x720",
    label: "16:9 widescreen framing",
    shortLabel: "16:9 widescreen",
    aspect: "horizontal",
    optionLabels: {
      "sora-2": "16:9 (widescreen) - renders at 1280x720",
      "sora-2-pro": "16:9 (widescreen, HD) - renders at 1280x720",
    },
    note: "Renders at 1280x720.",
  },
} as const;

export const SUPPORTED_FORMATS_BY_MODEL = {
  "sora-2": ["720x1280", "1280x720"],
  "sora-2-pro": ["720x1280", "1280x720", "1024x1792", "1792x1024"],
} as const;

const DEFAULT_FORMAT_BY_ASPECT = {
  vertical: {
    "sora-2": "720x1280",
    "sora-2-pro": "1024x1792",
  },
  horizontal: {
    "sora-2": "1280x720",
    "sora-2-pro": "1792x1024",
  },
} as const;

export function getSupportedFormatsForModel(model: (typeof VIDEO_MODELS)[number]) {
  return [...SUPPORTED_FORMATS_BY_MODEL[model]];
}

export function isFormatSupportedByModel(
  model: (typeof VIDEO_MODELS)[number],
  format: (typeof FORMAT_IDS)[number],
) {
  return getSupportedFormatsForModel(model).includes(format);
}

export function getDefaultFormatForAspect(
  aspect: "vertical" | "horizontal",
  model: (typeof VIDEO_MODELS)[number],
) {
  return DEFAULT_FORMAT_BY_ASPECT[aspect][model];
}

export function getCompatibleFormatForModel(
  format: (typeof FORMAT_IDS)[number],
  model: (typeof VIDEO_MODELS)[number],
) {
  if (isFormatSupportedByModel(model, format)) {
    return format;
  }

  return getDefaultFormatForAspect(FORMAT_OPTIONS[format].aspect, model);
}

export function getPreferredFormatForPlatform(
  platformPreset: (typeof PLATFORM_PRESET_IDS)[number],
  model: (typeof VIDEO_MODELS)[number],
  currentFormat?: (typeof FORMAT_IDS)[number],
) {
  if (platformPreset === "custom") {
    return currentFormat ? getCompatibleFormatForModel(currentFormat, model) : getDefaultFormatForAspect("vertical", model);
  }

  return getDefaultFormatForAspect(PLATFORM_PRESETS[platformPreset].defaultAspect, model);
}

export function getFormatOptionLabel(
  format: (typeof FORMAT_IDS)[number],
  model: (typeof VIDEO_MODELS)[number],
) {
  const label = FORMAT_OPTIONS[format].optionLabels[
    model as keyof typeof FORMAT_OPTIONS[typeof format]["optionLabels"]
  ];

  if (!label) {
    throw new Error(`No UI label is configured for ${format} with ${model}.`);
  }

  return label;
}

export function getFormatDimensions(format: (typeof FORMAT_IDS)[number]) {
  const [width, height] = format.split("x").map((value) => Number.parseInt(value, 10));

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Invalid format dimensions: ${format}`);
  }

  return { width, height };
}

export const JOB_PHASES = [
  "created",
  "planning",
  "creating_initial_video",
  "extending_video",
  "polling_segment",
  "downloading",
  "saving",
  "completed",
  "failed",
] as const;

export const JOB_STATUSES = ["queued", "in_progress", "completed", "failed"] as const;
export const SEGMENT_STATUSES = ["pending", "in_progress", "completed", "failed"] as const;

export const JOB_STATUS_POLL_INTERVAL_MS = 3_000;
export const OPENAI_VIDEO_POLL_INTERVAL_MS = 5_000;
export const OPENAI_VIDEO_POLL_TIMEOUT_MS = 30 * 60 * 1000;
