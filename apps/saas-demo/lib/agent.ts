import { z } from "zod";
import { action, clientAction, defineAgent, docs } from "@agent-runtime/core";
import {
  deleteProject,
  formatMoney,
  getAccount,
  getProject,
  inviteMember,
  listInvoices,
  listMembers,
  renameProject,
  searchProjects,
} from "./data.ts";

/**
 * The whole integration surface for this application.
 *
 * Everything the assistant can know (knowledge, context) and everything it can
 * do (actions) is declared here. There is no other path from the model into
 * the product.
 */
export const agent = defineAgent({
  identity: "Northwind Assistant",

  knowledge: [docs("./content/docs")],

  context: ({ user, page }) => ({
    userId: user?.id as string,
    role: user?.role as string,
    plan: user?.plan as string,
    accountName: user?.accountName as string,
    currentRoute: page.route,
    currentPage: page.id,
    currentProjectId: page.projectId,
    currentProjectName: page.projectName,
  }),

  actions: {
    /* ------------------------------ reads ------------------------------ */

    getSubscription: action({
      description: "Get the current plan, seat count, renewal date and payment method",
      permission: "auto",
      input: z.object({}),
      examples: ["when does my plan renew", "what plan am I on", "how many seats do we have"],
      authoritative: true,
      execute: async () => {
        const account = getAccount();
        return {
          summary: `${account.plan} plan, ${account.seats} seats, renews ${account.renewsAt}`,
          data: account,
        };
      },
    }),

    listInvoices: action({
      description: "List invoices on the account, most recent first",
      permission: "auto",
      input: z.object({}),
      examples: ["show my invoices", "billing history", "download last invoice"],
      execute: async () => {
        const invoices = listInvoices();
        return {
          summary: `${invoices.length} invoices, latest ${invoices[0]!.number} for ${formatMoney(
            invoices[0]!.amountCents
          )}`,
          data: invoices.map((i) => ({
            number: i.number,
            issuedAt: i.issuedAt,
            amount: formatMoney(i.amountCents),
            status: i.status,
            url: i.url,
          })),
        };
      },
    }),

    searchProjects: action({
      description: "Search the projects belonging to the signed-in user",
      permission: "auto",
      input: z.object({
        query: z.string().describe("Text to search project names for. Empty lists everything."),
      }),
      examples: [
        "show my projects",
        "find the sensors project",
        "which projects do I have",
        "how many projects do we have",
        "list our projects",
      ],
      execute: async (input, ctx) => {
        const results = searchProjects(input.query, ctx.user!.id as string);
        const named = results.map((p) => p.name).join(", ");
        return {
          summary: results.length
            ? `${results.length} project${results.length === 1 ? "" : "s"}: ${named}`
            : `No projects match "${input.query}"`,
          data: results.map((p) => ({
            id: p.id,
            name: p.name,
            environment: p.environment,
            createdAt: p.createdAt,
            url: `/projects/${p.id}/settings`,
          })),
        };
      },
    }),

    listMembers: action({
      description: "List the people on the account and their roles",
      permission: "auto",
      input: z.object({}),
      examples: ["who is on my team", "list members"],
      execute: async () => {
        const members = listMembers();
        return {
          summary: members.map((m) => `${m.email} (${m.role})`).join(", "),
          data: members.map((m) => ({ ...m, url: "/settings/team" })),
        };
      },
    }),

    /* ---------------------------- navigation ---------------------------- */

    /**
     * Navigation targets are a closed set the application declares, not a
     * free-form URL. A small model picking from four labels is reliable in a
     * way that a model inventing a path never is.
     */
    navigate: clientAction({
      description: "Open one of this app's pages",
      permission: "auto",
      input: z.object({
        destination: z
          .enum(["projects", "billing", "apiKeys", "team", "overview"])
          .describe("Which page to open"),
      }),
      examples: [
        "take me to billing",
        "open the api keys page",
        "show me the projects page",
        "go to the team page",
      ],
      confirmLabel: "Open page",
      describe: (input) => `Open ${DESTINATIONS[input.destination].label}`,
    }),

    /* ------------------------- confirmed writes ------------------------- */

    renameProject: action({
      description: "Rename a project the user owns",
      permission: "confirm",
      input: z.object({
        projectId: z.string(),
        name: z.string().min(1).max(60).describe("The new project name"),
      }),
      fillFromContext: { projectId: "currentProjectId" },
      resolve: {
        projectId: (ctx) =>
          searchProjects("", ctx.user!.id as string).map((p) => ({
            value: p.id,
            label: p.name,
            hint: p.environment,
          })),
      },
      examples: ['rename this project to "EarthWatch"', "call this project Atlas"],
      clarify: (missing) =>
        missing.includes("projectId")
          ? "Which project do you mean?"
          : "What should I rename it to?",
      confirmLabel: "Rename",
      describe: (input, context) =>
        `Rename ${projectName(input.projectId, context)} to "${input.name}"?`,
      execute: async (input, ctx) => {
        // The runtime allowed the attempt; the application decides if it is
        // permitted. Both checks exist on purpose.
        const project = renameProject(input.projectId, input.name, ctx.user!.id as string);
        return { summary: `Renamed to ${project.name}`, data: { id: project.id, name: project.name } };
      },
    }),

    inviteMember: action({
      description: "Invite someone to the account by email",
      permission: "confirm",
      input: z.object({
        email: z.string().email(),
        role: z.enum(["admin", "member"]).default("member"),
      }),
      examples: ["invite sam@example.com", "add a teammate"],
      confirmLabel: "Send invite",
      describe: (input) => `Invite ${input.email} as ${input.role ?? "member"}?`,
      execute: async (input) => {
        const member = inviteMember(input.email, input.role ?? "member");
        return { summary: `Invited ${member.email}`, data: member };
      },
    }),

    deleteProject: action({
      description: "Permanently delete a project",
      permission: "confirm",
      input: z.object({ projectId: z.string() }),
      fillFromContext: { projectId: "currentProjectId" },
      resolve: {
        projectId: (ctx) =>
          searchProjects("", ctx.user!.id as string).map((p) => ({
            value: p.id,
            label: p.name,
            hint: p.environment,
          })),
      },
      examples: ["delete this project", "remove this project permanently"],
      clarify: () => "Which project do you mean? Deleting is permanent.",
      confirmLabel: "Delete project",
      describe: (input, context) =>
        `Permanently delete ${projectName(
          input.projectId,
          context
        )}? This cannot be undone.`,
      execute: async (input, ctx) => {
        const project = deleteProject(input.projectId, ctx.user!.id as string);
        return { summary: `Deleted ${project.name}`, data: { id: project.id } };
      },
    }),

    /* ------------------------- dynamic policy -------------------------- */

    cancelSubscription: action({
      description: "Cancel the account's subscription at the end of the period",
      // Only an admin may even see this capability.
      permission: ({ user }) => (user?.role === "admin" ? "confirm" : "disabled"),
      input: z.object({ reason: z.string().optional() }),
      examples: ["cancel our subscription"],
      confirmLabel: "Cancel subscription",
      describe: () => "Cancel the Northwind Labs subscription at the end of the billing period?",
      execute: async () => ({
        summary: "Subscription set to cancel at period end",
        data: { cancelsAt: getAccount().renewsAt },
      }),
    }),
  },

  maxSteps: 3,

  models: {
    strategy: "auto",
    localBudgetMB: 400,
    cloudFallback: true,
  },
});

export const DESTINATIONS = {
  projects: { label: "Projects", path: "/projects" },
  billing: { label: "Billing", path: "/settings/billing" },
  apiKeys: { label: "API keys", path: "/settings/api-keys" },
  team: { label: "Team", path: "/settings/team" },
  overview: { label: "Overview", path: "/" },
} as const;

export type Destination = keyof typeof DESTINATIONS;

export function projectContextFor(projectId: string) {
  const project = getProject(projectId);
  return {
    projectId,
    projectName: project?.name,
  };
}

/**
 * What to call a project in a confirmation.
 *
 * The page context only names the project when the user is standing on it.
 * They might instead have picked it from a list the assistant offered, and
 * "Permanently delete abc123?" is not something anyone can safely say yes to.
 */
function projectName(projectId: string, context: Record<string, unknown>): string {
  if (context.currentProjectId === projectId && context.currentProjectName) {
    return String(context.currentProjectName);
  }
  return getProject(projectId)?.name ?? projectId;
}
