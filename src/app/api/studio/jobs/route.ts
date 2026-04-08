import { createStudioJob, getStudioJobSummaries } from "@/lib/studio/jobs";
import { generateVideoRequestSchema } from "@/lib/studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const jobs = await getStudioJobSummaries();
  return Response.json({ ok: true, jobs }, { headers: noStoreHeaders() });
}

export async function POST(request: Request) {
  try {
    const payload = generateVideoRequestSchema.parse(await request.json());
    const job = await createStudioJob(payload);
    return Response.json({ ok: true, job }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to create the studio job.",
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
