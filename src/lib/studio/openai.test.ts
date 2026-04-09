import { describe, expect, it } from "vitest";

import {
  buildPacingGuidanceLines,
  coercePromptPlanExtensionCount,
  createVideoInputReference,
  isDialogueLedBrief,
  toDataUrl,
} from "./openai";
import type { VideoPromptPlan } from "./types";

const basePlan: VideoPromptPlan = {
  title: "XenTeck Brand Film",
  masterPrompt: "Master prompt",
  initialPrompt: "Initial segment prompt",
  extensionPrompts: [
    "Extension prompt one",
    "Extension prompt two",
    "Extension prompt three",
  ],
  recommendedModel: "sora-2",
  recommendedSize: "720x1280",
  segmentPlan: [12, 16, 12],
  captionSuggestion: "Caption",
  avoidList: ["hard cut"],
};

describe("coercePromptPlanExtensionCount", () => {
  it("trims extra extension prompts down to the expected count", () => {
    const aligned = coercePromptPlanExtensionCount(basePlan, 2);

    expect(aligned.extensionPrompts).toEqual([
      "Extension prompt one",
      "Extension prompt two",
    ]);
  });

  it("pads missing extension prompts from the last available continuation", () => {
    const aligned = coercePromptPlanExtensionCount(
      {
        ...basePlan,
        extensionPrompts: ["Extension prompt one"],
      },
      2,
    );

    expect(aligned.extensionPrompts).toHaveLength(2);
    expect(aligned.extensionPrompts[1]).toContain("Continue directly from the final frame");
  });
});

describe("pacing guidance", () => {
  it("detects dialogue-led briefs and adds anti-dead-air guidance", () => {
    expect(
      isDialogueLedBrief(
        'A spokesperson speaks direct to camera and delivers this spoken script: "You paid for the lead."',
      ),
    ).toBe(true);

    const guidance = buildPacingGuidanceLines(
      'A spokesperson speaks direct to camera and delivers this spoken script: "You paid for the lead."',
      2,
    );

    expect(guidance.join(" ")).toContain("dialogue-led");
    expect(guidance.join(" ")).toContain("within about 1 second");
  });

  it("keeps atmospheric breathing room for non-dialogue briefs without allowing flatlines", () => {
    expect(
      isDialogueLedBrief("A cinematic montage of a car driving through rain into sunrise."),
    ).toBe(false);

    const guidance = buildPacingGuidanceLines(
      "A cinematic montage of a car driving through rain into sunrise.",
      1,
    );

    expect(guidance.join(" ")).toContain("visual storytelling");
    expect(guidance.join(" ")).toContain("flatline");
  });
});

describe("reference asset input conversion", () => {
  it("encodes raw bytes as a data URL", () => {
    expect(toDataUrl(Buffer.from("hello"), "image/png")).toBe("data:image/png;base64,aGVsbG8=");
  });

  it("returns an input_reference object with an image_url", async () => {
    const tempDirectory = `${process.cwd()}/.generated`;
    const tempPath = `${tempDirectory}/openai-test-reference.txt`;
    await import("node:fs/promises").then(async ({ mkdir, writeFile }) => {
      await mkdir(tempDirectory, { recursive: true });
      await writeFile(tempPath, "hello");
    });

    const inputReference = await createVideoInputReference(tempPath, "image/png");
    expect(inputReference.image_url).toBe("data:image/png;base64,aGVsbG8=");

    await import("node:fs/promises").then(({ unlink }) => unlink(tempPath));
  });
});
