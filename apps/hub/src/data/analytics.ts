// The free analytics preview from the station (/analytics/v1/preview): top channels and categories for the last
// day, labelled with their source and coverage. The full dataset is the paid API.
export interface PreviewChannel { rank: number; login: string; name: string; game: string | null; language: string | null; peakViewers: number; averageViewers: number; hoursWatched: number; airtimeHours: number }
export interface PreviewCategory { rank: number; game: string; hoursWatched: number; peakViewers: number; channels: number }
export interface AnalyticsPreview {
  source: string;
  coverage: { firstSampleAt: number | null; lastSampleAt: number | null; polls: number; avgChannelsPerPoll: number; retentionDays: number };
  data: { window: { days: number }; channels: PreviewChannel[]; categories: PreviewCategory[] };
  generatedAt: number;
}

export async function fetchAnalyticsPreview(fetchImpl: typeof fetch = fetch): Promise<AnalyticsPreview | null> {
  const response = await fetchImpl("/analytics/v1/preview", { cache: "no-store" });
  if (response.status === 404) return null; // analytics is off on this station
  if (!response.ok) throw new Error(`analytics_${response.status}`);
  const body = (await response.json()) as AnalyticsPreview;
  if (!body?.data || !Array.isArray(body.data.channels) || !Array.isArray(body.data.categories) || typeof body.source !== "string") throw new Error("analytics_shape");
  return body;
}
