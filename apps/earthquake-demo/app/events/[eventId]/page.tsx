import { notFound } from "next/navigation";
import { getEvent, getTsunamiStatus, magnitudeLabel } from "@/lib/hazard-api";
import { PageContext } from "../../page-context";

export default async function EventPage({
  params,
}: {
  params: Promise<{ eventId: string }>;
}) {
  const { eventId } = await params;
  const event = getEvent(eventId);
  if (!event) notFound();
  const tsunami = getTsunamiStatus(event.id);

  return (
    <>
      {/* "this earthquake" is resolved here, not guessed at by the model. */}
      <PageContext
        id="event.detail"
        eventId={event.id}
        eventPlace={event.place}
        eventMagnitude={event.magnitude}
      />

      <h1>
        M{event.magnitude.toFixed(1)} — {event.place}
      </h1>
      <p className="sub">
        {new Date(event.time).toUTCString()} · <code>{event.id}</code>
      </p>

      {"agency" in tsunami && tsunami.level !== "no threat" && (
        <div className="notice">
          <div className="level">Tsunami {tsunami.level}</div>
          <p>{tsunami.statement}</p>
          <div className="src">
            {tsunami.agency} · issued {new Date(tsunami.issuedAt).toUTCString()}
          </div>
        </div>
      )}

      <div className="grid">
        <div className="stat">
          <div className="label">Magnitude</div>
          <div className="value">
            {event.magnitude.toFixed(1)} ({magnitudeLabel(event.magnitude)})
          </div>
        </div>
        <div className="stat">
          <div className="label">Depth</div>
          <div className="value">{event.depthKm} km</div>
        </div>
        <div className="stat">
          <div className="label">Max intensity</div>
          <div className="value">{event.maxIntensity}</div>
        </div>
        <div className="stat">
          <div className="label">Felt reports</div>
          <div className="value">{event.feltReports.toLocaleString()}</div>
        </div>
      </div>

      <h2>Tectonic setting</h2>
      <p className="muted">
        {event.tectonicSetting} · {event.faultType} faulting
      </p>

      <p className="muted">
        Ask the assistant “why was it felt so far away?” or “is there an official tsunami
        warning?”.
      </p>
    </>
  );
}
