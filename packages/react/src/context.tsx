"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import {
  AgentRuntime,
  agentFromManifest,
  type ActionOutcome,
  type ActionProposal,
  type AnswerSource,
  type AgentEvent,
  type ChatMessage,
  type ClientActionHandlers,
  type ModelProvider,
  type PageState,
  type PendingClarification,
  type RecallState,
  type RuntimeRequest,
  type Trace,
  type Choice,
} from "@agent-runtime/core";
import { callAgent, fetchContext, fetchManifest, streamAgent } from "./transport.js";
import {
  createLocalConversationStore,
  deriveTitle,
  type ConversationStore,
  type ConversationSummary,
} from "./conversations.js";

export type ChatItem =
  | { id: string; kind: "user"; text: string }
  | {
      id: string;
      kind: "assistant";
      text: string;
      streaming: boolean;
      /** Documentation this answer drew on. */
      sources?: AnswerSource[];
      /** Answers to a question the assistant asked, offered as choices. */
      choices?: Choice[];
    }
  | {
      id: string;
      kind: "proposal";
      proposal: ActionProposal;
      status: "pending" | "running" | "done" | "failed" | "declined" | "expired";
      outcome?: ActionOutcome;
    }
  | {
      id: string;
      kind: "error";
      error: { code: string; message: string; hint?: string };
    }
  /** Structured data an action returned, rendered as elements rather than prose. */
  | { id: string; kind: "result"; action: string; outcome: ActionOutcome };

export type AgentStatus = "idle" | "thinking" | "streaming" | "awaiting-confirmation";

/** What the runtime is doing right now, for live feedback. */
export interface ActiveStage {
  stage: string;
  provider?: string;
}

export interface ModelStatus {
  /** Human readable state of the browser model, if one is configured. */
  local: "none" | "loading" | "ready" | "unavailable";
  detail?: string;
  /** Download progress 0..1 while weights are being fetched. */
  progress?: number;
  /** Provider that served the most recent stage. */
  lastProvider?: string;
  cloudFallbackUsed: boolean;
}

export interface AgentProviderProps {
  children: ReactNode;
  /** Route created with createAgentRoute(). */
  endpoint?: string;
  /** Semantic page state. This is how the product tells the agent what "this" means. */
  page?: PageState;
  /** Browser-side implementations of clientAction() definitions. */
  clientActions?: ClientActionHandlers;
  /** Called by the built-in navigate handler. Defaults to location.assign. */
  onNavigate?: (path: string) => void;
  /**
   * Browser model providers. Supplying any switches the reasoning loop into
   * the browser; the server still executes and authorizes every action.
   */
  providers?: ModelProvider[];
  mode?: "server" | "local-first";
  debug?: boolean;
  /**
   * Where past conversations are kept. Defaults to this device's
   * localStorage; pass false to keep nothing, or your own store to sync.
   */
  storage?: ConversationStore | false;
  /** Separates stored conversations when several apps share an origin. */
  namespace?: string;
  /**
   * How long the thinking indicator stays up before the answer lands, in ms.
   *
   * The deterministic provider answers in single-digit milliseconds. Without a
   * floor the reply simply appears, which reads as a canned string rather than
   * something worked out — and a turn that did real work looks identical to
   * one that did none. This holds the *display*, never the work: the request
   * has already finished, and a slow answer is never delayed past its own
   * arrival. Set 0 to show answers the instant they exist.
   */
  minThinkingMs?: number;
  /**
   * Whether safe browser actions run the moment they are proposed.
   *
   * Defaults to false: navigating someone away from what they were reading,
   * without being asked to, is startling even when the destination is right.
   * The action is offered as a card they can click instead.
   */
  autoRunClientActions?: boolean;
  headers?: Record<string, string>;
}

interface AgentContextValue {
  items: ChatItem[];
  status: AgentStatus;
  /** Past conversations, most recently updated first. */
  conversations: ConversationSummary[];
  conversationId: string;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  /** The pipeline stage currently running, or undefined when idle. */
  activeStage?: ActiveStage;
  traces: Trace[];
  /** Errors the runtime recovered from. Shown in the debug panel only. */
  diagnostics: Array<{ code: string; message: string; hint?: string }>;
  modelStatus: ModelStatus;
  debug: boolean;
  identity: string;
  page: PageState;
  send: (message: string) => Promise<void>;
  approve: (itemId: string) => Promise<void>;
  decline: (itemId: string) => Promise<void>;
  clear: () => void;
  setPage: (patch: PageState) => void;
  /** Follow a documentation link, through the app's own router where possible. */
  open: (url: string) => void;
}

const AgentReactContext = createContext<AgentContextValue | null>(null);

export function useAgent(): AgentContextValue {
  const value = useContext(AgentReactContext);
  if (!value) {
    throw new Error(
      "useAgent() was called outside <AgentProvider>. Wrap your app:\n\n" +
        "  <AgentProvider page={{ id: 'project.settings', projectId }}>\n" +
        "    {children}\n" +
        "    <AgentChat />\n" +
        "  </AgentProvider>"
    );
  }
  return value;
}

/**
 * Publishes page state from a route segment.
 *
 * The keys are cleared when the component unmounts. Without that, "this
 * project" keeps resolving to the last project you visited long after you have
 * navigated away — stale context is worse than no context, because it is
 * confidently wrong.
 */
export function useAgentPage(patch: PageState): void {
  const { setPage } = useAgent();
  const serialized = JSON.stringify(patch);
  useEffect(() => {
    const value = JSON.parse(serialized) as PageState;
    setPage(value);
    return () => {
      setPage(
        Object.fromEntries(Object.keys(value).map((key) => [key, undefined])) as PageState
      );
    };
  }, [serialized, setPage]);
}

declare const process: { env?: Record<string, string | undefined> } | undefined;

/**
 * Written as a literal `process.env.NODE_ENV` on purpose: bundlers only
 * substitute that exact expression. Reading it dynamically leaves it undefined
 * in the browser, which silently turns debug on in production builds and
 * desynchronises the server and client renders.
 */
function readNodeEnv(): string | undefined {
  return typeof process !== "undefined" ? process?.env?.NODE_ENV : undefined;
}

/** Whether this data will actually render as elements. */
function hasRows(data: unknown): boolean {
  if (data === undefined || data === null) return false;
  if (Array.isArray(data)) return data.length > 0;
  if (typeof data === "object") return Object.keys(data as object).length > 0;
  return true;
}

/** True when the prose adds nothing the rendered elements did not already say. */
function restates(answer: string, summary: string): boolean {
  const normalise = (value: string) =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const a = normalise(answer);
  const b = normalise(summary);
  return Boolean(b) && (a === b || a.startsWith(b) || b.startsWith(a));
}

/** Long enough to read as a step, short enough not to feel like waiting. */
const DEFAULT_MIN_THINKING_MS = 450;

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${++counter}`;

export function AgentProvider(props: AgentProviderProps) {
  const endpoint = props.endpoint ?? "/api/agent";
  const debug = props.debug ?? readNodeEnv() !== "production";
  const localFirst = props.mode === "local-first" || (props.providers?.length ?? 0) > 0;

  const store = useMemo<ConversationStore | undefined>(() => {
    if (props.storage === false) return undefined;
    return props.storage ?? createLocalConversationStore({ namespace: props.namespace });
  }, [props.storage, props.namespace]);

  const [items, setItems] = useState<ChatItem[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationId, setConversationId] = useState(() => nextId("chat"));
  const createdAt = useRef(Date.now());
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [traces, setTraces] = useState<Trace[]>([]);
  const [activeStage, setActiveStage] = useState<ActiveStage | undefined>();
  const [recovered, setRecovered] = useState<
    Array<{ code: string; message: string; hint?: string; recoverable?: boolean }>
  >([]);
  const [identity, setIdentity] = useState("Assistant");
  const [page, setPageState] = useState<PageState>(props.page ?? {});
  const [modelStatus, setModelStatus] = useState<ModelStatus>({
    local: localFirst ? "loading" : "none",
    cloudFallbackUsed: false,
  });

  const lastUserMessage = useRef("");
  const pageRef = useRef(page);
  pageRef.current = page;
  const localRuntime = useRef<AgentRuntime | null>(null);
  // The question the runtime last asked, so the next message answers it.
  const pendingQuestion = useRef<PendingClarification | undefined>(undefined);
  const shownProposals = useRef(new Set<string>());
  // The last thing an action returned, so "what depth?" can be answered from
  // it instead of re-running anything.
  const recall = useRef<RecallState | undefined>(undefined);

  useEffect(() => {
    if (props.page) setPageState((current) => ({ ...current, ...props.page }));
  }, [JSON.stringify(props.page ?? {})]);

  /** Undefined values remove a key rather than pinning it to undefined. */
  const setPage = useCallback((patch: PageState) => {
    setPageState((current) => {
      const next = { ...current, ...patch };
      for (const [key, value] of Object.entries(next)) {
        if (value === undefined) delete next[key];
      }
      return next;
    });
  }, []);

  const clientActions = useMemo<ClientActionHandlers>(() => {
    const navigate = (input: any) => {
      const path = String(input?.path ?? input?.url ?? "/");
      if (props.onNavigate) props.onNavigate(path);
      else if (typeof window !== "undefined") window.location.assign(path);
      return { navigatedTo: path };
    };
    return { navigate, openPage: navigate, ...(props.clientActions ?? {}) };
  }, [props.clientActions, props.onNavigate]);
  const clientActionsRef = useRef(clientActions);
  clientActionsRef.current = clientActions;

  /* ---------------------------- conversations ------------------------------ */

  useEffect(() => {
    if (!store) return;
    void (async () => setConversations(await store.list()))();
  }, [store]);

  useEffect(() => {
    if (!store || !items.length) return;
    const record = {
      id: conversationId,
      title: deriveTitle(items),
      createdAt: createdAt.current,
      updatedAt: Date.now(),
      messageCount: items.filter((i) => i.kind === "user" || i.kind === "assistant").length,
      items,
    };
    void (async () => {
      await store.save(record);
      setConversations(await store.list());
    })();
  }, [store, items, conversationId]);

  const newConversation = useCallback(() => {
    setItems((current) => {
      if (!current.length) return current;
      setConversationId(nextId("chat"));
      createdAt.current = Date.now();
      return [];
    });
    setStatus("idle");
    setActiveStage(undefined);
    pendingQuestion.current = undefined;
    shownProposals.current = new Set();
    recall.current = undefined;
    lastUserMessage.current = "";
  }, []);

  const selectConversation = useCallback(
    (id: string) => {
      if (!store || id === conversationId) return;
      void (async () => {
        const record = await store.load(id);
        if (!record) return;
        setConversationId(record.id);
        createdAt.current = record.createdAt;
        // A confirmation is consent in the moment. Restoring one as still
        // clickable would let a stale intent act on a page the user has since
        // left, so it comes back as expired.
        setItems(
          record.items.map((item) =>
            item.kind === "proposal" && item.status === "pending"
              ? { ...item, status: "expired" as const }
              : item
          )
        );
        setStatus("idle");
        setActiveStage(undefined);
        pendingQuestion.current = undefined;
        shownProposals.current = new Set();
        recall.current = undefined;
        lastUserMessage.current = "";
      })();
    },
    [store, conversationId]
  );

  const deleteConversation = useCallback(
    (id: string) => {
      if (!store) return;
      void (async () => {
        await store.remove(id);
        setConversations(await store.list());
        if (id === conversationId) {
          setConversationId(nextId("chat"));
          createdAt.current = Date.now();
          setItems([]);
        }
      })();
    },
    [store, conversationId]
  );

  /* ------------------------ local-first runtime boot ----------------------- */

  // Providers are frequently supplied asynchronously (a dynamic import, a
  // capability check). Keying the boot effect on their identity means a
  // provider that arrives late is picked up instead of silently ignored.
  const providerKey = (props.providers ?? []).map((p) => p.id).join(",");

  useEffect(() => {
    if (!localFirst) return;
    if (!(props.providers ?? []).length) {
      setModelStatus((s) => ({ ...s, local: "loading", detail: "waiting for providers" }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setModelStatus((s) => ({ ...s, local: "loading" }));
        const manifest = await fetchManifest(endpoint);
        if (cancelled) return;
        setIdentity(manifest.identity);
        const agent = agentFromManifest(manifest, {
          clientActions: clientActionsRef.current,
          execute: async ({ action, arguments: args }) => {
            const response = await callAgent(
              {
                kind: "execute",
                action,
                arguments: args,
                page: pageRef.current,
                // The browser-side permission engine already cleared this
                // call; the server re-checks it and remains the authority.
                confirmed: true,
              } as RuntimeRequest,
              { endpoint, headers: props.headers }
            );
            const outcome = response.outcomes?.[0];
            if (!outcome) {
              throw new Error(
                response.error?.message ?? `Server did not execute "${action}".`
              );
            }
            if (!outcome.ok) throw new Error(outcome.error?.message ?? "Action failed");
            return { data: outcome.data, summary: outcome.summary };
          },
        });
        // Warm providers up, but never block the assistant on it. A large
        // on-device model can take minutes to fetch; the runtime awaits it
        // lazily on first use, and until then the router simply prefers
        // whichever provider is ready.
        for (const provider of props.providers ?? []) {
          void provider.preload?.().catch(() => undefined);
        }
        if (cancelled) return;
        localRuntime.current = new AgentRuntime({
          agent,
          providers: props.providers ?? [],
          debug,
        });
        // Poll until an on-device provider is actually warm, so the chip can
        // show real progress instead of an indefinite spinner. Requests are
        // served by whoever is ready in the meantime.
        const poll = async (): Promise<void> => {
          if (cancelled) return;
          const capabilities = await Promise.all(
            (props.providers ?? []).map((p) => p.capabilities())
          );
          const onDevice = capabilities.filter(
            (c) => c.privacy === "on-device" && c.available
          );
          const warm = onDevice.find((c) => c.readyNow !== false);
          const warming = onDevice.find((c) => c.readyNow === false);

          if (cancelled) return;
          if (warm) {
            setModelStatus((s) => ({
              ...s,
              local: "ready",
              detail: warm.label,
              progress: 1,
            }));
            return;
          }
          if (warming) {
            setModelStatus((s) => ({
              ...s,
              local: "loading",
              detail: warming.label,
              progress: warming.loadProgress ?? 0,
            }));
            setTimeout(() => void poll(), 700);
            return;
          }
          setModelStatus((s) => ({
            ...s,
            local: "unavailable",
            detail: capabilities.find((c) => !c.available)?.unavailableReason,
          }));
        };
        void poll();
      } catch (error) {
        if (cancelled) return;
        setModelStatus((s) => ({
          ...s,
          local: "unavailable",
          detail: (error as Error).message,
        }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint, localFirst, debug, providerKey]);

  /* ------------------------------ event loop ------------------------------- */

  const history = useCallback((): ChatMessage[] => {
    return items
      .filter((i): i is Extract<ChatItem, { kind: "user" | "assistant" }> =>
        i.kind === "user" || i.kind === "assistant"
      )
      .map<ChatMessage>((i) => ({
        role: i.kind === "user" ? "user" : "assistant",
        content: i.text,
      }))
      .slice(-8);
  }, [items]);

  const consume = useCallback(
    async (request: RuntimeRequest) => {
      setStatus("thinking");
      const startedAt = Date.now();
      let settled = false;
      /** Hold the first visible output until the indicator has been legible. */
      const settle = async () => {
        if (settled) return;
        settled = true;
        const remaining = (props.minThinkingMs ?? DEFAULT_MIN_THINKING_MS) - (Date.now() - startedAt);
        if (remaining > 0) await new Promise((r) => setTimeout(r, remaining));
      };
      // Consumed by this request; a new one is set only if we are asked again.
      if (request.kind === "message" && !request.pending) {
        pendingQuestion.current = undefined;
      }
      const assistantId = nextId("msg");
      let sawProposal = false;
      let shownAsElements: string | undefined;
      let pendingSources: AnswerSource[] | undefined;
      let pendingChoices: Choice[] | undefined;
      // Proposal ids seen in this turn. Tracked here rather than derived
      // inside a state updater: updaters run lazily, so a flag set inside one
      // is not visible to the event that arrives next.
      // Every proposal this conversation has shown a card for — not just this
      // turn's. Confirming one is a *separate* turn from the one that proposed
      // it, so a per-turn set never matches on the turn that matters and the
      // card would sit on "Working…" forever while its result rendered again
      // underneath as an anonymous element.
      const proposalsThisTurn = shownProposals.current;

      // In local-first mode the loop runs here, so the server resolves the
      // application context up front and the browser runtime treats it as the
      // page state.
      const resolved: RuntimeRequest =
        localFirst && localRuntime.current
          ? {
              ...request,
              page: (await fetchContext(endpoint, request.page ?? {}, {
                headers: props.headers,
              })) as PageState,
            }
          : request;

      const events: AsyncIterable<AgentEvent> =
        localFirst && localRuntime.current
          ? localRuntime.current.stream(resolved)
          : streamAgent(resolved, { endpoint, headers: props.headers });

      try {
        for await (const event of events) {
          switch (event.type) {
            case "stage":
              setActiveStage({ stage: event.stage, provider: event.provider });
              if (event.provider) {
                setModelStatus((s) => ({ ...s, lastProvider: event.provider }));
              }
              break;
            case "delta":
              await settle();
              setStatus("streaming");
              setItems((current) => {
                // Whether the bubble exists is read from `current`, never from a
                // flag set inside this function. React invokes state updaters
                // twice under StrictMode to catch exactly this: a second run
                // would see the flag already set, take the update branch, find
                // nothing to update, and silently drop the message.
                if (!current.some((i) => i.id === assistantId)) {
                  return [
                    ...current,
                    { id: assistantId, kind: "assistant", text: event.text, streaming: true },
                  ];
                }
                return current.map((item) =>
                  item.id === assistantId && item.kind === "assistant"
                    ? { ...item, text: item.text + event.text }
                    : item
                );
              });
              break;
            case "answer":
              await settle();
              // The elements already said it. Repeating the same sentence
              // underneath is noise, not confirmation.
              if (shownAsElements && restates(event.text, shownAsElements)) break;
              setItems((current) => {
                if (!current.some((i) => i.id === assistantId)) {
                  return [
                    ...current,
                    {
                      id: assistantId,
                      kind: "assistant",
                      text: event.text,
                      streaming: false,
                      sources: pendingSources,
                      choices: pendingChoices,
                    },
                  ];
                }
                return current.map((item) =>
                  item.id === assistantId && item.kind === "assistant"
                    ? {
                        ...item,
                        text: event.text,
                        streaming: false,
                        sources: pendingSources,
                        choices: pendingChoices,
                      }
                    : item
                );
              });
              break;
            case "pending":
              pendingQuestion.current = event.pending;
              pendingChoices = event.pending.options?.choices;
              break;
            case "recall":
              recall.current = event.recall;
              break;
            case "sources":
              pendingSources = event.sources;
              break;
            case "proposal": {
              await settle();
              sawProposal = true;
              const proposal = event.proposal;
              proposalsThisTurn.add(proposal.id);
              const itemId = nextId("prop");
              setItems((current) => [
                ...current,
                { id: itemId, kind: "proposal", proposal, status: "pending" },
              ]);
              if (
                proposal.permission === "auto" &&
                proposal.side === "client" &&
                props.autoRunClientActions
              ) {
                void runClientAction(itemId, proposal);
              } else {
                setStatus("awaiting-confirmation");
              }
              break;
            }
            case "outcome": {
              const outcome = event.outcome;
              if (proposalsThisTurn.has(outcome.proposalId)) {
                setItems((current) =>
                  current.map((item) =>
                    item.kind === "proposal" && item.proposal.id === outcome.proposalId
                      ? {
                          ...item,
                          status: outcome.ok ? "done" : "failed",
                          outcome,
                        }
                      : item
                  )
                );
                break;
              }
              // An auto action ran with no confirmation card. If it returned
              // data, show the data — a sentence is a poor way to present a
              // list of things.
              //
              // "Rows" must actually exist: an empty result renders no card, so
              // suppressing the prose as well would leave the turn blank.
              if (!outcome.ok || !hasRows(outcome.data)) break;
              // Suppressing prose is only safe when the elements genuinely say
              // the same thing — a list whose summary enumerates its rows. For
              // a single record the sentence *is* the answer, and dropping it
              // leaves the reader staring at a field dump.
              if (Array.isArray(outcome.data) && outcome.data.length > 1) {
                shownAsElements = outcome.summary;
              }
              await settle();
              const resultId = nextId("res");
              setItems((current) => [
                ...current,
                { id: resultId, kind: "result", action: outcome.action, outcome },
              ]);
              break;
            }
            case "error":
              // Recovered errors are diagnostics: they belong in the trace
              // panel, not in the conversation as a failure the user has to
              // interpret.
              if (!event.error.recoverable) {
                await settle();
                const errorId = nextId("err");
                setItems((current) => [
                  ...current,
                  { id: errorId, kind: "error", error: event.error },
                ]);
              }
              setRecovered((current) => [...current.slice(-9), event.error]);
              break;
            case "trace":
              setTraces((current) => [...current.slice(-19), event.trace]);
              setModelStatus((s) => ({
                ...s,
                cloudFallbackUsed: s.cloudFallbackUsed || event.trace.cloudFallbackUsed,
              }));
              break;
            case "done":
              break;
          }
        }
      } catch (error) {
        const errorId = nextId("err");
        setItems((current) => [
          ...current,
          {
            id: errorId,
            kind: "error",
            error: { code: "TRANSPORT_FAILED", message: (error as Error).message },
          },
        ]);
      } finally {
        setActiveStage(undefined);
        setItems((current) =>
          current.map((item) =>
            item.id === assistantId && item.kind === "assistant"
              ? { ...item, streaming: false }
              : item
          )
        );
        setStatus((s) => (sawProposal && s === "awaiting-confirmation" ? s : "idle"));
      }
    },
    [endpoint, localFirst, props.headers, props.minThinkingMs]
  );

  const runClientAction = useCallback(
    async (itemId: string, proposal: ActionProposal) => {
      const handler = clientActionsRef.current[proposal.action];
      setItems((current) =>
        current.map((i) => (i.id === itemId ? { ...i, status: "running" } : i))
      );
      let ok = true;
      let result: unknown;
      let errorMessage: string | undefined;

      if (!handler) {
        ok = false;
        errorMessage =
          `No browser handler is registered for client action "${proposal.action}".\n` +
          `Add it: <AgentProvider clientActions={{ ${proposal.action}: (input) => { /* ... */ } }} />`;
      } else {
        try {
          result = await handler(proposal.input, { context: {} });
        } catch (error) {
          ok = false;
          errorMessage = (error as Error).message;
        }
      }

      setItems((current) =>
        current.map((i) =>
          i.id === itemId
            ? {
                ...i,
                status: ok ? "done" : "failed",
                outcome: {
                  proposalId: proposal.id,
                  action: proposal.action,
                  side: "client",
                  ok,
                  ms: 0,
                  ...(errorMessage
                    ? { error: { code: "CLIENT_ACTION_FAILED", message: errorMessage } }
                    : {}),
                },
              }
            : i
        )
      );

      await consume({
        kind: "client-result",
        proposal,
        ok,
        result: (result ?? null) as any,
        error: errorMessage,
        message: lastUserMessage.current,
        page: pageRef.current,
        history: history(),
      });
    },
    [consume, history]
  );

  const send = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text) return;
      lastUserMessage.current = text;
      setItems((current) => [...current, { id: nextId("user"), kind: "user", text }]);
      const pending = pendingQuestion.current;
      pendingQuestion.current = undefined;
      await consume({
        kind: "message",
        message: text,
        pending,
        recall: recall.current,
        page: pageRef.current,
        history: history(),
      });
    },
    [consume, history]
  );

  const approve = useCallback(
    async (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item || item.kind !== "proposal") return;
      if (item.proposal.side === "client") {
        await runClientAction(itemId, item.proposal);
        return;
      }
      setItems((current) =>
        current.map((i) => (i.id === itemId ? { ...i, status: "running" } : i))
      );
      await consume({
        kind: "confirm",
        proposal: item.proposal,
        approved: true,
        message: lastUserMessage.current,
        page: pageRef.current,
        history: history(),
      });
    },
    [items, consume, history, runClientAction]
  );

  const decline = useCallback(
    async (itemId: string) => {
      const item = items.find((i) => i.id === itemId);
      if (!item || item.kind !== "proposal") return;
      setItems((current) =>
        current.map((i) => (i.id === itemId ? { ...i, status: "declined" } : i))
      );
      setStatus("idle");
      await consume({
        kind: "confirm",
        proposal: item.proposal,
        approved: false,
        message: lastUserMessage.current,
        page: pageRef.current,
        history: history(),
      });
    },
    [items, consume, history]
  );

  // Prefer the host application's router: a docs link is in-app navigation,
  // not a trip through the network stack.
  const open = useCallback(
    (url: string) => {
      if (/^https?:\/\//i.test(url)) {
        if (typeof window !== "undefined") window.open(url, "_blank", "noopener");
        return;
      }
      if (props.onNavigate) props.onNavigate(url);
      else if (typeof window !== "undefined") window.location.assign(url);
    },
    [props.onNavigate]
  );

  const clear = useCallback(() => {
    setItems([]);
    setActiveStage(undefined);
    setTraces([]);
    setRecovered([]);
    setStatus("idle");
  }, []);

  const value = useMemo<AgentContextValue>(
    () => ({
      items,
      status,
      activeStage,
      conversations,
      conversationId,
      newConversation,
      selectConversation,
      deleteConversation,
      traces,
      diagnostics: recovered,
      modelStatus,
      debug,
      identity,
      page,
      send,
      approve,
      decline,
      clear,
      setPage,
      open,
    }),
    [
      items, status, activeStage, conversations, conversationId, newConversation,
      selectConversation, deleteConversation, traces, recovered, modelStatus, debug,
      identity, page, send, approve, decline, clear, setPage, open,
    ]
  );

  return (
    <AgentReactContext.Provider value={value}>{props.children}</AgentReactContext.Provider>
  );
}
