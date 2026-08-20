"use client";

/**
 * The pieces a conversation is made of, shared by every layout.
 *
 * `AgentChat` (a corner panel) and `AgentPage` (a full page) differ only in
 * their chrome — the turns, cards, choices, sources, loader and attribution
 * are the same in both, and forking them would guarantee they drift.
 */

import { useEffect, useState, type ReactNode } from "react";
import type { ActionProposal, AnswerSource, Choice } from "@agent-runtime/core";
import { useAgent, type ChatItem } from "./context.js";

export const POWERED_BY_HREF = "https://github.com/fil-technology/agent-runtime-for-the-web";
export const POWERED_BY_LABEL = "Agent Runtime";

/** How close to the bottom counts as "still following the conversation". */
export const FOLLOW_THRESHOLD_PX = 140;

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
export function PoweredBy() {
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

export function ConversationList({ onPick }: { onPick: () => void }) {
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
export function ModelLoader() {
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

export function Thinking() {
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
      <span className="ar-avatar">
        <AgentRuntimeMark size={12} />
      </span>
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

/** "Today 12:29AM" — a time only, because a chat panel is a today-shaped thing. */
function when(at: number | undefined): string {
  if (!at) return "";
  const then = new Date(at);
  const time = then.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const sameDay = new Date().toDateString() === then.toDateString();
  return sameDay ? `Today ${time}` : `${then.toLocaleDateString()} ${time}`;
}

export function Turn({ who, at, children }: { who: string; at?: number; children: ReactNode }) {
  return (
    <div className="ar-turn">
      <div className="ar-turn-meta">
        <span>{who}</span>
        <span className="ar-turn-time">{when(at)}</span>
      </div>
      {children}
    </div>
  );
}

export function Item({ item, agentName }: { item: ChatItem; agentName: string }) {
  const agent = useAgent();

  if (item.kind === "user") {
    return (
      <Turn who="You" at={item.at}>
        <div className="ar-msg ar-msg-user">{item.text}</div>
      </Turn>
    );
  }

  if (item.kind === "assistant") {
    return (
      <Turn who={agentName} at={item.at}>
        <div className="ar-said">
          <span className="ar-avatar">
            <AgentRuntimeMark size={12} />
          </span>
          <div className="ar-msg ar-msg-assistant">
            {item.text}
            {item.streaming && <span className="ar-cursor">▍</span>}
          </div>
        </div>
        {!item.streaming && item.choices?.length ? (
          <Choices choices={item.choices} />
        ) : null}
        {!item.streaming && item.sources?.length ? <Sources sources={item.sources} /> : null}
      </Turn>
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

  // Cards come from the assistant too, and a block with no attribution reads
  // as though it arrived from nowhere.
  if (item.kind === "result") {
    return (
      <Turn who={agentName} at={item.at}>
        <ResultCard item={item} />
      </Turn>
    );
  }

  return (
    <Turn who={agentName} at={item.at}>
      <ProposalCard item={item} />
    </Turn>
  );
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
