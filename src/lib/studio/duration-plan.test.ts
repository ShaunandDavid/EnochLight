import { describe, expect, it } from "vitest";

import { buildSegmentPlan, recommendSmartDuration, resolveStudioDuration } from "./duration-plan";

describe("buildSegmentPlan", () => {
  it("uses a valid two-segment plan for 16 seconds", () => {
    const plan = buildSegmentPlan(16).segments;
    expect(plan).toHaveLength(2);
    expect(plan.reduce((sum, value) => sum + value, 0)).toBe(16);
    expect(plan[0]).toBeLessThanOrEqual(12);
  });

  it("prefers balanced multi-segment plans for 24 seconds", () => {
    expect(buildSegmentPlan(24).segments).toEqual([12, 12]);
  });

  it("builds a three-segment plan for 40 seconds with a supported opening clip", () => {
    const plan = buildSegmentPlan(40).segments;
    expect(plan).toHaveLength(3);
    expect(plan.reduce((sum, value) => sum + value, 0)).toBe(40);
    expect(plan[0]).toBeLessThanOrEqual(12);
  });
});

describe("smart duration recommendation", () => {
  it("snaps branded shorts upward to leave a clean finish", () => {
    const recommendation = recommendSmartDuration({
      roughIdea:
        "Hi, my company's name is XENTECK. We help businesses fix bottlenecks with AI. Show the X logo reveal, 3D AI visuals, and a final brand lockup.",
      platformPreset: "tiktok-reels-shorts",
      style: "ad-promo",
      requestedDuration: 16,
    });

    expect(recommendation.resolvedDuration).toBeGreaterThanOrEqual(16);
    expect(recommendation.brandHoldSeconds).toBeGreaterThan(0);
    expect(recommendation.summary).toContain("snapped up");
  });

  it("resolves smart duration through the same server-side utility used by jobs", () => {
    const resolved = resolveStudioDuration({
      roughIdea: "Show a short, polished product reveal with a clean logo outro.",
      platformPreset: "tiktok-reels-shorts",
      style: "cinematic",
      totalDuration: 12,
      durationMode: "smart",
    });

    expect(resolved.totalDuration).toBe(resolved.recommendation.resolvedDuration);
    expect(resolved.segmentPlan.segments).toEqual(resolved.recommendation.executionPlan);
  });
});
