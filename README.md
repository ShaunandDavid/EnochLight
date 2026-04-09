# Sora Social Video Studio

Small Next.js studio for planning and generating continuity-first social videos with GPT-5 mini or GPT-5.4 and Sora.

## What it does

- Takes a rough idea, aspect preference, style, and avoid notes, then lets you either choose a manual duration or use Smart snap to estimate one automatically.
- Lets you optionally upload a brand or visual reference asset, stores it locally, and fits it to the exact selected Sora render canvas before the first generation.
- Uses GPT-5 mini by default, or GPT-5.4 in premium mode, through the Responses API to return a strict JSON prompt plan.
- Generates the first Sora clip, then extends that same video until the requested duration is reached.
- Persists prompt plans, metadata, and downloaded MP4s locally inside this repo.
- Lets you reopen recent jobs, preview the final MP4, download it again, and retry from the last successful segment if a later extension fails.

## Required env vars

Create a `.env.local` file in the repo root:

```bash
OPENAI_API_KEY=your_openai_api_key_here
```

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Feature route

- Studio UI: `/`
- Prompt planner API: `/api/studio/planner`
- Job orchestration API: `/api/studio/jobs`

## How the extension chain works

1. The UI sends the rough idea and generation settings to the server.
2. If you upload a reference asset, the server stores it locally and prepares a format-matched canvas version for the selected output size.
3. If Smart snap is enabled, the server estimates the runtime from the brief, adds opening and ending buffer, then snaps up to a supported duration before planning.
4. The server computes an execution-safe segment plan.
5. The selected planner returns structured JSON with:
   - `title`
   - `masterPrompt`
   - `initialPrompt`
   - `extensionPrompts`
   - `recommendedModel`
   - `recommendedSize`
   - `segmentPlan`
   - `captionSuggestion`
   - `avoidList`
6. The server generates the first Sora clip, optionally with the prepared reference asset passed to Sora as `input_reference`.
7. If more time is needed, the server extends that completed video instead of creating unrelated clips.
8. When the chain finishes, the server downloads the final MP4 and saves job metadata locally.

## Local persistence

- Job JSON files: `.generated/sora-social/jobs`
- Uploaded reference assets: `.generated/sora-social/assets`
- Final MP4 files: `.generated/sora-social/videos`

## Verification scripts

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

## Runtime limitations

- The current Sora API supports initial generation lengths of 4, 8, or 12 seconds. Longer totals are achieved through extensions, so some targets that conceptually feel like a single 16s or 20s segment are executed as a 12s opening clip plus one or more extensions.
- Smart snap currently snaps to the studio's supported target lengths: `8`, `12`, `16`, `20`, `24`, `32`, `40`, and `60` seconds.
- `sora-2` only exposes the supported 720p render sizes: `720x1280` and `1280x720`.
- `sora-2-pro` also exposes the higher-resolution render sizes: `1024x1792` and `1792x1024`.
- Reference assets currently support PNG, JPEG, and WEBP uploads. The app fits the uploaded image onto the selected output canvas with neutral padding, which works well for logos and other single visual anchors.
- The current OpenAI video API may still reject some reference images depending on safety or model constraints. When that happens, the studio surfaces the real API error instead of hiding it.
- This implementation is built for local or long-running Node execution. A serverless deployment would need durable background job infrastructure and object storage for generated MP4 persistence.
