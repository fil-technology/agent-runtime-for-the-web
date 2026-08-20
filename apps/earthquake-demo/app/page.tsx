import Link from "next/link";
import { listEvents, magnitudeLabel } from "@/lib/hazard-api";
import { PageContext } from "./page-context";

export default function Recent() {
  const events = listEvents();
  return (
    <>
      <PageContext id="events.list" />
      <h1>Recent earthquakes</h1>
      <p className="sub">Catalogue snapshot · {events.length} events</p>

      {events.map((event) => (
        <Link key={event.id} href={`/events/${event.id}`}>
          <div className="event">
            <div className="mag">{event.magnitude.toFixed(1)}</div>
            <div>
              <div className="where">{event.place}</div>
              <div className="when">
                {new Date(event.time).toUTCString()} · {event.depthKm} km deep ·{" "}
                {magnitudeLabel(event.magnitude)}
              </div>
            </div>
          </div>
        </Link>
      ))}

      <h2>Try the assistant</h2>
      <p className="muted">
        Ask “is there an official tsunami warning?” right here and it checks every event in
        the catalogue; ask it on an event page and it answers for that event. Either way the
        answer comes from the agency feed, never from the model's memory — ask something the
        app has no data for and it will say so instead of guessing.
      </p>
    </>
  );
}
