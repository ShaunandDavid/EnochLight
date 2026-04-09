import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { prepareStudioReferenceAsset, getStudioReferenceAsset } from "@/lib/studio/assets";
import { formatSchema } from "@/lib/studio/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  const { assetId } = await context.params;
  const url = new URL(request.url);
  const requestedFormat = url.searchParams.get("format");

  if (requestedFormat) {
    const parsedFormat = formatSchema.safeParse(requestedFormat);
    if (!parsedFormat.success) {
      return Response.json(
        { ok: false, error: "Unsupported reference asset format preview." },
        { status: 400, headers: noStoreHeaders() },
      );
    }

    try {
      const prepared = await prepareStudioReferenceAsset({
        assetId,
        format: parsedFormat.data,
      });

      return new Response(Readable.toWeb(createReadStream(prepared.localPath)) as ReadableStream, {
        status: 200,
        headers: imageHeaders(prepared.mimeType),
      });
    } catch (error) {
      return Response.json(
        {
          ok: false,
          error: error instanceof Error ? error.message : "Failed to prepare the reference asset.",
        },
        { status: 404, headers: noStoreHeaders() },
      );
    }
  }

  const asset = await getStudioReferenceAsset(assetId);
  if (!asset) {
    return Response.json(
      { ok: false, error: "Reference asset not found." },
      { status: 404, headers: noStoreHeaders() },
    );
  }

  return new Response(Readable.toWeb(createReadStream(asset.localPath)) as ReadableStream, {
    status: 200,
    headers: imageHeaders(asset.mimeType),
  });
}

function imageHeaders(contentType: string) {
  return new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": contentType,
  });
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, max-age=0",
  };
}
