/**
 * A real upstream feed.
 *
 * This is what an action calls in production: your own function, hitting your
 * own API or a third party's, inside your own server. The runtime never makes
 * the request and never sees the endpoint — it only knows that an action
 * called getLiveEvents exists and what shape its result takes.
 */
import type { QuakeEvent } from "./hazard-api.ts";

const FEEDS = {
  hour: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson",
  day: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson",
  week: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson",
} as const;

export type FeedWindow = keyof typeof FEEDS;

export interface LiveEvent extends QuakeEvent {
  /** USGS's own flag that a tsunami message may exist for this event. */
  tsunamiFlagged: boolean;
  url: string;
}

interface UsgsFeature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number;
    tsunami: number;
    url: string;
    title: string;
  };
  geometry: { coordinates: [number, number, number] };
}

/** Cached briefly: a hazard feed is shared by every reader, not per request. */
let cache: { at: number; window: FeedWindow; events: LiveEvent[] } | undefined;
const CACHE_MS = 60_000;

export async function fetchLiveEvents(
  window: FeedWindow = "day",
  options: { minMagnitude?: number; region?: string; limit?: number } = {}
): Promise<LiveEvent[]> {
  if (!cache || cache.window !== window || Date.now() - cache.at > CACHE_MS) {
    const response = await fetch(FEEDS[window], {
      headers: { accept: "application/geo+json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`USGS feed responded ${response.status}. Live data is unavailable.`);
    }
    const body = (await response.json()) as { features: UsgsFeature[] };
    cache = { at: Date.now(), window, events: body.features.map(toEvent) };
  }

  let events = cache.events;
  if (options.region) {
    const needle = options.region.toLowerCase();
    events = events.filter((event) => event.place.toLowerCase().includes(needle));
  }
  if (options.minMagnitude !== undefined) {
    events = events.filter((event) => event.magnitude >= options.minMagnitude!);
  }
  return options.limit ? events.slice(0, options.limit) : events;
}

function toEvent(feature: UsgsFeature): LiveEvent {
  const [longitude, latitude, depthKm] = feature.geometry.coordinates;
  const place = feature.properties.place ?? feature.properties.title ?? "Unknown location";
  return {
    id: feature.id,
    magnitude: feature.properties.mag ?? 0,
    depthKm: Math.round(depthKm),
    place,
    region: place.split(",").pop()?.trim() ?? place,
    time: new Date(feature.properties.time).toISOString(),
    latitude,
    longitude,
    feltReports: 0,
    maxIntensity: "not reported",
    tectonicSetting: "see USGS event page",
    faultType: "subduction thrust",
    tsunamiFlagged: feature.properties.tsunami === 1,
    url: feature.properties.url,
  };
}
