import { listMembers } from "@/lib/data";
import { PageContext } from "../../page-context";

// The demo mutates data in memory, so pages must not be prerendered.
export const dynamic = "force-dynamic";

export default function Team() {
  const members = listMembers();
  return (
    <>
      <PageContext id="settings.team" />
      <h1>Team</h1>
      <p className="sub">Invitations expire after seven days.</p>
      <div className="card">
        {members.map((member) => (
          <div className="row" key={member.id}>
            <span>{member.email}</span>
            <span className="pill">{member.role}</span>
          </div>
        ))}
      </div>
      <p className="muted">
        Ask the assistant: “invite sam@example.com”. It will ask you to confirm first.
      </p>
    </>
  );
}
