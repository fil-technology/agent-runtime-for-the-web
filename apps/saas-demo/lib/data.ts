/**
 * The demo application's own data layer. Nothing here knows about the agent
 * runtime — actions call into this the same way a page or a REST handler would.
 */

export interface Project {
  id: string;
  name: string;
  ownerId: string;
  createdAt: string;
  environment: "production" | "staging";
  deleted?: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  issuedAt: string;
  amountCents: number;
  status: "paid" | "open";
  url: string;
}

export interface Member {
  id: string;
  email: string;
  role: "admin" | "member";
}

export interface Account {
  id: string;
  name: string;
  plan: "free" | "team" | "enterprise";
  seats: number;
  renewsAt: string;
  paymentMethod: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "member";
  accountId: string;
}

const users: User[] = [
  { id: "u_ada", name: "Ada Lovelace", email: "ada@example.com", role: "admin", accountId: "acc_1" },
  { id: "u_ben", name: "Ben Chen", email: "ben@example.com", role: "member", accountId: "acc_1" },
];

const account: Account = {
  id: "acc_1",
  name: "Northwind Labs",
  plan: "team",
  seats: 8,
  renewsAt: "2026-09-14",
  paymentMethod: "Visa ending 4242",
};

const projects: Project[] = [
  { id: "abc123", name: "Seismic Watch", ownerId: "u_ada", createdAt: "2026-02-11", environment: "production" },
  { id: "def456", name: "Coastal Sensors", ownerId: "u_ada", createdAt: "2026-04-02", environment: "staging" },
  { id: "ghi789", name: "Internal Tools", ownerId: "u_ben", createdAt: "2026-05-20", environment: "staging" },
];

const invoices: Invoice[] = [
  { id: "in_3", number: "NW-0003", issuedAt: "2026-08-14", amountCents: 24000, status: "paid", url: "/settings/billing#NW-0003" },
  { id: "in_2", number: "NW-0002", issuedAt: "2026-07-14", amountCents: 24000, status: "paid", url: "/settings/billing#NW-0002" },
  { id: "in_1", number: "NW-0001", issuedAt: "2026-06-14", amountCents: 18000, status: "paid", url: "/settings/billing#NW-0001" },
];

const members: Member[] = [
  { id: "u_ada", email: "ada@example.com", role: "admin" },
  { id: "u_ben", email: "ben@example.com", role: "member" },
];

/** The demo signs you in as Ada. A real app resolves this from its session. */
export function currentUser(): User {
  return users[0]!;
}

export function getAccount(): Account {
  return account;
}

export function listProjects(ownerId?: string): Project[] {
  return projects.filter((p) => !p.deleted && (!ownerId || p.ownerId === ownerId));
}

export function getProject(id: string): Project | undefined {
  return projects.find((p) => p.id === id && !p.deleted);
}

export function searchProjects(query: string, ownerId: string): Project[] {
  const needle = query.trim().toLowerCase();
  return listProjects(ownerId).filter(
    (p) => !needle || p.name.toLowerCase().includes(needle) || p.id.includes(needle)
  );
}

export function renameProject(id: string, name: string, actorId: string): Project {
  const project = getProject(id);
  // Authorization lives here, in the application, not in the runtime.
  if (!project) throw new Error(`No project ${id}`);
  if (project.ownerId !== actorId) throw new Error("You do not have access to that project.");
  project.name = name;
  return project;
}

export function deleteProject(id: string, actorId: string): Project {
  const project = getProject(id);
  if (!project) throw new Error(`No project ${id}`);
  if (project.ownerId !== actorId) throw new Error("You do not have access to that project.");
  project.deleted = true;
  return project;
}

export function listInvoices(): Invoice[] {
  return invoices;
}

export function listMembers(): Member[] {
  return members;
}

export function inviteMember(email: string, role: "admin" | "member"): Member {
  const existing = members.find((m) => m.email === email);
  if (existing) throw new Error(`${email} is already a member.`);
  const member: Member = { id: `u_${email.split("@")[0]}`, email, role };
  members.push(member);
  return member;
}

export function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
