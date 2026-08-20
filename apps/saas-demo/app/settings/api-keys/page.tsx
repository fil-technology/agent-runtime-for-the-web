import { PageContext } from "../../page-context";

export default function ApiKeys() {
  return (
    <>
      <PageContext id="settings.api-keys" />
      <h1>API keys</h1>
      <p className="sub">Keys are scoped to a project and shown once at creation.</p>
      <div className="card">
        <div className="row">
          <span>
            Production key
            <div className="muted">Created 2026-02-12 · last used today</div>
          </span>
          <code>nw_live_••••••4f2a</code>
        </div>
        <div className="row">
          <span>
            Staging key
            <div className="muted">Created 2026-04-03 · last used 3 days ago</div>
          </span>
          <code>nw_test_••••••91bd</code>
        </div>
      </div>
    </>
  );
}
