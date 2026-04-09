import { describe, expect, it } from "vitest";

import {
  getFormatOptionLabel,
  getSupportedFormatsForModel,
} from "./constants";
import { generateVideoRequestSchema } from "./types";

const baseRequest = {
  roughIdea: "A calm sunrise walk for a short-form recovery story",
  platformPreset: "tiktok-reels-shorts" as const,
  totalDuration: 16,
  style: "cinematic" as const,
  avoid: "",
};

describe("generateVideoRequestSchema", () => {
  it("defaults durationMode to manual for server compatibility", () => {
    const parsed = generateVideoRequestSchema.parse({
      ...baseRequest,
      format: "720x1280",
      model: "sora-2",
    });

    expect(parsed.durationMode).toBe("manual");
  });

  it("defaults plannerMode to the standard GPT-5 mini planner", () => {
    const parsed = generateVideoRequestSchema.parse({
      ...baseRequest,
      format: "720x1280",
      model: "sora-2",
    });

    expect(parsed.plannerMode).toBe("standard");
  });

  it("rejects higher-resolution formats for sora-2", () => {
    expect(() =>
      generateVideoRequestSchema.parse({
        ...baseRequest,
        format: "1024x1792",
        model: "sora-2",
      }),
    ).toThrow(/does not support/);
  });

  it("accepts an optional uploaded reference asset id", () => {
    const parsed = generateVideoRequestSchema.parse({
      ...baseRequest,
      format: "720x1280",
      model: "sora-2",
      referenceAssetId: "asset_123",
    });

    expect(parsed.referenceAssetId).toBe("asset_123");
  });
});

describe("format labels", () => {
  it("shows only 720p formats for sora-2", () => {
    expect(getSupportedFormatsForModel("sora-2")).toEqual(["720x1280", "1280x720"]);
  });

  it("uses friendly labels before raw render sizes", () => {
    expect(getFormatOptionLabel("720x1280", "sora-2")).toBe(
      "9:16 (phone) - renders at 720x1280",
    );
    expect(getFormatOptionLabel("1792x1024", "sora-2-pro")).toBe(
      "16:9 (widescreen, Full HD) - renders at 1792x1024",
    );
  });
});
