"use client";

import { useEffect, useRef, useState } from "react";
import { useAgent } from "./context.js";
import { injectStyles } from "./styles.js";
import { DebugPanel } from "./DebugPanel.js";
import {
  AgentRuntimeMark,
  ConversationList,
  FOLLOW_THRESHOLD_PX,
  Item,
  ModelLoader,
  PoweredBy,
  Thinking,
} from "./parts.js";

export interface AgentChatProps {
  title?: string;
  placeholder?: string;
  /** Prompts shown on the empty state. Good ones teach the capability surface. */
  suggestions?: string[];
  /** Render open on mount. */
  defaultOpen?: boolean;
  launcherLabel?: string;
  /** The line under the title. Says what this assistant is for. */
  subtitle?: string;
  /**
   * Which palette to use. Defaults to the operating system preference; set it
   * when the host application themes itself, so the panel follows the page
   * rather than the OS. "system" restores the default behaviour.
   */
  theme?: "light" | "dark" | "system";
}


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
          <span className="ar-brand">
            <AgentRuntimeMark size={15} />
          </span>
          <span className="ar-titles">
            <span className="ar-title">{props.title ?? agent.identity}</span>
            <span className="ar-subtitle">
              {props.subtitle ?? "Ask about this page, or tell me what to do"}
            </span>
          </span>
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
              <span className="ar-empty-mark">
                <AgentRuntimeMark size={26} />
              </span>
              <span className="ar-empty-title">{props.title ?? agent.identity}</span>
              <span className="ar-empty-lead">How can I help you today?</span>
              <span className="ar-empty-note">
                I can only use this product's own documentation, data and actions.
              </span>
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
            <Item key={item.id} item={item} agentName={props.title ?? agent.identity} />
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
            className="ar-send"
            onClick={submit}
            disabled={busy || !draft.trim()}
            title="Send"
            aria-label="Send"
          >
            ↑
          </button>
        </div>

        <footer className="ar-footer">
          <span className="ar-hint">Enter to send · Shift ↵ for a new line</span>
          <PoweredBy />
        </footer>
      </div>
    </div>
  );
}

