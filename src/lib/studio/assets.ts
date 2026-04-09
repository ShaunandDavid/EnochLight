import crypto from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { getFormatDimensions } from "@/lib/studio/constants";
import {
  ensureStudioStorage,
  fileExists,
  getStudioAssetOriginalPath,
  getStudioAssetPreparedPath,
  readStudioReferenceAsset,
  writeStudioReferenceAsset,
} from "@/lib/studio/storage";
import type {
  StudioPreparedReferenceAsset,
  StudioReferenceAsset,
  StudioFormat,
} from "@/lib/studio/types";

const allowedReferenceMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxReferenceAssetBytes = 20 * 1024 * 1024;
const neutralCanvasBackground = { r: 11, g: 18, b: 32, alpha: 1 };

export async function saveStudioReferenceAsset(file: File): Promise<StudioReferenceAsset> {
  await ensureStudioStorage();

  if (!allowedReferenceMimeTypes.has(file.type)) {
    throw new Error("Reference assets must be PNG, JPEG, or WEBP images.");
  }

  if (file.size <= 0) {
    throw new Error("Reference asset upload is empty.");
  }

  if (file.size > maxReferenceAssetBytes) {
    throw new Error("Reference assets must be 20 MB or smaller.");
  }

  const input = Buffer.from(await file.arrayBuffer());
  const metadata = await sharp(input).rotate().metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read the uploaded image dimensions.");
  }

  const assetId = `asset_${crypto.randomUUID()}`;
  const extension = mimeTypeToExtension(file.type);
  const safeBaseName = slugify(path.parse(file.name).name) || "reference-asset";
  const fileName = `${assetId}-${safeBaseName}.${extension}`;
  const localPath = getStudioAssetOriginalPath(fileName);

  await writeFile(localPath, input);

  const asset: StudioReferenceAsset = {
    id: assetId,
    createdAt: new Date().toISOString(),
    originalFileName: file.name,
    mimeType: file.type,
    bytes: input.byteLength,
    width: metadata.width,
    height: metadata.height,
    localPath,
    previewUrl: `/api/studio/assets/${assetId}`,
  };

  await writeStudioReferenceAsset(asset);
  return asset;
}

export async function getStudioReferenceAsset(assetId: string) {
  return readStudioReferenceAsset(assetId);
}

export async function prepareStudioReferenceAsset(args: {
  assetId: string;
  format: StudioFormat;
}): Promise<StudioPreparedReferenceAsset> {
  await ensureStudioStorage();

  const asset = await readStudioReferenceAsset(args.assetId);
  if (!asset) {
    throw new Error("Reference asset not found.");
  }

  const preparedPath = getStudioAssetPreparedPath(asset.id, args.format);
  const { width, height } = getFormatDimensions(args.format);

  if (!(await fileExists(preparedPath))) {
    const resized = await sharp(asset.localPath)
      .rotate()
      .resize({
        width,
        height,
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const composed = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: neutralCanvasBackground,
      },
    })
      .composite([{ input: resized, gravity: "center" }])
      .png()
      .toBuffer();

    await writeFile(preparedPath, composed);
  }

  return {
    assetId: asset.id,
    format: args.format,
    width,
    height,
    mimeType: "image/png",
    localPath: preparedPath,
    previewUrl: `/api/studio/assets/${asset.id}?format=${args.format}`,
  };
}

function mimeTypeToExtension(mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    case "image/webp":
      return "webp";
    default:
      throw new Error(`Unsupported reference asset type: ${mimeType}`);
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
