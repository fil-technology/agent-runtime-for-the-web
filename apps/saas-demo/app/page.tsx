import Link from "next/link";
import { currentUser, getAccount, listProjects } from "@/lib/data";
import { PageContext } from "./page-context";

// The demo mutates data in memory, so pages must not be prerendered.
export const dynamic = "force-dynamic";

export default function Overview() {
  const user = currentUser();
  const account = getAccount();
  const projects = listProjects(user.id);

  return (
    <>
      <PageContext id="overview" />
      <h1>Welcome back, {user.name.split(" ")[0]}</h1>
      <p className="sub">
        {account.name} · {account.plan} plan · renews {account.renewsAt}
      </p>

      <div className="card">
        <div className="row">
          <span>Your projects</span>
          <Link href="/projects" className="muted">
            {projects.length} projects
          </Link>
        </div>
        <div className="row">
          <span>Seats in use</span>
          <span className="muted">2 of {account.seats}</span>
        </div>
        <div className="row">
          <span>Payment method</span>
          <span className="muted">{account.paymentMethod}</span>
        </div>
      </div>

      <h2>Try the assistant</h2>
      <p className="muted">
        Open the assistant in the corner and ask “when does my plan renew?”, “show my
        invoices”, or “where can I invite someone?”. Say “rename this project to
        EarthWatch” from anywhere — it will ask which project and let you pick.
      </p>
    </>
  );
}
