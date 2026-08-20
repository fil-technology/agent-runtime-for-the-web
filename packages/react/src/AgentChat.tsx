"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionProposal, AnswerSource, Choice } from "@agent-runtime/core";
import { useAgent, type ChatItem } from "./context.js";
import { injectStyles } from "./styles.js";
import { DebugPanel } from "./DebugPanel.js";

export interface AgentChatProps {
  title?: string;
  placeholder?: string;
  /** Prompts shown on the empty state. Good ones teach the capability surface. */
  suggestions?: string[];
  /** Render open on mount. */
  defaultOpen?: boolean;
  launcherLabel?: string;
  /**
   * Which palette to use. Defaults to the operating system preference; set it
   * when the host application themes itself, so the panel follows the page
   * rather than the OS. "system" restores the default behaviour.
   */
  theme?: "light" | "dark" | "system";
}

const POWERED_BY_HREF = "https://github.com/fil-technology/agent-runtime-for-the-web";
const POWERED_BY_LABEL = "Agent Runtime";

/** How close to the bottom counts as "still following the conversation". */
const FOLLOW_THRESHOLD_PX = 140;

export function AgentChat(props: AgentChatProps) {
  const agent = useAgent();
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const [showDebug, setShowDebug] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [draft, setDraft] = useState("");
  const [mounted, setMounted] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  // Developer affordances render after mount so the server and the first
  // client render always agree, whatever the environment reports.
  const debug = agent.debug && mounted;

  useEffect(() => {
    injectStyles();
    setMounted(true);
  }, []);
  useEffect(() => {
    const box = scroller.current;
    if (!box) return;
    // Instant, not smooth. Both scrollTo({behavior:"smooth"}) and CSS
    // scroll-behavior silently fail to move the container in some embedded
    // contexts, which loses the newest message entirely — a worse trade than
    // the animation.
    //
    // Only follow along when the reader is already at the bottom — yanking
    // someone back down while they are scrolled up reading is worse than not
    // following at all.
    const distanceFromBottom = box.scrollHeight - box.clientHeight - box.scrollTop;
    if (distanceFromBottom < FOLLOW_THRESHOLD_PX) box.scrollTop = box.scrollHeight;
  }, [agent.items, agent.status]);

  const submit = () => {
    const text = draft;
    setDraft("");
    void agent.send(text);
  };

  const busy = agent.status === "thinking" || agent.status === "streaming";

  if (!open) {
    return (
      <div className="ar-root" data-theme={props.theme}>
        <button className="ar-launcher" onClick={() => setOpen(true)}>
          {props.launcherLabel ?? `Ask ${props.title ?? agent.identity}`}
        </button>
      </div>
    );
  }

  return (
    <div className="ar-root" data-theme={props.theme}>
      <div className="ar-panel" role="dialog" aria-label="Assistant">
        <header className="ar-header">
          <span>{props.title ?? agent.identity}</span>
          <span className="ar-header-spacer" />
          {agent.modelStatus.local === "unavailable" && agent.debug && (
            <span className="ar-chip" title={agent.modelStatus.detail}>
              on-device unavailable
            </span>
          )}
          {agent.modelStatus.local === "ready" && (
            <span className="ar-chip">
              <span className="ar-chip-dot" />
              on-device
            </span>
          )}
          {debug && agent.modelStatus.cloudFallbackUsed && (
            <span className="ar-chip">cloud fallback</span>
          )}
          <button
            className="ar-icon-button"
            onClick={() => {
              agent.newConversation();
              setShowHistory(false);
            }}
            title="New chat"
            aria-label="New chat"
          >
            ＋
          </button>
          <button
            className="ar-icon-button"
            onClick={() => setShowHistory((v) => !v)}
            title="Past chats"
            aria-label="Past chats"
          >
            chats{agent.conversations.length ? ` (${agent.conversations.length})` : ""}
          </button>
          {debug && (
            <button
              className="ar-icon-button"
              onClick={() => setShowDebug((v) => !v)}
              title="Runtime trace"
            >
              {showDebug ? "hide trace" : "trace"}
            </button>
          )}
          <button className="ar-icon-button" onClick={() => setOpen(false)} title="Close">
            ✕
          </button>
        </header>

        {showHistory && <ConversationList onPick={() => setShowHistory(false)} />}

        {agent.modelStatus.local === "loading" && <ModelLoader />}

        <div className="ar-messages" ref={scroller}>
          {agent.items.length === 0 && (
            <div className="ar-empty">
              Ask about this page, or tell me what you want to do. I can only use
              this product's own documentation, data and actions.
              {props.suggestions?.length ? (
                <div className="ar-suggestions">
                  {props.suggestions.map((s) => (
                    <button
                      key={s}
                      className="ar-suggestion"
                      onClick={() => void agent.send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          )}

          {agent.items.map((item) => (
            <Item key={item.id} item={item} />
          ))}

          {agent.status === "thinking" && <Thinking />}
        </div>

        {showDebug && debug && <DebugPanel />}

        <div className="ar-composer">
          <textarea
            className="ar-input"
            rows={1}
            value={draft}
            placeholder={props.placeholder ?? "Ask or instruct…"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!busy) submit();
              }
            }}
          />
          <button
            className="ar-button ar-button-primary"
            onClick={submit}
            disabled={busy || !draft.trim()}
          >
            Send
          </button>
        </div>

        <PoweredBy />
      </div>
    </div>
  );
}

/**
 * The runtime's mark: a speech bubble around a command prompt.
 *
 * Drawn in `currentColor` so it takes the surrounding text colour and needs no
 * asset, no network request and no theme of its own.
 */
export function AgentRuntimeMark({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="ar-mark"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 3.2h12a3.8 3.8 0 0 1 3.8 3.8v6.4a3.8 3.8 0 0 1-3.8 3.8h-6.1L6.6 21v-3.8H6A3.8 3.8 0 0 1 2.2 13.4V7A3.8 3.8 0 0 1 6 3.2Z" />
      <path d="m8.6 8 2.7 2.3-2.7 2.3" />
      <path d="M13.4 13h4" />
    </svg>
  );
}

/**
 * Attribution. Always shown, and not configurable.
 *
 * Using this package means carrying its name. There is no prop to relabel it,
 * repoint it or switch it off — those existed briefly and were removed on
 * purpose, so that every deployment carries the same mark to the same place.
 */
function PoweredBy() {
  return (
    <a
      className="ar-powered"
      href={POWERED_BY_HREF}
      target="_blank"
      rel="noreferrer noopener"
    >
      <AgentRuntimeMark />
      <span>Powered by {POWERED_BY_LABEL}</span>
    </a>
  );
}

/**
 * Where the answer came from.
 *
 * The runtime knows precisely which documentation it used, so the answer can
 * point at it. That turns a claim into something the reader can check, and
 * gives them the obvious next step.
 */
/**
 * The answers to the assistant's own question.
 *
 * Clicking one sends its label as an ordinary message — the same thing typing
 * it would do — so there is no second, privileged path into the runtime.
 */
function Choices({ choices }: { choices: Choice[] }) {
  const agent = useAgent();
  return (
    <div className="ar-choices">
      {choices.map((choice) => (
        <button
          key={choice.value}
          type="button"
          className="ar-choice"
          onClick={() => void agent.send(choice.label)}
        >
          {choice.label}
          {choice.hint ? <span className="ar-choice-hint">{choice.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}

function Sources({ sources }: { sources: AnswerSource[] }) {
  const agent = useAgent();
  const best = sources[0];
  if (!best) return null;

  return (
    <div className="ar-source">
      <div className="ar-source-kicker">From the docs</div>
      <div className="ar-source-title">{best.title}</div>
      <div className="ar-source-meta">{best.source}</div>
      {best.url && (
        <button
          className="ar-button ar-source-open"
          onClick={() => void agent.open(best.url!)}
        >
          Open page
        </button>
      )}
      {sources.length > 1 && (
        <div className="ar-source-more">
          also: {sources.slice(1, 3).map((s) => s.title).join(", ")}
        </div>
      )}
    </div>
  );
}

function ConversationList({ onPick }: { onPick: () => void }) {
  const agent = useAgent();
  if (!agent.conversations.length) {
    return <div className="ar-history ar-history-empty">No past chats yet.</div>;
  }
  return (
    <div className="ar-history">
      {agent.conversations.map((conversation) => (
        <div
          key={conversation.id}
          className={`ar-history-row${
            conversation.id === agent.conversationId ? " ar-history-current" : ""
          }`}
        >
          <button
            className="ar-history-open"
            onClick={() => {
              agent.selectConversation(conversation.id);
              onPick();
            }}
          >
            <span className="ar-history-title">{conversation.title}</span>
            <span className="ar-history-when">
              {relativeTime(conversation.updatedAt)} · {conversation.messageCount}{" "}
              {conversation.messageCount === 1 ? "message" : "messages"}
            </span>
          </button>
          <button
            className="ar-icon-button"
            title="Delete chat"
            aria-label={`Delete ${conversation.title}`}
            onClick={() => agent.deleteConversation(conversation.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

function relativeTime(at: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

/**
 * A 280MB download deserves more than a spinner. Shows real progress, and says
 * plainly that the assistant is usable in the meantime — because it is.
 */
function ModelLoader() {
  const { modelStatus } = useAgent();
  const progress = modelStatus.progress ?? 0;
  const known = progress > 0.001;

  return (
    <div className="ar-loader">
      <div className="ar-loader-row">
        <span className="ar-loader-title">Setting up the on-device model</span>
        {known && <span className="ar-loader-pct">{Math.round(progress * 100)}%</span>}
      </div>
      <div className={`ar-progress${known ? "" : " ar-progress-idle"}`}>
        <div className="ar-progress-fill" style={known ? { width: `${progress * 100}%` } : undefined} />
      </div>
      <div className="ar-loader-note">
        {modelStatus.detail ? `${modelStatus.detail} · ` : ""}
        Downloading once, then cached on this device. You can chat now — answers come from
        the server until it's ready.
      </div>
    </div>
  );
}

/** Names the stage that is actually running, rather than a generic spinner. */
const STAGE_LABELS: Record<string, string> = {
  retrieval: "Looking through the docs",
  route: "Working out what you need",
  extract: "Filling in the details",
  explain: "Writing the answer",
  answer: "Writing the answer",
};

function Thinking() {
  const { activeStage, debug } = useAgent();
  const label = (activeStage && STAGE_LABELS[activeStage.stage]) ?? "Thinking";
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="ar-thinking">
      <span className="ar-dots">
        <span className="ar-dot" />
        <span className="ar-dot" />
        <span className="ar-dot" />
      </span>
      <span>{label}</span>
      {elapsed >= 1 && <span className="ar-thinking-where">{elapsed}s</span>}
      {debug && activeStage?.provider && (
        <span className="ar-thinking-where">· {activeStage.provider}</span>
      )}
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  const agent = useAgent();

  if (item.kind === "user") {
    return <div className="ar-msg ar-msg-user">{item.text}</div>;
  }

  if (item.kind === "assistant") {
    return (
      <>
        <div className="ar-msg ar-msg-assistant">
          {item.text}
          {item.streaming && <span className="ar-cursor">▍</span>}
        </div>
        {!item.streaming && item.choices?.length ? (
          <Choices choices={item.choices} />
        ) : null}
        {!item.streaming && item.sources?.length ? <Sources sources={item.sources} /> : null}
      </>
    );
  }

  if (item.kind === "error") {
    return (
      <div className="ar-error">
        <div className="ar-error-title">{item.error.code}</div>
        {agent.debug ? (
          // message already carries the hint; appending it again duplicates it
          <pre>{item.error.message}</pre>
        ) : (
          <div className="ar-card-body">Something went wrong with that request.</div>
        )}
      </div>
    );
  }

  if (item.kind === "result") return <ResultCard item={item} />;

  return <ProposalCard item={item} />;
}

/**
 * Renders what an action returned.
 *
 * Deliberately generic: the runtime has no idea what an "event" or an
 * "invoice" is, and inventing per-type components would put product knowledge
 * in the wrong place. Rows come straight from the data the application chose
 * to return.
 */
function ResultCard({ item }: { item: Extract<ChatItem, { kind: "result" }> }) {
  const agent = useAgent();
  const rows = toRows(item.outcome.data);
  if (!rows.length) return null;
  const shown = rows.slice(0, 6);

  return (
    <div className="ar-result">
      {shown.map((row, index) => {
        const body = (
          <>
            <div className="ar-result-label">{row.label}</div>
            {row.meta.length > 0 && <div className="ar-result-meta">{row.meta.join(" · ")}</div>}
          </>
        );
        // A record that carries a url knows where it lives in the app. Linking
        // it turns an answer into a way to get there.
        return row.url ? (
          <button
            className="ar-result-row ar-result-link"
            key={index}
            onClick={() => agent.open(row.url!)}
          >
            {body}
            <span className="ar-result-go">Open →</span>
          </button>
        ) : (
          <div className="ar-result-row" key={index}>
            {body}
          </div>
        );
      })}
      {rows.length > shown.length && (
        <div className="ar-result-more">and {rows.length - shown.length} more</div>
      )}
    </div>
  );
}

interface ResultRow {
  label: string;
  meta: string[];
  /** Where this record lives in the application, when it says so. */
  url?: string;
}

/** Field names that read as the thing itself rather than a detail about it. */
const LABEL_FIELDS = [
  "place", "name", "title", "label", "email", "number", "summary", "description", "id",
];

function toRows(data: unknown): ResultRow[] {
  if (Array.isArray(data)) return data.map(toRow).filter((r): r is ResultRow => r !== null);
  const single = toRow(data);
  return single ? [single] : [];
}

function toRow(value: unknown): ResultRow | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object") return { label: String(value), meta: [] };

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== null && v !== undefined && typeof v !== "object"
  );
  if (!entries.length) return null;

  // Opaque identifiers make terrible headings. Prefer a named field, then any
  // text that is not an id, and only fall back to the first entry.
  const named = LABEL_FIELDS.find((field) => entries.some(([key]) => key === field));
  const readable = entries.find(
    ([key, v]) => typeof v === "string" && !/id$/i.test(key) && v.length > 1
  );
  const labelKey = named ?? readable?.[0] ?? entries[0]![0];
  const label = String(entries.find(([key]) => key === labelKey)?.[1] ?? "");

  const meta = entries
    .filter(([key]) => key !== labelKey && !/^(id|url|href|link|path|sourceurl)$/i.test(key))
    .slice(0, 3)
    .map(([key, v]) => {
      // "depthKm: 32" reads as "32 km deep", not "Depth km 32".
      const unit = key.match(/^(.*?)(Km|Kg|Ms|Mb|Gb|Hz|Pct)$/);
      return unit
        ? `${humanise(unit[1]!)} ${formatValue(v)} ${unit[2]!.toLowerCase()}`
        : `${humanise(key)} ${formatValue(v)}`;
    });

  const url = Object.entries(value as Record<string, unknown>).find(
    ([key, v]) => /^(url|href|link|path)$/i.test(key) && typeof v === "string"
  )?.[1] as string | undefined;

  return { label: label || humanise(labelKey), meta, ...(url ? { url } : {}) };
}

function humanise(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toUTCString().slice(5, 16);
  }
  return String(value);
}

/**
 * Confirmation is structured UI with a typed payload behind it. The user
 * clicks a button; they never have to type "yes" and the runtime never has to
 * interpret prose as consent.
 */
function ProposalCard({
  item,
}: {
  item: Extract<ChatItem, { kind: "proposal" }>;
}) {
  const agent = useAgent();
  const { proposal, status } = item;
  const destructive = isDestructive(proposal);

  if (status === "pending") {
    // A safe browser action is an offer, not a decision to sign off. It gets a
    // single button and no "are you sure" framing.
    const offered = proposal.permission === "auto" && proposal.side === "client";
    return (
      <div className={`ar-card${offered ? " ar-card-offer" : " ar-card-confirm"}`}>
        <div className="ar-card-title">{proposal.description}</div>
        {!offered && (
          <div className="ar-card-body">
            <ArgumentList proposal={proposal} />
          </div>
        )}
        <div className="ar-card-actions">
          {!offered && (
            <button className="ar-button" onClick={() => void agent.decline(item.id)}>
              Cancel
            </button>
          )}
          <button
            className={`ar-button ${destructive ? "ar-button-danger" : "ar-button-primary"}`}
            onClick={() => void agent.approve(item.id)}
          >
            {offered ? (proposal.confirmLabel ?? "Open") : proposal.confirmLabel}
          </button>
        </div>
      </div>
    );
  }

  const label =
    status === "declined"
      ? "Cancelled"
      : status === "running"
        ? "Working…"
        : status === "failed"
          ? "Failed"
          : status === "expired"
            ? "Expired"
            : "Done";

  return (
    <div className="ar-card">
      <div className="ar-card-title">
        {label} — {proposal.description}
      </div>
      {item.outcome?.error && (
        <div className="ar-card-body">{item.outcome.error.message}</div>
      )}
      {item.outcome?.summary && !item.outcome.error && (
        <div className="ar-card-body">{item.outcome.summary}</div>
      )}
    </div>
  );
}

function ArgumentList({ proposal }: { proposal: ActionProposal }) {
  const entries = Object.entries(proposal.input);
  if (!entries.length) return <span>{proposal.action}</span>;
  return (
    <>
      {entries.map(([key, value]) => (
        <div key={key} className="ar-debug-row">
          <span>{key}</span>
          <span className="ar-kv">{JSON.stringify(value)}</span>
        </div>
      ))}
    </>
  );
}

function isDestructive(proposal: ActionProposal): boolean {
  return /delete|remove|cancel|destroy|revoke|purge/i.test(proposal.action);
}
