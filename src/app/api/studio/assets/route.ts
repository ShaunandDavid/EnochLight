import { saveStudioReferenceAsset } from "@/lib/studio/assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      throw new Error("Attach one PNG, JPEG, or WEBP image as the reference asset.");
    }

    const asset = await saveStudioReferenceAsset(file);
    return Response.json({ ok: true, asset }, { status: 201, headers: noStoreHeaders() });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Failed to upload the reference asset.",
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
