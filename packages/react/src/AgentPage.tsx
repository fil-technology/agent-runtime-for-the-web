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

export interface AgentPageProps {
  title?: string;
  /** The line under the title. Says what this assistant is for. */
  subtitle?: string;
  placeholder?: string;
  /** Prompts shown on the empty state. Good ones teach the capability surface. */
  suggestions?: string[];
  /**
   * Which palette to use. Defaults to the operating system preference; set it
   * when the host application themes itself.
   */
  theme?: "light" | "dark" | "system";
  /**
   * Show past conversations in a column beside the thread.
   *
   * On by default: a page has the room, and a full-page assistant that cannot
   * reach yesterday's conversation is a worse product than the corner panel it
   * replaced. Hidden automatically on narrow screens.
   */
  sidebar?: boolean;
}

/**
 * The assistant as a page of its own, rather than a panel in the corner.
 *
 * Mount it on a route and give it a container with a height — it fills what it
 * is given rather than positioning itself, so it drops into a layout that
 * already has a header or navigation without fighting it.
 *
 * Everything inside is the same as the panel: same turns, same confirmation
 * cards, same permission engine behind them. Only the chrome differs.
 */
export function AgentPage(props: AgentPageProps) {
  const agent = useAgent();
  const [draft, setDraft] = useState("");
  const [showDebug, setShowDebug] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const debug = agent.debug;
  const withSidebar = props.sidebar !== false;
  const title = props.title ?? agent.identity;

  useEffect(() => injectStyles(), []);

  // Follow the conversation only while the reader is already at the bottom;
  // yanking them away from something they scrolled up to read is worse than
  // missing a message.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !following.current) return;
    el.scrollTop = el.scrollHeight;
  }, [agent.items, agent.status]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    following.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_THRESHOLD_PX;
  };

  const submit = () => {
    const text = draft;
    setDraft("");
    following.current = true;
    void agent.send(text);
  };

  const busy = agent.status === "thinking" || agent.status === "streaming";

  return (
    <div className="ar-root ar-root-page" data-theme={props.theme}>
      <div className="ar-page">
        {withSidebar && (
          <aside className="ar-side">
            <button className="ar-new" onClick={() => agent.newConversation()}>
              ＋ New chat
            </button>
            <ConversationList onPick={() => undefined} />
          </aside>
        )}

        <main className="ar-main">
          <header className="ar-page-header">
            <span className="ar-brand">
              <AgentRuntimeMark size={15} />
            </span>
            <span className="ar-titles">
              <span className="ar-title">{title}</span>
              <span className="ar-subtitle">
                {props.subtitle ?? "Ask about this product, or tell me what to do"}
              </span>
            </span>
            <span className="ar-header-spacer" />
            {agent.modelStatus.local === "ready" && (
              <span className="ar-chip">
                <span className="ar-chip-dot" />
                on-device
              </span>
            )}
            {debug && (
              <button
                className="ar-icon-button"
                onClick={() => setShowDebug((v) => !v)}
                title="Runtime trace"
              >
                {showDebug ? "hide trace" : "trace"}
              </button>
            )}
          </header>

          {agent.modelStatus.local === "loading" && <ModelLoader />}

          <div className="ar-messages ar-page-messages" ref={scroller} onScroll={onScroll}>
            <div className="ar-column">
              {agent.items.length === 0 && (
                <div className="ar-empty ar-empty-page">
                  <span className="ar-empty-mark">
                    <AgentRuntimeMark size={30} />
                  </span>
                  <span className="ar-empty-title">{title}</span>
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
                <Item key={item.id} item={item} agentName={title} />
              ))}

              {agent.status === "thinking" && <Thinking />}
            </div>
          </div>

          {showDebug && debug && <DebugPanel />}

          <div className="ar-page-foot">
            <div className="ar-column">
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
        </main>
      </div>
    </div>
  );
}
