import { retryStudioJob } from "@/lib/studio/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const job = await retryStudioJob(jobId);
    return Response.json({ ok: true, job }, { headers: noStoreHeaders() });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to retry the job.",
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
