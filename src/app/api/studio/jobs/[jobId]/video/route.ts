import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { getStudioJob } from "@/lib/studio/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getStudioJob(jobId);

  if (!job?.finalAsset) {
    return Response.json(
      { ok: false, error: "Final video is not available yet." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  const fileStat = await stat(job.finalAsset.localPath);
  const range = request.headers.get("range");
  const download = new URL(request.url).searchParams.get("download") === "1";
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "video/mp4",
  });

  if (download) {
    headers.set(
      "Content-Disposition",
      `attachment; filename="${job.finalAsset.fileName}"`,
    );
  }

  if (!range) {
    headers.set("Content-Length", String(fileStat.size));
    const stream = createReadStream(job.finalAsset.localPath);
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 200,
      headers,
    });
  }

  const parsedRange = parseRange(range, fileStat.size);
  if (!parsedRange) {
    headers.set("Content-Range", `bytes */${fileStat.size}`);
    return new Response("Requested range is invalid.", { status: 416, headers });
  }

  const { start, end } = parsedRange;
  headers.set("Content-Length", String(end - start + 1));
  headers.set("Content-Range", `bytes ${start}-${end}/${fileStat.size}`);

  const stream = createReadStream(job.finalAsset.localPath, { start, end });
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 206,
    headers,
  });
}

function parseRange(rangeHeader: string, totalSize: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
  if (!match) {
    return null;
  }

  const start = match[1] ? Number.parseInt(match[1], 10) : 0;
  const end = match[2] ? Number.parseInt(match[2], 10) : totalSize - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || end >= totalSize) {
    return null;
  }

  return { start, end };
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}
