import { z } from "zod";
import { action, clientAction, defineAgent, docs } from "@agent-runtime/core";
import { listPages, readPage } from "./pages.ts";

/**
 * A documentation site that can answer questions about itself.
 *
 * Everything the assistant says here comes from the pages in content/docs —
 * the same pages a reader can open. There is no separate knowledge base to
 * drift out of date, and every answer can point at the page it came from.
 */
export const agent = defineAgent({
  identity: "Docs assistant",

  knowledge: [docs("./content/docs")],

  context: ({ page }) => ({
    currentRoute: page.route,
    currentPage: page.id,
    currentDocTitle: page.docTitle,
  }),

  maxSteps: 2,

  actions: {
    findPage: action({
      description: "Find documentation pages matching a topic",
      permission: "auto",
      input: z.object({
        query: z.string().describe("What the reader is looking for"),
      }),
      examples: ["find a page about permissions", "which page covers routing", "search the docs"],
      execute: async (input) => {
        const pages = await listPages();
        // Match on words. "which page covers routing" shares no substring with
        // any page, but it shares the word that matters.
        const words = input.query
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((word) => word.length > 2);

        const scored = pages
          .map((page) => {
            const haystack = `${page.title} ${page.body}`.toLowerCase();
            return { page, hits: words.filter((word) => haystack.includes(word)).length };
          })
          .filter((entry) => !words.length || entry.hits > 0)
          .sort((a, b) => b.hits - a.hits);

        const matches = scored.map((entry) => entry.page);
        return {
          summary: matches.length
            ? matches.map((page) => page.title).join("; ")
            : `No page mentions "${input.query}"`,
          data: matches.map((page) => ({
            title: page.title,
            url: `/docs/${page.slug}`,
            slug: page.slug,
          })),
        };
      },
    }),

    openPage: clientAction({
      description: "Open a documentation page",
      permission: "auto",
      input: z.object({
        slug: z
          .enum(["quickstart", "context", "actions", "grounding", "models"])
          .describe("Which page to open"),
      }),
      examples: [
        "open the quickstart",
        "show me the page about actions",
        "take me to grounding",
      ],
      confirmLabel: "Open page",
      describe: (input) => `Open the ${input.slug} page`,
    }),

    getPage: action({
      description: "Read a documentation page in full",
      permission: "auto",
      input: z.object({
        slug: z.enum(["quickstart", "context", "actions", "grounding", "models"]),
      }),
      fillFromContext: { slug: "currentPage" },
      examples: ["what does this page say", "summarise this page"],
      execute: async (input) => {
        const page = await readPage(input.slug);
        if (!page) throw new Error(`No page ${input.slug}`);
        return {
          summary: `${page.title} — ${page.body.split("\n").filter(Boolean)[1] ?? ""}`.slice(0, 240),
          data: { title: page.title, url: `/docs/${page.slug}`, words: page.body.split(/\s+/).length },
        };
      },
    }),
  },
});
