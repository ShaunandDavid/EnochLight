import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  studioJobSchema,
  studioReferenceAssetSchema,
  type StudioJob,
  type StudioReferenceAsset,
} from "@/lib/studio/types";

const storageRoot = path.join(process.cwd(), ".generated", "sora-social");
const jobsDirectory = path.join(storageRoot, "jobs");
const videosDirectory = path.join(storageRoot, "videos");
const assetsDirectory = path.join(storageRoot, "assets");
const assetRecordsDirectory = path.join(assetsDirectory, "records");
const assetOriginalsDirectory = path.join(assetsDirectory, "originals");
const assetPreparedDirectory = path.join(assetsDirectory, "prepared");

export async function ensureStudioStorage(): Promise<void> {
  await Promise.all([
    mkdir(storageRoot, { recursive: true }),
    mkdir(jobsDirectory, { recursive: true }),
    mkdir(videosDirectory, { recursive: true }),
    mkdir(assetsDirectory, { recursive: true }),
    mkdir(assetRecordsDirectory, { recursive: true }),
    mkdir(assetOriginalsDirectory, { recursive: true }),
    mkdir(assetPreparedDirectory, { recursive: true }),
  ]);
}

export function getStudioJobPath(jobId: string): string {
  return path.join(jobsDirectory, `${jobId}.json`);
}

export function getStudioVideoPath(fileName: string): string {
  return path.join(videosDirectory, fileName);
}

export function getStudioAssetRecordPath(assetId: string): string {
  return path.join(assetRecordsDirectory, `${assetId}.json`);
}

export function getStudioAssetOriginalPath(fileName: string): string {
  return path.join(assetOriginalsDirectory, fileName);
}

export function getStudioAssetPreparedPath(assetId: string, format: string): string {
  return path.join(assetPreparedDirectory, `${assetId}-${format}.png`);
}

export async function readStudioJob(jobId: string): Promise<StudioJob | null> {
  await ensureStudioStorage();

  try {
    const file = await readFile(getStudioJobPath(jobId), "utf8");
    return studioJobSchema.parse(JSON.parse(file));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeStudioJob(job: StudioJob): Promise<StudioJob> {
  await ensureStudioStorage();
  await writeFile(getStudioJobPath(job.id), JSON.stringify(job, null, 2), "utf8");
  return job;
}

export async function readStudioReferenceAsset(assetId: string): Promise<StudioReferenceAsset | null> {
  await ensureStudioStorage();

  try {
    const file = await readFile(getStudioAssetRecordPath(assetId), "utf8");
    return studioReferenceAssetSchema.parse(JSON.parse(file));
  } catch (error) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

export async function writeStudioReferenceAsset(asset: StudioReferenceAsset) {
  await ensureStudioStorage();
  await writeFile(getStudioAssetRecordPath(asset.id), JSON.stringify(asset, null, 2), "utf8");
  return asset;
}

export async function listStudioJobs(limit = 12): Promise<StudioJob[]> {
  await ensureStudioStorage();
  const entries = await readdir(jobsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(jobsDirectory, entry.name));

  const jobs = await Promise.all(
    files.map(async (filePath) => {
      const raw = await readFile(filePath, "utf8");
      return studioJobSchema.parse(JSON.parse(raw));
    }),
  );

  return jobs
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) {
      return false;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
