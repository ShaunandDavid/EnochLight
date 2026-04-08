import { describe, expect, it } from "vitest";

import { coercePromptPlanExtensionCount } from "./openai";
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
