"use client";

import Image from "next/image";
import {
  useRef,
  startTransition,
  useCallback,
  useEffect,
  useState,
} from "react";

import {
  DURATION_MODE_IDS,
  DURATION_MODE_OPTIONS,
  FORMAT_OPTIONS,
  getCompatibleFormatForModel,
  getFormatOptionLabel,
  getPreferredFormatForPlatform,
  getSupportedFormatsForModel,
  JOB_STATUS_POLL_INTERVAL_MS,
  PLANNER_MODE_IDS,
  PLANNER_OPTIONS,
  PLATFORM_PRESET_IDS,
  PLATFORM_PRESETS,
  STYLE_PRESET_IDS,
  STYLE_PRESETS,
  TOTAL_DURATION_OPTIONS,
  VIDEO_MODELS,
} from "@/lib/studio/constants";
import { recommendSmartDuration } from "@/lib/studio/duration-plan";
import type {
  GenerateVideoRequest,
  StudioJob,
  StudioJobSummary,
  StudioReferenceAsset,
} from "@/lib/studio/types";
import styles from "./studio-page.module.css";

const draftStorageKey = "sora-social-studio:draft";

const defaultFormState: GenerateVideoRequest = {
  roughIdea: "",
  platformPreset: "tiktok-reels-shorts",
  format: "720x1280",
  totalDuration: 16,
  model: "sora-2",
  durationMode: "smart",
  plannerMode: "standard",
  style: "cinematic",
  avoid: "",
};

interface StudioPageProps {
  initialJobs: StudioJobSummary[];
  hasApiKey: boolean;
}

interface StudioDraft {
  formState?: Partial<GenerateVideoRequest>;
  manualDuration?: number;
  referenceAsset?: StudioReferenceAsset | null;
}

type FilePickerWindow = Window &
  typeof globalThis & {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
      excludeAcceptAllOption?: boolean;
    }) => Promise<Array<{ getFile(): Promise<File> }>>;
  };

export default function StudioPage({
  initialJobs,
  hasApiKey,
}: StudioPageProps) {
  const [formState, setFormState] = useState<GenerateVideoRequest>(defaultFormState);
  const [manualDuration, setManualDuration] = useState(defaultFormState.totalDuration);
  const [referenceAsset, setReferenceAsset] = useState<StudioReferenceAsset | null>(null);
  const [recentJobs, setRecentJobs] = useState<StudioJobSummary[]>(initialJobs);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(
    initialJobs[0]?.id ?? null,
  );
  const [selectedJob, setSelectedJob] = useState<StudioJob | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isUploadingAsset, setIsUploadingAsset] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const referenceAssetInputRef = useRef<HTMLInputElement | null>(null);

  const refreshRecentJobs = useCallback(async () => {
    try {
      const response = await fetch("/api/studio/jobs", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to load recent jobs.");
      }

      startTransition(() => {
        setRecentJobs(payload.jobs);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load recent jobs.");
    }
  }, []);

  const loadJobDetails = useCallback(async (jobId: string) => {
    try {
      const response = await fetch(`/api/studio/jobs/${jobId}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to load the job details.");
      }

      startTransition(() => {
        setSelectedJob(payload.job);
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load the job.");
    }
  }, []);

  useEffect(() => {
    try {
      const rawDraft = window.localStorage.getItem(draftStorageKey);
      if (!rawDraft) {
        return;
      }

      const parsedDraft = JSON.parse(rawDraft) as StudioDraft | Partial<GenerateVideoRequest>;
      const draftWrapper = isStudioDraft(parsedDraft) ? parsedDraft : null;
      const nextFormState: Partial<GenerateVideoRequest> =
        draftWrapper?.formState ?? (parsedDraft as Partial<GenerateVideoRequest>);

      if (typeof draftWrapper?.manualDuration === "number") {
        setManualDuration(normalizeDurationOption(draftWrapper.manualDuration));
      } else if (typeof nextFormState.totalDuration === "number") {
        setManualDuration(normalizeDurationOption(nextFormState.totalDuration));
      }
      if (draftWrapper) {
        setReferenceAsset(draftWrapper.referenceAsset ?? null);
      }
      setFormState(normalizeFormState(nextFormState));
    } catch {
      // Ignore malformed drafts and keep the UI usable.
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(
      draftStorageKey,
      JSON.stringify({
        formState,
        manualDuration,
        referenceAsset,
      } satisfies StudioDraft),
    );
  }, [formState, manualDuration, referenceAsset]);

  useEffect(() => {
    void refreshRecentJobs();
  }, [refreshRecentJobs]);

  useEffect(() => {
    if (!selectedJobId) {
      return;
    }

    if (!selectedJob || selectedJob.id !== selectedJobId) {
      void loadJobDetails(selectedJobId);
    }
  }, [loadJobDetails, selectedJob, selectedJobId]);

  useEffect(() => {
    if (!selectedJobId || !selectedJob || !isJobActive(selectedJob.status)) {
      return;
    }

    let cancelled = false;
    const tick = async () => {
      try {
        const response = await fetch(`/api/studio/jobs/${selectedJobId}`, {
          cache: "no-store",
        });
        const payload = await response.json();
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Failed to poll the active job.");
        }

        if (cancelled) {
          return;
        }

        startTransition(() => {
          setSelectedJob(payload.job);
          setRecentJobs((current) => upsertJobSummary(current, summarizeJob(payload.job)));
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "Failed to poll the job.");
        }
      }
    };

    void tick();
    const intervalId = window.setInterval(() => {
      void tick();
    }, JOB_STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedJob, selectedJobId]);

  async function handleGenerate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/studio/jobs", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...formState,
          totalDuration: effectiveDuration,
        }),
      });

      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to create the studio job.");
      }

      startTransition(() => {
        setSelectedJob(payload.job);
        setSelectedJobId(payload.job.id);
        setRecentJobs((current) => upsertJobSummary(current, summarizeJob(payload.job)));
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create the job.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleRetry(jobId: string) {
    setErrorMessage(null);

    try {
      const response = await fetch(`/api/studio/jobs/${jobId}/retry`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to retry the job.");
      }

      startTransition(() => {
        setSelectedJob(payload.job);
        setSelectedJobId(payload.job.id);
        setRecentJobs((current) => upsertJobSummary(current, summarizeJob(payload.job)));
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to retry the job.");
    }
  }

  async function handleReferenceAssetUpload(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    await uploadReferenceAssetFile(file);
  }

  async function uploadReferenceAssetFile(file: File) {
    setErrorMessage(null);
    setIsUploadingAsset(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/studio/assets", {
        method: "POST",
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Failed to upload the reference asset.");
      }

      startTransition(() => {
        setReferenceAsset(payload.asset);
        setFormState((current) => ({
          ...current,
          referenceAssetId: payload.asset.id,
        }));
      });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to upload the reference asset.",
      );
    } finally {
      setIsUploadingAsset(false);
    }
  }

  async function openReferenceAssetPicker() {
    if (isUploadingAsset || isAnyJobRunning || isSubmitting) {
      return;
    }

    const pickerWindow = window as FilePickerWindow;
    if (pickerWindow.showOpenFilePicker) {
      try {
        const [handle] = await pickerWindow.showOpenFilePicker({
          multiple: false,
          excludeAcceptAllOption: true,
          types: [
            {
              description: "Reference images",
              accept: {
                "image/png": [".png"],
                "image/jpeg": [".jpg", ".jpeg"],
                "image/webp": [".webp"],
              },
            },
          ],
        });

        if (!handle) {
          return;
        }

        const file = await handle.getFile();
        await uploadReferenceAssetFile(file);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        // Fall back to the hidden input if the picker API is unavailable or blocked.
      }
    }

    referenceAssetInputRef.current?.click();
  }

  function clearReferenceAssetSelection() {
    setReferenceAsset(null);
    setFormState((current) => ({
      ...current,
      referenceAssetId: undefined,
    }));
  }

  function handlePlatformChange(nextPlatform: GenerateVideoRequest["platformPreset"]) {
    setFormState((current) => ({
      ...current,
      platformPreset: nextPlatform,
      format: getPreferredFormatForPlatform(nextPlatform, current.model, current.format),
    }));
  }

  function handleModelChange(nextModel: GenerateVideoRequest["model"]) {
    setFormState((current) => ({
      ...current,
      model: nextModel,
      format:
        current.platformPreset === "custom"
          ? getCompatibleFormatForModel(current.format, nextModel)
          : getPreferredFormatForPlatform(current.platformPreset, nextModel, current.format),
    }));
  }

  function handleDurationModeChange(nextMode: GenerateVideoRequest["durationMode"]) {
    setFormState((current) => ({
      ...current,
      durationMode: nextMode,
      totalDuration: nextMode === "manual" ? manualDuration : current.totalDuration,
    }));
  }

  const currentFormat = FORMAT_OPTIONS[formState.format];
  const currentPlanner = PLANNER_OPTIONS[formState.plannerMode];
  const availableFormats = getSupportedFormatsForModel(formState.model);
  const smartDurationRecommendation =
    formState.durationMode === "smart"
      ? recommendSmartDuration({
          roughIdea: formState.roughIdea,
          platformPreset: formState.platformPreset,
          style: formState.style,
          requestedDuration: manualDuration,
        })
      : null;
  const effectiveDuration = smartDurationRecommendation?.resolvedDuration ?? formState.totalDuration;
  const durationSummary =
    formState.durationMode === "smart"
      ? smartDurationRecommendation?.summary ??
        "Smart snap will estimate the content, add buffer, and snap up to a supported duration."
      : "Manual duration override is active.";
  const isAnyJobRunning =
    recentJobs.some((job) => isJobActive(job.status)) ||
    Boolean(selectedJob && isJobActive(selectedJob.status));
  const canGenerate = hasApiKey && !isSubmitting && !isUploadingAsset && !isAnyJobRunning;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}>Continuous Sora generation for social storytelling</p>
          <h1>Sora Social Video Studio</h1>
          <p className={styles.lead}>
            Start with a rough idea, let the standard GPT-5 mini planner or premium
            GPT-5.4 planner turn it into a stronger creative plan, then generate one
            continuous Sora video by extending the same clip forward instead of
            stitching unrelated shots.
          </p>
        </div>
        <div className={styles.heroMeta}>
          <div className={styles.metaCard}>
            <span className={styles.metaLabel}>Planner</span>
            <strong>GPT-5 mini standard + GPT-5.4 premium</strong>
          </div>
          <div className={styles.metaCard}>
            <span className={styles.metaLabel}>Renderer</span>
            <strong>Sora initial + extension chain</strong>
          </div>
          <div className={styles.metaCard}>
            <span className={styles.metaLabel}>Persistence</span>
            <strong>Local JSON + saved MP4 files</strong>
          </div>
        </div>
      </section>

      {!hasApiKey ? (
        <section className={styles.bannerWarning}>
          <strong>OPENAI_API_KEY is missing.</strong>
          <span>
            Add it to your environment before generating. The UI is ready, but
            generation routes will fail until the key is present.
          </span>
        </section>
      ) : null}

      {errorMessage ? (
        <section className={styles.bannerError}>
          <strong>Error</strong>
          <span>{errorMessage}</span>
        </section>
      ) : null}

      <div className={styles.mainGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionKicker}>New job</p>
              <h2>Build a continuous video</h2>
            </div>
            <span className={styles.badge}>
              {isAnyJobRunning ? "Generation in progress" : "Ready"}
            </span>
          </div>

          <form className={styles.form} onSubmit={handleGenerate}>
            <label className={styles.field}>
              <span>Rough Idea</span>
              <textarea
                required
                aria-describedby="rough-idea-help"
                value={formState.roughIdea}
                onChange={(event) => {
                  const roughIdea = event.currentTarget.value;
                  setFormState((current) => ({
                    ...current,
                    roughIdea,
                  }));
                }}
                placeholder="Give me a gritty cinematic recovery video for TikTok about a man walking out of darkness into sunrise."
                rows={7}
              />
              <small id="rough-idea-help">
                Add a rough idea, then generate a continuous Sora plan and video chain.
              </small>
            </label>

            <div className={styles.referenceAssetPanel}>
              <div className={styles.referenceAssetHeader}>
                <div>
                  <span className={styles.referenceAssetTitle}>Reference asset (optional)</span>
                  <small>
                    Upload one PNG, JPEG, or WEBP logo or visual anchor. The server will fit it
                    onto the exact selected render canvas before the first Sora generation.
                  </small>
                </div>
                <div className={styles.uploadActionGroup}>
                  <input
                    ref={referenceAssetInputRef}
                    accept="image/png,image/jpeg,image/webp"
                    className={styles.hiddenFileInput}
                    disabled={isUploadingAsset || isAnyJobRunning || isSubmitting}
                    onChange={handleReferenceAssetUpload}
                    type="file"
                  />
                  <button
                    className={styles.uploadButton}
                    disabled={isUploadingAsset || isAnyJobRunning || isSubmitting}
                    onClick={() => {
                      void openReferenceAssetPicker();
                    }}
                    type="button"
                  >
                    {isUploadingAsset
                      ? "Uploading..."
                      : referenceAsset
                        ? "Replace asset"
                        : "Upload asset"}
                  </button>
                </div>
              </div>

              {referenceAsset ? (
                <div className={styles.referenceAssetCard}>
                  <Image
                    alt={`Reference asset ${referenceAsset.originalFileName}`}
                    className={styles.referenceAssetPreview}
                    src={referenceAsset.previewUrl}
                    unoptimized
                    width={84}
                    height={84}
                  />
                  <div className={styles.referenceAssetMeta}>
                    <strong>{referenceAsset.originalFileName}</strong>
                    <p>
                      Original asset: {referenceAsset.width}x{referenceAsset.height} •{" "}
                      {referenceAsset.mimeType.replace("image/", "").toUpperCase()}
                    </p>
                    <p>
                      Best for brand marks, product references, or a single visual identity anchor.
                      If the current video API rejects a specific image, the app will show the real
                      error instead of hiding it.
                    </p>
                  </div>
                  <button
                    className={styles.secondaryButton}
                    onClick={clearReferenceAssetSelection}
                    type="button"
                  >
                    Clear selection
                  </button>
                </div>
              ) : (
                <div className={styles.referenceAssetEmpty}>
                  No asset selected yet. If you have a square logo, that is fine. The app will
                  place it onto the chosen phone or widescreen canvas automatically.
                </div>
              )}
            </div>

            <div className={styles.fieldGrid}>
              <label className={styles.field}>
                <span>Platform preset</span>
                <select
                  value={formState.platformPreset}
                  onChange={(event) =>
                    handlePlatformChange(
                      event.currentTarget.value as GenerateVideoRequest["platformPreset"],
                    )
                  }
                >
                  {PLATFORM_PRESET_IDS.map((presetId) => (
                    <option key={presetId} value={presetId}>
                      {PLATFORM_PRESETS[presetId].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Aspect / format</span>
                <select
                  value={formState.format}
                  onChange={(event) => {
                    const format = event.currentTarget.value as GenerateVideoRequest["format"];
                    setFormState((current) => ({
                      ...current,
                      format,
                    }));
                  }}
                >
                  {availableFormats.map((formatId) => (
                    <option key={formatId} value={formatId}>
                      {getFormatOptionLabel(formatId, formState.model)}
                    </option>
                  ))}
                </select>
                <small>{currentFormat.note}</small>
              </label>

              <label className={styles.field}>
                <span>Duration mode</span>
                <select
                  value={formState.durationMode}
                  onChange={(event) =>
                    handleDurationModeChange(
                      event.currentTarget.value as GenerateVideoRequest["durationMode"],
                    )
                  }
                >
                  {DURATION_MODE_IDS.map((durationModeId) => (
                    <option key={durationModeId} value={durationModeId}>
                      {DURATION_MODE_OPTIONS[durationModeId].label}
                    </option>
                  ))}
                </select>
                <small>{DURATION_MODE_OPTIONS[formState.durationMode].description}</small>
              </label>

              <label className={styles.field}>
                <span>Total duration</span>
                <select
                  disabled={formState.durationMode === "smart"}
                  value={String(formState.durationMode === "smart" ? effectiveDuration : manualDuration)}
                  onChange={(event) => {
                    const totalDuration = normalizeDurationOption(
                      Number.parseInt(event.currentTarget.value, 10),
                    );
                    setManualDuration(totalDuration);
                    setFormState((current) => ({
                      ...current,
                      totalDuration,
                    }));
                  }}
                >
                  {TOTAL_DURATION_OPTIONS.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds} seconds
                    </option>
                  ))}
                </select>
                <small>{durationSummary}</small>
              </label>

              {smartDurationRecommendation ? (
                <div className={styles.recommendationPanel}>
                  <strong>
                    Smart snap recommends {smartDurationRecommendation.resolvedDuration}s
                  </strong>
                  <p>{smartDurationRecommendation.summary}</p>
                  <ul className={styles.list}>
                    {smartDurationRecommendation.reasons.map((reason) => (
                      <li key={reason}>{reason}</li>
                    ))}
                  </ul>
                  <p className={styles.recommendationPlan}>
                    Execution plan: {smartDurationRecommendation.executionPlan.join(" + ")} seconds
                  </p>
                </div>
              ) : null}

              <label className={styles.field}>
                <span>Model</span>
                <select
                  value={formState.model}
                  onChange={(event) =>
                    handleModelChange(event.currentTarget.value as GenerateVideoRequest["model"])
                  }
                >
                  {VIDEO_MODELS.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
                <small>
                  {formState.model === "sora-2"
                    ? "Sora-2 is limited to the supported 720p render sizes."
                    : "Sora-2-pro unlocks both the 720p and higher-resolution format options."}
                </small>
              </label>

              <label className={styles.field}>
                <span>Advanced planner</span>
                <select
                  value={formState.plannerMode}
                  onChange={(event) => {
                    const plannerMode = event.currentTarget.value as GenerateVideoRequest["plannerMode"];
                    setFormState((current) => ({
                      ...current,
                      plannerMode,
                    }));
                  }}
                >
                  {PLANNER_MODE_IDS.map((plannerModeId) => (
                    <option key={plannerModeId} value={plannerModeId}>
                      {PLANNER_OPTIONS[plannerModeId].label}
                    </option>
                  ))}
                </select>
                <small>
                  {currentPlanner.model} via Responses API with {currentPlanner.reasoningEffort} reasoning.
                </small>
              </label>

              <label className={styles.field}>
                <span>Style / vibe</span>
                <select
                  value={formState.style}
                  onChange={(event) => {
                    const style = event.currentTarget.value as GenerateVideoRequest["style"];
                    setFormState((current) => ({
                      ...current,
                      style,
                    }));
                  }}
                >
                  {STYLE_PRESET_IDS.map((styleId) => (
                    <option key={styleId} value={styleId}>
                      {STYLE_PRESETS[styleId].label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span>Avoid</span>
                <input
                  value={formState.avoid}
                  onChange={(event) => {
                    const avoid = event.currentTarget.value;
                    setFormState((current) => ({
                      ...current,
                      avoid,
                    }));
                  }}
                  placeholder="muddy lighting, abrupt cut, on-screen text"
                />
              </label>
            </div>

            <button
              className={styles.generateButton}
              type="submit"
              disabled={!canGenerate}
            >
              {isSubmitting
                ? "Starting job..."
                : isAnyJobRunning
                  ? "Generate disabled while a job runs"
                  : "Generate"}
            </button>
          </form>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionKicker}>Live job</p>
              <h2>{selectedJob?.title ?? "No job selected yet"}</h2>
            </div>
            {selectedJob ? (
              <span className={styles.statusPill} data-status={selectedJob.status}>
                {selectedJob.status}
              </span>
            ) : null}
          </div>

          {selectedJob ? (
            <>
              <div className={styles.progressHeader}>
                <span>{formatPhase(selectedJob.phase)}</span>
                <strong>{selectedJob.progress}%</strong>
              </div>
              <div className={styles.progressTrack} aria-hidden="true">
                <div
                  className={styles.progressFill}
                  style={{ width: `${selectedJob.progress}%` }}
                />
              </div>
              <div className={styles.jobMetaGrid}>
                <div>
                  <span className={styles.metaLabel}>Duration</span>
                  <strong>{selectedJob.input.totalDuration}s target</strong>
                  {selectedJob.durationRecommendation ? (
                    <small className={styles.metaNote}>
                      {selectedJob.durationRecommendation.summary}
                    </small>
                  ) : null}
                </div>
                <div>
                  <span className={styles.metaLabel}>Execution plan</span>
                  <strong>{selectedJob.executionPlan.join(" + ")} seconds</strong>
                </div>
                <div>
                  <span className={styles.metaLabel}>Format</span>
                  <strong>
                    {FORMAT_OPTIONS[selectedJob.input.format].shortLabel} • {selectedJob.input.format}
                  </strong>
                </div>
                <div>
                  <span className={styles.metaLabel}>Model</span>
                  <strong>{selectedJob.input.model}</strong>
                </div>
                <div>
                  <span className={styles.metaLabel}>Planner</span>
                  <strong>{PLANNER_OPTIONS[selectedJob.input.plannerMode].model}</strong>
                </div>
                {selectedJob.input.referenceAsset ? (
                  <div>
                    <span className={styles.metaLabel}>Reference asset</span>
                    <strong>{selectedJob.input.referenceAsset.originalFileName}</strong>
                  </div>
                ) : null}
              </div>

              <div className={styles.previewArea}>
                {selectedJob.finalAsset ? (
                  <video
                    className={styles.video}
                    controls
                    preload="metadata"
                    src={selectedJob.finalAsset.videoUrl}
                  />
                ) : (
                  <div className={styles.previewPlaceholder}>
                    Final video preview will appear here when the chained job finishes.
                  </div>
                )}
              </div>

              <div className={styles.actionRow}>
                {selectedJob.finalAsset ? (
                  <a className={styles.secondaryButton} href={selectedJob.finalAsset.downloadUrl}>
                    Download MP4
                  </a>
                ) : null}
                {selectedJob.retryable ? (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => handleRetry(selectedJob.id)}
                  >
                    Retry from last successful segment
                  </button>
                ) : null}
              </div>

              {selectedJob.error ? (
                <div className={styles.inlineError}>
                  <strong>{selectedJob.error.stage ?? "generation"} failed</strong>
                  <span>{selectedJob.error.message}</span>
                </div>
              ) : null}

              <details className={styles.detailsPanel}>
                <summary>Prompt details</summary>
                {selectedJob.promptPlan ? (
                  <div className={styles.detailsContent}>
                    <div>
                      <span className={styles.metaLabel}>Rough input</span>
                      <p>{selectedJob.input.roughIdea}</p>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>Optimized master prompt</span>
                      <p>{selectedJob.promptPlan.masterPrompt}</p>
                    </div>
                    {selectedJob.input.referenceAsset ? (
                      <div>
                        <span className={styles.metaLabel}>Reference asset used</span>
                        <div className={styles.referenceAssetDetails}>
                          <Image
                            alt={`Reference asset ${selectedJob.input.referenceAsset.originalFileName}`}
                            className={styles.referenceAssetDetailsPreview}
                            src={
                              selectedJob.referenceAssetPrepared?.previewUrl ??
                              selectedJob.input.referenceAsset.previewUrl
                            }
                            unoptimized
                            width={84}
                            height={84}
                          />
                          <div>
                            <p>{selectedJob.input.referenceAsset.originalFileName}</p>
                            <p className={styles.muted}>
                              {selectedJob.referenceAssetPrepared
                                ? `Prepared for ${selectedJob.referenceAssetPrepared.format} before the initial Sora generation.`
                                : "Stored with the job as the uploaded visual reference."}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div>
                      <span className={styles.metaLabel}>Initial prompt</span>
                      <p>{selectedJob.promptPlan.initialPrompt}</p>
                    </div>
                    {selectedJob.promptPlan.extensionPrompts.map((prompt, index) => (
                      <div key={`${selectedJob.id}-prompt-${index}`}>
                        <span className={styles.metaLabel}>Extension prompt {index + 1}</span>
                        <p>{prompt}</p>
                      </div>
                    ))}
                    <div>
                      <span className={styles.metaLabel}>Caption suggestion</span>
                      <p>{selectedJob.promptPlan.captionSuggestion}</p>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>Avoid list</span>
                      <ul className={styles.list}>
                        {selectedJob.promptPlan.avoidList.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className={styles.metaLabel}>OpenAI video IDs</span>
                      <ul className={styles.list}>
                        {selectedJob.completedVideoIds.map((videoId) => (
                          <li key={videoId}>{videoId}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                ) : (
                  <p className={styles.muted}>Prompt planning has not completed yet.</p>
                )}
              </details>

              <div className={styles.logPanel}>
                <div className={styles.logHeader}>
                  <strong>Status log</strong>
                  <span>{selectedJob.logs.length} events</span>
                </div>
                <ul className={styles.logList}>
                  {[...selectedJob.logs].reverse().map((entry) => (
                    <li key={entry.id}>
                      <time>{formatDate(entry.time)}</time>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <div className={styles.emptyState}>
              Generate a new job or pick one from Recent Jobs to inspect its prompt plan,
              progress, and final video.
            </div>
          )}
        </section>
      </div>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.sectionKicker}>Recent jobs</p>
            <h2>Saved locally in this repo</h2>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void refreshRecentJobs()}
          >
            Refresh
          </button>
        </div>

        {recentJobs.length > 0 ? (
          <div className={styles.recentJobsGrid}>
            {recentJobs.map((job) => (
              <article key={job.id} className={styles.jobCard}>
                <div className={styles.jobCardHeader}>
                  <div>
                    <h3>{job.title ?? "Untitled video plan"}</h3>
                    <p>{formatDate(job.createdAt)}</p>
                  </div>
                  <span className={styles.statusPill} data-status={job.status}>
                    {job.status}
                  </span>
                </div>
                <p className={styles.jobIdea}>{job.roughIdea}</p>
                <div className={styles.jobStats}>
                  <span>{job.model}</span>
                  <span>{FORMAT_OPTIONS[job.format].shortLabel}</span>
                  <span>{job.targetDuration}s target</span>
                </div>
                {job.previewUrl ? (
                  <video
                    className={styles.jobPreview}
                    controls
                    preload="metadata"
                    src={job.previewUrl}
                  />
                ) : (
                  <div className={styles.previewPlaceholderSmall}>
                    Preview available after completion.
                  </div>
                )}
                <div className={styles.actionRow}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    Open details
                  </button>
                  {job.downloadUrl ? (
                    <a className={styles.secondaryButton} href={job.downloadUrl}>
                      Download
                    </a>
                  ) : null}
                  {job.retryable ? (
                    <button
                      className={styles.secondaryButton}
                      type="button"
                      onClick={() => handleRetry(job.id)}
                    >
                      Retry
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            No recent jobs yet. The first generated job will appear here with its saved
            metadata and MP4 preview.
          </div>
        )}
      </section>
    </div>
  );
}

function summarizeJob(job: StudioJob): StudioJobSummary {
  return {
    id: job.id,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    title: job.title,
    roughIdea: job.input.roughIdea,
    model: job.input.model,
    format: job.input.format,
    targetDuration: job.input.totalDuration,
    finalDuration: job.finalDuration ?? null,
    previewUrl: job.finalAsset?.videoUrl ?? null,
    downloadUrl: job.finalAsset?.downloadUrl ?? null,
    finalOpenAiVideoId: job.finalOpenAiVideoId ?? null,
    retryable: job.retryable,
  };
}

function isStudioDraft(value: unknown): value is StudioDraft {
  return typeof value === "object" && value !== null && "formState" in value;
}

function normalizeFormState(
  draft: Partial<GenerateVideoRequest>,
): GenerateVideoRequest {
  const durationMode =
    draft.durationMode && DURATION_MODE_IDS.includes(draft.durationMode)
      ? draft.durationMode
      : defaultFormState.durationMode;
  const plannerMode =
    draft.plannerMode && PLANNER_MODE_IDS.includes(draft.plannerMode)
      ? draft.plannerMode
      : defaultFormState.plannerMode;
  const merged = {
    ...defaultFormState,
    ...draft,
    durationMode,
    plannerMode,
    totalDuration: normalizeDurationOption(draft.totalDuration ?? defaultFormState.totalDuration),
  };

  return {
    ...merged,
    format:
      merged.platformPreset === "custom"
        ? getCompatibleFormatForModel(merged.format, merged.model)
        : getPreferredFormatForPlatform(merged.platformPreset, merged.model, merged.format),
  };
}

function normalizeDurationOption(totalDuration: number) {
  return TOTAL_DURATION_OPTIONS.includes(totalDuration as (typeof TOTAL_DURATION_OPTIONS)[number])
    ? totalDuration
    : defaultFormState.totalDuration;
}

function upsertJobSummary(current: StudioJobSummary[], next: StudioJobSummary) {
  const remaining = current.filter((job) => job.id !== next.id);
  return [next, ...remaining].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

function isJobActive(status: StudioJob["status"]) {
  return status === "queued" || status === "in_progress";
}

function formatPhase(phase: StudioJob["phase"]) {
  switch (phase) {
    case "created":
      return "Queued";
    case "planning":
      return "Planning prompts";
    case "creating_initial_video":
      return "Generating first clip";
    case "extending_video":
      return "Creating extension";
    case "polling_segment":
      return "Waiting on Sora";
    case "downloading":
      return "Downloading final MP4";
    case "saving":
      return "Saving metadata";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    default:
      return phase;
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}
