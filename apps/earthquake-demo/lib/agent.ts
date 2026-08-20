import { z } from "zod";
import { action, clientAction, defineAgent, docs } from "@agent-runtime/core";
import {
  getEvent,
  getTsunamiStatus,
  listActiveTsunamiMessages,
  listEvents,
  listVolcanoes,
  magnitudeLabel,
} from "./hazard-api.ts";
import { fetchLiveEvents } from "./usgs.ts";

/**
 * A public-safety application.
 *
 * The hard rule here is that the language model must never produce hazard
 * status from memory. Every warning, advisory and alert level in an answer
 * comes out of an action result, and the runtime refuses to answer at all when
 * it has no grounding (groundedOnly). The model's entire job is to phrase
 * facts the application handed it.
 */
export const agent = defineAgent({
  identity: "Tremor",

  instructions:
    "You explain seismic and volcanic events. Official warnings, advisories and alert levels " +
    "may only be repeated from the supplied FACTS, word for word where possible, always with " +
    "the issuing agency named. Never estimate, predict or reassure beyond the FACTS.",

  knowledge: [docs("./content/docs")],

  context: ({ page }) => ({
    currentRoute: page.route,
    currentPage: page.id,
    currentEventId: page.eventId,
    currentEventPlace: page.eventPlace,
    currentEventMagnitude: page.eventMagnitude,
  }),

  actions: {
    getEvent: action({
      description:
        "Get the measured details of an earthquake: magnitude, depth, location, time, felt reports, intensity and tectonic setting",
      permission: "auto",
      input: z.object({ eventId: z.string() }),
      fillFromContext: { eventId: "currentEventId" },
      examples: ["tell me about this earthquake", "how deep was it", "how big was this quake"],
      // Only promise what this action can actually do: it takes a catalogue id,
      // so "name the region" would be a lie. Regions are searchEvents' job.
      clarify: () =>
        "Which earthquake? Open one from the list and ask again — or say “show earthquakes near Japan” to search by region.",
      authoritative: true,
      execute: async (input) => {
        const event = getEvent(input.eventId);
        if (!event) throw new Error(`No event ${input.eventId} in the catalogue.`);
        return {
          summary: `M${event.magnitude} ${magnitudeLabel(event.magnitude)} earthquake, ${event.depthKm} km deep, ${event.place}`,
          data: event,
        };
      },
    }),

    /**
     * The single most important action in this demo. "Is there a tsunami
     * warning?" must be answered by the agency, not by the model.
     */
    getTsunamiStatus: action({
      description:
        "Get the official tsunami warning, watch, advisory or all-clear for an event — " +
        "or, when no event is selected, every tsunami message currently in effect",
      permission: "auto",
      // Optional on purpose. Without an event in view the question is still
      // answerable, and answering it beats asking which earthquake was meant.
      input: z.object({ eventId: z.string().optional() }),
      fillFromContext: { eventId: "currentEventId" },
      examples: [
        "is there a tsunami warning",
        "is there an official tsunami advisory",
        "which earthquake has a tsunami alert",
        "any tsunami alerts",
        "should I evacuate the coast",
        "am I safe near the beach",
      ],
      authoritative: true,
      execute: async (input) => {
        if (input.eventId) {
          const status = getTsunamiStatus(input.eventId);
          const agency = "agency" in status ? status.agency : "no agency";
          return {
            summary: `Official tsunami status: ${status.level} (${agency})`,
            data: status,
          };
        }

        // Nothing selected: scan the catalogue and report what is in effect.
        const active = listActiveTsunamiMessages();
        if (!active.length) {
          return {
            summary:
              "No tsunami message is currently in effect for any earthquake in the catalogue.",
            data: { active: [], checked: listEvents().length },
          };
        }
        return {
          summary: active
            .map(
              ({ event, status }) =>
                `${status.level} for ${event.place} (M${event.magnitude}), issued by ${status.agency}`
            )
            .join("; "),
          data: active.map(({ event, status }) => ({
            eventId: event.id,
            place: event.place,
            magnitude: event.magnitude,
            level: status.level,
            agency: status.agency,
            issuedAt: status.issuedAt,
            statement: status.statement,
            coastalAreas: status.coastalAreas,
            sourceUrl: status.sourceUrl,
          })),
        };
      },
    }),

    searchEvents: action({
      description:
        "List or search recent earthquakes, newest first, optionally by region, minimum magnitude, or how many to return",
      permission: "auto",
      input: z.object({
        region: z.string().optional().describe("Region or country name, e.g. Japan"),
        minMagnitude: z.number().optional().describe("Smallest magnitude to include"),
        limit: z.number().int().min(1).max(50).optional().describe("How many events to return"),
      }),
      examples: [
        "show earthquakes near Japan today",
        "any quakes in California",
        "list recent events above magnitude 5",
        "what are the most recent 2 earthquakes",
        "what is the most recent one",
        "list them",
      ],
      execute: async (input) => {
        const all = listEvents({
          region: input.region,
          minMagnitude: input.minMagnitude,
        });
        const results = input.limit ? all.slice(0, input.limit) : all;

        // A count is not an answer to "list them". Name the events, so the
        // deterministic summary is genuinely useful on its own.
        const described = results
          .map(
            (e) =>
              `M${e.magnitude.toFixed(1)} ${e.place} (${new Date(e.time).toUTCString().slice(5, 16)})`
          )
          .join("; ");

        return {
          summary: results.length
            ? `${described}${all.length > results.length ? ` — ${all.length} in total` : ""}`
            : `No earthquakes in the catalogue${input.region ? ` for ${input.region}` : ""}`,
          data: results.map((e) => ({
            id: e.id,
            magnitude: e.magnitude,
            place: e.place,
            time: e.time,
            depthKm: e.depthKm,
          })),
        };
      },
    }),

    /**
     * A live upstream API, not a fixture.
     *
     * Proof that an action is just your code: this one calls the USGS feed
     * over the network. Everything else — permissions, confirmation,
     * grounding, the trace — behaves identically.
     */
    getLiveEvents: action({
      description:
        "Fetch earthquakes happening right now from the live USGS feed, optionally by region or minimum magnitude",
      permission: "auto",
      input: z.object({
        region: z.string().optional().describe("Region or country name, e.g. Japan"),
        minMagnitude: z.number().optional().describe("Smallest magnitude to include"),
        limit: z.number().int().min(1).max(20).optional(),
      }),
      examples: [
        "what is happening right now",
        "live earthquakes",
        "any earthquakes today",
        "show current earthquakes near Japan",
      ],
      authoritative: true,
      execute: async (input) => {
        const events = await fetchLiveEvents("day", {
          region: input.region,
          minMagnitude: input.minMagnitude,
          limit: input.limit ?? 5,
        });
        if (!events.length) {
          return {
            summary: `No earthquakes in the live USGS feed${input.region ? ` near ${input.region}` : ""} right now`,
            data: [],
          };
        }
        return {
          summary: events
            .map((e) => `M${e.magnitude.toFixed(1)} ${e.place}`)
            .join("; "),
          data: events.map((e) => ({
            magnitude: e.magnitude,
            place: e.place,
            time: e.time,
            depthKm: e.depthKm,
            tsunamiFlagged: e.tsunamiFlagged,
            url: e.url,
          })),
        };
      },
    }),

    getVolcanoStatus: action({
      description: "Get official volcano alert levels and aviation colour codes",
      permission: "auto",
      input: z.object({}),
      examples: ["any volcano alerts", "what is the alert level for Kilauea"],
      authoritative: true,
      execute: async () => {
        const volcanoes = listVolcanoes();
        return {
          summary: volcanoes
            .map((v) => `${v.name}: ${v.alertLevel} / aviation ${v.aviationColor} (${v.agency})`)
            .join("; "),
          data: volcanoes,
        };
      },
    }),

    showOnMap: clientAction({
      description: "Open the map — centred on an event when one is selected, otherwise showing every event",
      permission: "auto",
      // Optional: "show me a map" is answerable without picking an event first.
      input: z.object({
        eventId: z.string().optional(),
        region: z.string().optional().describe("Region to centre on, e.g. California"),
      }),
      fillFromContext: { eventId: "currentEventId" },
      examples: [
        "show this event on the map",
        "where is it on the map",
        "I need to see a map",
        "is there a map of earthquakes",
        "show me California's earthquake on the map",
      ],
      confirmLabel: "Show map",
      describe: (input, context) =>
        input.eventId
          ? `Show ${context.currentEventPlace ?? input.eventId} on the map`
          : input.region
            ? `Show ${input.region} on the map`
            : "Open the map of recent earthquakes",
    }),
  },

  // Gather from more than one lookup when a question needs it — bounded,
  // and only across safe reads.
  maxSteps: 3,

  // No facts, no answer. In a hazard product this is not a nicety.
  groundedOnly: true,

  models: { strategy: "auto", cloudFallback: true },
});
