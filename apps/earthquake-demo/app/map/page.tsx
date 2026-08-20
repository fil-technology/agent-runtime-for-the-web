import { listEvents } from "@/lib/hazard-api";
import { PageContext } from "../page-context";

/** Deliberately crude: the map is not the point, the client action is. */
export default async function MapPage({
  searchParams,
}: {
  searchParams: Promise<{ focus?: string; region?: string }>;
}) {
  const { focus, region } = await searchParams;
  const events = listEvents({ region });
  const focused = events.find((e) => e.id === focus) ?? (region ? events[0] : undefined);

  const project = (lat: number, lon: number) => ({
    left: `${((lon + 180) / 360) * 100}%`,
    top: `${((90 - lat) / 180) * 100}%`,
  });

  return (
    <>
      <PageContext
        id="map"
        eventId={focused?.id}
        eventPlace={focused?.place}
        eventMagnitude={focused?.magnitude}
      />
      <h1>Map</h1>
      <p className="sub">
        {focused ? `Centred on ${focused.place}` : region ? `No events in ${region}` : "All catalogued events"}
      </p>
      <div className="map">
        {events.map((event) => {
          const position = project(event.latitude, event.longitude);
          const isFocus = event.id === focused?.id;
          return (
            <span key={event.id}>
              <span
                className={`pin${isFocus ? "" : " small"}`}
                style={position}
                title={event.place}
              />
              {isFocus && (
                <span className="pin-label" style={position}>
                  M{event.magnitude.toFixed(1)} {event.place}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <p className="muted" style={{ marginTop: 14 }}>
        Ask the assistant “show this event on the map” from an event page.
      </p>
    </>
  );
}
