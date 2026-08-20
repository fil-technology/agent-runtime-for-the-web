import type { ChatItem } from "./context.js";

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface ConversationRecord extends ConversationSummary {
  items: ChatItem[];
}

/**
 * Where conversations are kept.
 *
 * The runtime is stateless — history travels with each request — so
 * conversations are purely a client concern. The default keeps them on the
 * device, which means no database, no user table, and nothing leaving the
 * browser. Swap in your own store to sync them server-side.
 */
export interface ConversationStore {
  list(): ConversationSummary[] | Promise<ConversationSummary[]>;
  load(id: string): ConversationRecord | undefined | Promise<ConversationRecord | undefined>;
  save(record: ConversationRecord): void | Promise<void>;
  remove(id: string): void | Promise<void>;
}

export interface LocalStoreOptions {
  /** Separates apps sharing an origin. */
  namespace?: string;
  /** Conversations kept before the oldest is dropped. */
  limit?: number;
  /** Messages kept per conversation. */
  maxItems?: number;
}

const KEY_PREFIX = "agent-runtime:conversations";

/** Titles come from the first thing the user said. No model required. */
export function deriveTitle(items: ChatItem[]): string {
  const first = items.find((item) => item.kind === "user");
  if (!first || first.kind !== "user") return "New chat";
  const text = first.text.replace(/\s+/g, " ").trim();
  return text.length > 48 ? `${text.slice(0, 47)}…` : text || "New chat";
}

export function createLocalConversationStore(
  options: LocalStoreOptions = {}
): ConversationStore {
  const key = `${KEY_PREFIX}:${options.namespace ?? "default"}`;
  const limit = options.limit ?? 20;
  const maxItems = options.maxItems ?? 200;

  const read = (): ConversationRecord[] => {
    if (typeof localStorage === "undefined") return [];
    try {
      const raw = localStorage.getItem(key);
      const parsed = raw ? (JSON.parse(raw) as ConversationRecord[]) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      // A corrupt or unreadable store must not take the chat down with it.
      return [];
    }
  };

  const write = (records: ConversationRecord[]) => {
    if (typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(key, JSON.stringify(records));
    } catch {
      // Quota exceeded: drop the oldest half rather than lose the current chat.
      try {
        localStorage.setItem(key, JSON.stringify(records.slice(0, Math.ceil(limit / 2))));
      } catch {
        /* give up quietly; conversations are a convenience, not the product */
      }
    }
  };

  const summarize = ({ items, ...summary }: ConversationRecord): ConversationSummary => summary;

  return {
    list() {
      return read()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(summarize);
    },
    load(id) {
      return read().find((record) => record.id === id);
    },
    save(record) {
      const trimmed: ConversationRecord = {
        ...record,
        items: record.items.slice(-maxItems),
      };
      const rest = read().filter((existing) => existing.id !== record.id);
      write([trimmed, ...rest].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit));
    },
    remove(id) {
      write(read().filter((record) => record.id !== id));
    },
  };
}
