/**
 * The application's trusted hazard data source.
 *
 * In production this is USGS / NOAA / a national agency feed. For the demo it
 * is a fixed snapshot — the point being that official status comes from *here*
 * and nowhere else. The model is never permitted to state a warning that did
 * not come out of this file.
 */

export interface QuakeEvent {
  id: string;
  magnitude: number;
  depthKm: number;
  place: string;
  region: string;
  time: string;
  latitude: number;
  longitude: number;
  feltReports: number;
  maxIntensity: string;
  tectonicSetting: string;
  faultType: "subduction thrust" | "strike-slip" | "normal";
}

export interface TsunamiStatus {
  eventId: string;
  /** Verbatim from the issuing agency. */
  level: "no threat" | "advisory" | "watch" | "warning";
  agency: string;
  issuedAt: string;
  statement: string;
  coastalAreas: string[];
  sourceUrl: string;
}

export interface VolcanoStatus {
  id: string;
  name: string;
  alertLevel: "normal" | "advisory" | "watch" | "warning";
  aviationColor: "green" | "yellow" | "orange" | "red";
  agency: string;
  updatedAt: string;
  sourceUrl: string;
}

const events: QuakeEvent[] = [
  {
    id: "us7000q1x2",
    magnitude: 6.8,
    depthKm: 32,
    place: "78 km ESE of Ōfunato, Japan",
    region: "Japan",
    time: "2026-08-19T04:12:07Z",
    latitude: 38.94,
    longitude: 142.61,
    feltReports: 4210,
    maxIntensity: "VI (Strong)",
    tectonicSetting: "Japan Trench, Pacific plate subducting beneath the Okhotsk plate",
    faultType: "subduction thrust",
  },
  {
    id: "us7000q0f4",
    magnitude: 4.4,
    depthKm: 9,
    place: "12 km NW of Parkfield, California",
    region: "California",
    time: "2026-08-18T22:41:55Z",
    latitude: 35.98,
    longitude: -120.51,
    feltReports: 860,
    maxIntensity: "IV (Light)",
    tectonicSetting: "San Andreas fault system",
    faultType: "strike-slip",
  },
  {
    id: "us7000pze8",
    magnitude: 5.1,
    depthKm: 118,
    place: "South of the Fiji Islands",
    region: "Fiji",
    time: "2026-08-18T11:03:19Z",
    latitude: -23.11,
    longitude: -179.4,
    feltReports: 3,
    maxIntensity: "II (Weak)",
    tectonicSetting: "Tonga-Kermadec subduction zone",
    faultType: "subduction thrust",
  },
  {
    id: "us7000pyq1",
    magnitude: 3.2,
    depthKm: 6,
    place: "5 km SSW of Reykjanes, Iceland",
    region: "Iceland",
    time: "2026-08-19T01:55:02Z",
    latitude: 63.81,
    longitude: -22.71,
    feltReports: 120,
    maxIntensity: "III (Weak)",
    tectonicSetting: "Mid-Atlantic Ridge, Reykjanes peninsula dyke intrusion",
    faultType: "normal",
  },
];

const tsunami: Record<string, TsunamiStatus> = {
  us7000q1x2: {
    eventId: "us7000q1x2",
    level: "advisory",
    agency: "Japan Meteorological Agency",
    issuedAt: "2026-08-19T04:24:00Z",
    statement:
      "Tsunami advisory in effect for the Pacific coast of Iwate and Miyagi prefectures. Waves of up to 1 metre are possible. Stay out of the water and away from beaches and harbours.",
    coastalAreas: ["Iwate Pacific coast", "Miyagi Pacific coast"],
    sourceUrl: "https://www.jma.go.jp/",
  },
  us7000pze8: {
    eventId: "us7000pze8",
    level: "no threat",
    agency: "Pacific Tsunami Warning Center",
    issuedAt: "2026-08-18T11:19:00Z",
    statement:
      "Based on the earthquake's depth and magnitude, no tsunami threat exists for any coastline.",
    coastalAreas: [],
    sourceUrl: "https://www.tsunami.gov/",
  },
};

const volcanoes: VolcanoStatus[] = [
  {
    id: "fagradalsfjall",
    name: "Fagradalsfjall",
    alertLevel: "watch",
    aviationColor: "orange",
    agency: "Icelandic Meteorological Office",
    updatedAt: "2026-08-19T02:30:00Z",
    sourceUrl: "https://en.vedur.is/",
  },
  {
    id: "kilauea",
    name: "Kīlauea",
    alertLevel: "advisory",
    aviationColor: "yellow",
    agency: "USGS Hawaiian Volcano Observatory",
    updatedAt: "2026-08-18T18:00:00Z",
    sourceUrl: "https://www.usgs.gov/observatories/hvo",
  },
];

export function listEvents(filter: { region?: string; minMagnitude?: number } = {}): QuakeEvent[] {
  return events
    .filter((e) => !filter.region || e.region.toLowerCase().includes(filter.region.toLowerCase()))
    .filter((e) => filter.minMagnitude === undefined || e.magnitude >= filter.minMagnitude)
    .sort((a, b) => b.time.localeCompare(a.time));
}

export function getEvent(id: string): QuakeEvent | undefined {
  return events.find((e) => e.id === id);
}

/**
 * Returns the official status, including the explicit "nothing was issued"
 * case. An absent record is itself a fact the assistant must state, rather
 * than an invitation to guess.
 */
export function getTsunamiStatus(eventId: string): TsunamiStatus | { eventId: string; level: "none issued"; statement: string } {
  return (
    tsunami[eventId] ?? {
      eventId,
      level: "none issued",
      statement:
        "No tsunami message has been issued for this event by any monitoring agency.",
    }
  );
}

/** Levels that mean something is currently in effect. */
export function isActiveTsunamiLevel(level: string): boolean {
  return level === "advisory" || level === "watch" || level === "warning";
}

/**
 * Every tsunami message currently in effect across the catalogue.
 *
 * This is what "is there a tsunami warning?" means when the reader has not
 * selected an event: not "which one did you mean", but "is anything active".
 */
export function listActiveTsunamiMessages(): Array<{
  event: QuakeEvent;
  status: TsunamiStatus;
}> {
  const active: Array<{ event: QuakeEvent; status: TsunamiStatus }> = [];
  for (const event of listEvents()) {
    const status = getTsunamiStatus(event.id);
    if ("agency" in status && isActiveTsunamiLevel(status.level)) {
      active.push({ event, status });
    }
  }
  return active;
}

export function listVolcanoes(): VolcanoStatus[] {
  return volcanoes;
}

export function magnitudeLabel(magnitude: number): string {
  if (magnitude >= 7) return "major";
  if (magnitude >= 6) return "strong";
  if (magnitude >= 5) return "moderate";
  if (magnitude >= 4) return "light";
  return "minor";
}
