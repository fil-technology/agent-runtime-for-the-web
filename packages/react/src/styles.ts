/**
 * One stylesheet, all custom properties, all class names prefixed `ar-`.
 * Override any variable on :root, or ignore the component entirely and build
 * your own UI on useAgent().
 */
export const agentStyles = `
.ar-root {
  --ar-bg: #ffffff;
  --ar-fg: #16181d;
  --ar-muted: #6b7280;
  --ar-line: #e6e8ec;
  --ar-accent: #2f6df6;
  --ar-accent-fg: #ffffff;
  --ar-danger: #d33b3b;
  --ar-surface: #f6f7f9;
  --ar-radius: 12px;
  --ar-font: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;
  font-family: var(--ar-font); color: var(--ar-fg);
}
/*
 * Three theme states, in the order they must win.
 *
 * The OS preference is only the default. An application that themes itself
 * with a class or a toggle needs the panel to follow *it*, not the operating
 * system — otherwise a light page gets a dark chat panel and no amount of
 * variable overriding fixes it, because the media query keeps winning.
 * Pass the theme prop to AgentChat, or set data-theme on the root yourself.
 */
@media (prefers-color-scheme: dark) {
  .ar-root:not([data-theme="light"]) {
    --ar-bg: #14161a; --ar-fg: #f2f3f5; --ar-muted: #9aa1ad;
    --ar-line: #272b32; --ar-surface: #1b1e24; --ar-accent: #5b8cff;
  }
}
.ar-root[data-theme="dark"] {
  --ar-bg: #14161a; --ar-fg: #f2f3f5; --ar-muted: #9aa1ad;
  --ar-line: #272b32; --ar-surface: #1b1e24; --ar-accent: #5b8cff;
}
/* The page layout fills what it is given rather than positioning itself, so it
   drops into a host layout that already has a header without fighting it. */
.ar-root-page { position: static; inset: auto; width: 100%; height: 100%; }
.ar-page { display: flex; height: 100%; min-height: 0; background: var(--ar-bg); }
.ar-side {
  flex: 0 0 240px; display: flex; flex-direction: column; min-height: 0;
  border-right: 1px solid var(--ar-line); background: var(--ar-surface); padding: 12px;
}
.ar-new {
  flex: none; margin-bottom: 10px; padding: 9px 12px; border-radius: 10px; cursor: pointer;
  border: 1px solid var(--ar-line); background: var(--ar-bg); color: var(--ar-fg);
  font: inherit; font-size: 13px; font-weight: 550; text-align: left;
}
.ar-new:hover { border-color: var(--ar-accent); }
.ar-side .ar-history { border: none; background: none; padding: 0; max-height: none; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.ar-main { flex: 1 1 auto; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.ar-page-header {
  display: flex; align-items: center; gap: 9px; padding: 14px 20px; flex: 0 0 auto;
  border-bottom: 1px solid var(--ar-line);
}
.ar-page-messages { padding: 20px 20px 8px; }
/* A line of text is unreadable at full window width. */
.ar-column { width: 100%; max-width: 720px; margin: 0 auto; display: flex; flex-direction: column; gap: 14px; }
.ar-page-foot { flex: 0 0 auto; padding: 0 20px 4px; }
.ar-page-foot .ar-column { gap: 0; }
.ar-page-foot .ar-composer { margin: 0; }
.ar-empty-page { padding-top: 12vh; }
@media (max-width: 760px) {
  .ar-side { display: none; }
  .ar-page-messages { padding: 14px 14px 6px; }
  .ar-page-header { padding: 12px 14px; }
  .ar-page-foot { padding: 0 14px 4px; }
}
.ar-launcher {
  border: 1px solid var(--ar-line); background: var(--ar-bg); color: var(--ar-fg);
  border-radius: 999px; padding: 10px 18px; font-size: 14px; font-weight: 550;
  cursor: pointer; box-shadow: 0 6px 24px rgba(0,0,0,.12);
}
.ar-launcher:hover { border-color: var(--ar-accent); }
.ar-panel {
  width: min(420px, calc(100vw - 32px)); height: min(640px, calc(100vh - 48px));
  min-height: 0;
  background: var(--ar-bg); border: 1px solid var(--ar-line); border-radius: var(--ar-radius);
  box-shadow: 0 24px 60px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden;
}
.ar-header {
  display: flex; align-items: center; gap: 9px; padding: 11px 14px; flex: 0 0 auto;
  border-bottom: 1px solid var(--ar-line);
}
.ar-brand {
  display: grid; place-items: center; width: 28px; height: 28px; flex: none;
  border-radius: 8px; background: var(--ar-surface); color: var(--ar-fg);
}
.ar-titles { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; line-height: 1.25; }
.ar-title { font-size: 13.5px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ar-subtitle {
  font-size: 11px; color: var(--ar-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ar-header-spacer { flex: 0 0 4px; }
.ar-chip {
  font-size: 11px; font-weight: 500; color: var(--ar-muted); border: 1px solid var(--ar-line);
  border-radius: 999px; padding: 2px 8px; white-space: nowrap;
}
.ar-icon-button {
  border: none; background: transparent; color: var(--ar-muted); cursor: pointer;
  font-size: 12.5px; padding: 4px 6px; border-radius: 6px;
  white-space: nowrap; flex: none;
}
.ar-icon-button:hover { background: var(--ar-surface); color: var(--ar-fg); }
/* min-height:0 is load-bearing: without it a flex child grows to fit its
   content instead of scrolling, and the transcript silently overflows. */
.ar-powered {
  display: inline-flex; align-items: center; gap: 5px; flex: none;
  font-size: 10.5px; letter-spacing: .01em;
  color: var(--ar-muted); text-decoration: none;
}
.ar-powered:hover { color: var(--ar-fg); }
.ar-mark { flex: none; opacity: .85; }
.ar-powered:hover .ar-mark { opacity: 1; }
.ar-choices {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 6px 0 2px;
}
.ar-choice {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--ar-line);
  background: var(--ar-surface);
  color: var(--ar-fg);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.ar-choice:hover {
  border-color: var(--ar-accent);
}
.ar-choice-hint {
  opacity: 0.55;
  font-size: 11px;
}
.ar-messages { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
/* The first thing anyone sees: say what this is, then get out of the way. */
.ar-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center;
  gap: 3px; padding: 26px 8px 8px; color: var(--ar-muted); font-size: 13px; line-height: 1.5;
}
.ar-empty-mark {
  display: grid; place-items: center; width: 48px; height: 48px; margin-bottom: 9px;
  border-radius: 14px; background: var(--ar-surface); color: var(--ar-fg);
}
.ar-empty-title { font-size: 16px; font-weight: 640; color: var(--ar-fg); }
.ar-empty-lead { font-size: 13.5px; color: var(--ar-muted); }
.ar-empty-note { font-size: 11.5px; opacity: .8; max-width: 34ch; margin-top: 4px; }
.ar-suggestions {
  display: flex; flex-wrap: wrap; gap: 6px; margin-top: 16px; justify-content: center;
}
.ar-suggestion {
  border: 1px solid var(--ar-line); background: var(--ar-bg); color: var(--ar-fg);
  border-radius: 999px; padding: 5px 10px; font-size: 12px; cursor: pointer;
}
.ar-suggestion:hover { border-color: var(--ar-accent); }
/* A turn is who spoke, when, and what they said. */
.ar-turn { display: flex; flex-direction: column; gap: 4px; flex: 0 0 auto; }
.ar-turn-meta {
  display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  font-size: 10.5px; color: var(--ar-muted);
}
.ar-turn-time { opacity: .75; white-space: nowrap; }
.ar-said { display: flex; align-items: flex-start; gap: 7px; }
.ar-avatar {
  display: grid; place-items: center; width: 20px; height: 20px; flex: none;
  margin-top: 5px; border-radius: 7px; background: var(--ar-surface); color: var(--ar-fg);
}
.ar-msg { flex: 0 1 auto; font-size: 14px; line-height: 1.5; max-width: 88%; padding: 9px 12px; border-radius: 12px; white-space: pre-wrap; word-break: break-word; }
.ar-msg-user { align-self: flex-end; background: var(--ar-accent); color: var(--ar-accent-fg); border-bottom-right-radius: 4px; }
.ar-msg-assistant { align-self: flex-start; background: var(--ar-surface); border-bottom-left-radius: 4px; }
.ar-cursor { display: inline-block; width: 7px; animation: ar-blink 1s steps(2) infinite; }
@keyframes ar-blink { 50% { opacity: 0 } }
.ar-card { flex: 0 0 auto; border: 1px solid var(--ar-line); border-radius: 10px; padding: 12px; background: var(--ar-bg); font-size: 13px; }
.ar-card-confirm { border-color: var(--ar-accent); }
.ar-card-offer { border-color: var(--ar-line); }
.ar-card-offer .ar-card-actions { margin-top: 8px; }
.ar-card-title { font-weight: 600; margin-bottom: 4px; }
.ar-card-body { color: var(--ar-muted); line-height: 1.5; }
.ar-card-actions { display: flex; gap: 8px; margin-top: 10px; }
.ar-button {
  border: 1px solid var(--ar-line); background: var(--ar-bg); color: var(--ar-fg);
  border-radius: 8px; padding: 6px 12px; font-size: 13px; cursor: pointer; font-weight: 550;
}
.ar-button:hover { background: var(--ar-surface); }
.ar-button-primary { background: var(--ar-accent); color: var(--ar-accent-fg); border-color: var(--ar-accent); }
.ar-button-primary:hover { filter: brightness(1.06); background: var(--ar-accent); }
.ar-button-danger { background: var(--ar-danger); color: #fff; border-color: var(--ar-danger); }
.ar-button-danger:hover { filter: brightness(1.06); background: var(--ar-danger); }
.ar-status { font-size: 12px; color: var(--ar-muted); }

/* on-device model download */
.ar-loader { padding: 10px 14px; border-bottom: 1px solid var(--ar-line); background: var(--ar-surface); }
.ar-loader-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 7px; }
.ar-loader-title { font-size: 12.5px; font-weight: 550; color: var(--ar-fg); }
.ar-loader-pct { font-size: 12px; color: var(--ar-muted); font-variant-numeric: tabular-nums; }
.ar-loader-note { font-size: 11.5px; color: var(--ar-muted); margin-top: 7px; line-height: 1.45; }
.ar-progress { height: 5px; border-radius: 999px; background: color-mix(in srgb, var(--ar-fg) 12%, transparent); overflow: hidden; }
.ar-progress-fill { height: 100%; border-radius: 999px; background: var(--ar-accent); width: 0; transition: width .45s cubic-bezier(.4,0,.2,1); }
.ar-progress-idle { position: relative; }
.ar-progress-idle .ar-progress-fill { width: 38%; animation: ar-sweep 1.4s ease-in-out infinite; }
@keyframes ar-sweep { 0% { transform: translateX(-110%) } 100% { transform: translateX(300%) } }

/* past conversations */
.ar-history { border-bottom: 1px solid var(--ar-line); background: var(--ar-surface); max-height: 230px; overflow-y: auto; }
.ar-history-empty { padding: 12px 14px; font-size: 12.5px; color: var(--ar-muted); }
.ar-history-row { display: flex; align-items: center; gap: 4px; padding: 2px 8px 2px 4px; }
.ar-history-row:hover { background: var(--ar-bg); }
.ar-history-current .ar-history-title { color: var(--ar-accent); }
.ar-history-open { flex: 1; text-align: left; background: none; border: none; cursor: pointer; padding: 7px 8px; color: inherit; font: inherit; min-width: 0; }
.ar-history-title { display: block; font-size: 13px; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ar-history-when { display: block; font-size: 11px; color: var(--ar-muted); margin-top: 1px; }

/* where an answer came from */
.ar-source { flex: 0 0 auto; border: 1px solid var(--ar-line); border-radius: 10px; padding: 11px 12px; background: var(--ar-surface); }
.ar-source-kicker { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--ar-muted); }
.ar-source-title { font-size: 13.5px; font-weight: 600; margin-top: 3px; }
.ar-source-meta { font-size: 11.5px; color: var(--ar-muted); margin-top: 1px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.ar-source-open { margin-top: 9px; width: 100%; }
.ar-source-more { font-size: 11.5px; color: var(--ar-muted); margin-top: 8px; }

/* action results, rendered as elements */
.ar-result { border: 1px solid var(--ar-line); border-radius: 10px; overflow: hidden; flex: 0 0 auto; }
.ar-result-row { padding: 9px 12px; border-bottom: 1px solid var(--ar-line); }
.ar-result-link { display: block; width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid var(--ar-line); color: inherit; font: inherit; cursor: pointer; position: relative; }
.ar-result-link:hover { background: var(--ar-surface); }
.ar-result-link:hover .ar-result-go, .ar-result-link:focus-visible .ar-result-go { opacity: 1; }
/* Visible without hovering. A row that can be opened has to look like one
   before you touch it — on a phone there is no hover to reveal it with. */
.ar-result-go { position: absolute; right: 12px; top: 50%; transform: translateY(-50%); font-size: 11.5px; color: var(--ar-accent); opacity: .75; transition: opacity .12s ease; }
/* The label must not run underneath the affordance. */
.ar-result-link .ar-result-label, .ar-result-link .ar-result-meta { padding-right: 56px; }
.ar-result-row:last-child { border-bottom: none; }
.ar-result-label { font-size: 13.5px; font-weight: 550; }
.ar-result-meta { font-size: 11.5px; color: var(--ar-muted); margin-top: 2px; }
.ar-result-more { padding: 7px 12px; font-size: 11.5px; color: var(--ar-muted); background: var(--ar-surface); }

/* thinking indicator */
.ar-thinking { display: flex; align-items: center; gap: 9px; font-size: 12.5px; color: var(--ar-muted); padding: 3px 2px; }
.ar-dots { display: inline-flex; gap: 3px; align-items: center; }
.ar-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--ar-accent); opacity: .3; animation: ar-bounce 1.15s infinite ease-in-out; }
.ar-dot:nth-child(2) { animation-delay: .16s; }
.ar-dot:nth-child(3) { animation-delay: .32s; }
@keyframes ar-bounce { 0%, 65%, 100% { opacity: .28; transform: translateY(0) } 32% { opacity: 1; transform: translateY(-3px) } }
.ar-thinking-where { color: color-mix(in srgb, var(--ar-muted) 75%, transparent); font-size: 11px; }

/* readiness dot on the chip */
.ar-chip-dot { display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: #3aab6d; margin-right: 5px; vertical-align: 1px; }

@media (prefers-reduced-motion: reduce) {
  .ar-dot, .ar-progress-idle .ar-progress-fill, .ar-cursor { animation: none; }
  .ar-progress-fill { transition: none; }
}
.ar-error { border: 1px solid color-mix(in srgb, var(--ar-danger) 45%, var(--ar-line)); border-radius: 10px; padding: 10px 12px; font-size: 12.5px; }
.ar-error-title { color: var(--ar-danger); font-weight: 600; margin-bottom: 4px; }
.ar-error pre { margin: 6px 0 0; white-space: pre-wrap; font-size: 11.5px; color: var(--ar-muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
/* One field, one round button — the composer should look like somewhere to
   write, not a form to fill in. */
.ar-composer {
  display: flex; align-items: flex-end; gap: 8px; margin: 10px 12px 0; padding: 8px 8px 8px 12px;
  border: 1px solid var(--ar-line); border-radius: 16px; background: var(--ar-bg); flex: 0 0 auto;
}
.ar-composer:focus-within { border-color: color-mix(in srgb, var(--ar-accent) 55%, var(--ar-line)); }
.ar-input {
  flex: 1; border: none; padding: 7px 0; font: inherit; font-size: 14px; line-height: 1.45;
  background: none; color: var(--ar-fg); resize: none; max-height: 132px;
}
.ar-input:focus { outline: none; }
.ar-send {
  display: grid; place-items: center; width: 32px; height: 32px; flex: none;
  border: none; border-radius: 999px; cursor: pointer; font-size: 15px; line-height: 1;
  background: var(--ar-accent); color: var(--ar-accent-fg);
}
.ar-send:disabled { background: var(--ar-surface); color: var(--ar-muted); cursor: default; }
.ar-footer {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 14px 10px; flex: 0 0 auto;
}
.ar-hint { font-size: 10.5px; color: var(--ar-muted); opacity: .8; white-space: nowrap; }
.ar-debug { border-top: 1px solid var(--ar-line); max-height: 240px; overflow-y: auto; background: var(--ar-surface); padding: 10px 12px; font-size: 11.5px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ar-muted); }
.ar-debug-row { display: flex; gap: 8px; justify-content: space-between; padding: 1px 0; }
.ar-debug-h { color: var(--ar-fg); font-weight: 600; margin: 8px 0 3px; }
.ar-debug-h:first-child { margin-top: 0; }
.ar-kv { color: var(--ar-fg); }
`;

let injected = false;

export function injectStyles(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const element = document.createElement("style");
  element.dataset.agentRuntime = "true";
  element.textContent = agentStyles;
  document.head.appendChild(element);
}
