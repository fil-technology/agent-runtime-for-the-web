import { z } from "zod";
import { action, clientAction, defineAgent, inline } from "@agent-runtime/core";

/**
 * The smallest useful integration: one piece of context, one read action, one
 * navigation action, one confirmed mutation. Everything else in this repo is
 * an elaboration of this file.
 */

const notes = new Map<string, string>([
  ["n1", "Buy milk"],
  ["n2", "Call the dentist"],
]);

export const agent = defineAgent({
  identity: "Playground",

  // Knowledge can be inline: no filesystem, no build step, no vector store.
  knowledge: [
    inline([
      {
        id: "help",
        title: "Using the playground",
        text:
          "Notes are listed on the home page. Open a note to rename it. " +
          "Settings holds the theme and the export button. Renaming a note asks " +
          "you to confirm first, because it changes stored data.",
      },
    ]),
  ],

  // 1. Context: what the user is looking at, supplied by the application.
  context: ({ page }) => ({
    currentRoute: page.route,
    currentNoteId: page.noteId,
    currentNoteText: page.noteText,
  }),

  actions: {
    // 2. A read action. Runs immediately, no confirmation.
    listNotes: action({
      description: "List the user's notes",
      permission: "auto",
      input: z.object({}),
      examples: ["show my notes", "what notes do I have"],
      execute: async () => ({
        summary: `${notes.size} notes`,
        data: listNotes(),
      }),
    }),

    // 3. A navigation action. Runs in the browser.
    navigate: clientAction({
      description: "Open a page of the app",
      permission: "auto",
      input: z.object({ destination: z.enum(["home", "settings"]) }),
      examples: ["take me to settings", "go home"],
      confirmLabel: "Open page",
      describe: (input) => `Open ${input.destination}`,
    }),

    // 4. Creating something is a write, so it is proposed and confirmed too.
    addNote: action({
      description: "Add a new note",
      permission: "confirm",
      input: z.object({ text: z.string().min(1).max(200).describe("What the note should say") }),
      examples: ["add a note", "add new note - buy coffee", "create a note called groceries"],
      confirmLabel: "Add note",
      describe: (input) => `Add a note: “${input.text}”?`,
      execute: async (input) => {
        const id = `n${notes.size + 1}`;
        notes.set(id, input.text);
        return { summary: `Added “${input.text}”`, data: { id, text: input.text, url: `/notes/${id}` } };
      },
    }),

    // 5. A mutation on something that already exists.
    renameNote: action({
      description: "Rename a note",
      permission: "confirm",
      input: z.object({ noteId: z.string(), name: z.string().min(1).max(80) }),
      fillFromContext: { noteId: "currentNoteId" },
      examples: ['rename this note to "Groceries"'],
      confirmLabel: "Rename",
      describe: (input, context) =>
        `Rename "${context.currentNoteText ?? input.noteId}" to "${input.name}"?`,
      execute: async (input) => {
        if (!notes.has(input.noteId)) throw new Error(`No note ${input.noteId}`);
        notes.set(input.noteId, input.name);
        return { summary: `Renamed to ${input.name}` };
      },
    }),
  },

  models: { strategy: "auto", localBudgetMB: 400, cloudFallback: true },
});

export function listNotes() {
  return [...notes].map(([id, text]) => ({ id, text, url: `/notes/${id}` }));
}
export function getNote(id: string) {
  const text = notes.get(id);
  return text ? { id, text } : undefined;
}
