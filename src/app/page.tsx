import StudioPage from "@/components/studio/studio-page";
import { getStudioJobSummaries } from "@/lib/studio/jobs";
import { hasOpenAIKey } from "@/lib/studio/openai";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initialJobs = await getStudioJobSummaries(8);

  return <StudioPage initialJobs={initialJobs} hasApiKey={hasOpenAIKey()} />;
}
