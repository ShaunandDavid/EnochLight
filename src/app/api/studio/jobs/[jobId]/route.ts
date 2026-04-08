import { getStudioJob } from "@/lib/studio/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getStudioJob(jobId);

  if (!job) {
    return Response.json(
      { ok: false, error: "Job not found." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  return Response.json({ ok: true, job }, { headers: noStoreHeaders() });
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}
