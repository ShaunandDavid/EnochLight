import { getStudioReferenceAsset } from "@/lib/studio/assets";
import { resolveStudioDuration } from "@/lib/studio/duration-plan";
import { planVideoPrompts } from "@/lib/studio/openai";
import { generateVideoRequestSchema } from "@/lib/studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = generateVideoRequestSchema.parse(await request.json());
    const referenceAsset = payload.referenceAssetId
      ? await getStudioReferenceAsset(payload.referenceAssetId)
      : null;

    if (payload.referenceAssetId && !referenceAsset) {
      throw new Error("The selected reference asset is no longer available. Upload it again.");
    }

    const durationResolution = resolveStudioDuration(payload);
    const plan = await planVideoPrompts({
      roughIdea: payload.roughIdea,
      platformPreset: payload.platformPreset,
      format: payload.format,
      totalDuration: durationResolution.totalDuration,
      executionPlan: durationResolution.segmentPlan.segments,
      style: payload.style,
      plannerMode: payload.plannerMode,
      avoidList: payload.avoid
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
      selectedModel: payload.model,
      referenceAsset: referenceAsset ?? undefined,
    });

    return Response.json(
      { ok: true, plan, durationRecommendation: durationResolution.recommendation },
      { headers: noStoreHeaders() },
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to build the prompt plan.",
      },
      { status: 400, headers: noStoreHeaders() },
    );
  }
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}
