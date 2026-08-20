import { PageContext } from "../page-context";

export default function Settings() {
  return (
    <>
      <PageContext id="settings" />
      <h1>Settings</h1>
      <p className="sub">Nothing to configure. This page exists to be navigated to.</p>
      <p className="muted">
        Ask the assistant to “take me to settings” from the notes page and watch the
        navigate action run in the browser.
      </p>
    </>
  );
}
