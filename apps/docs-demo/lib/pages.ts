import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export interface DocPage {
  slug: string;
  title: string;
  body: string;
}

const DIR = "./content/docs";

/** Order the sidebar reads best in, rather than alphabetical. */
const ORDER = ["quickstart", "context", "actions", "grounding", "models"];

export async function listPages(): Promise<DocPage[]> {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".md"));
  const pages = await Promise.all(files.map((file) => readPage(file.replace(/\.md$/, ""))));
  return pages
    .filter((page): page is DocPage => page !== undefined)
    .sort((a, b) => ORDER.indexOf(a.slug) - ORDER.indexOf(b.slug));
}

export async function readPage(slug: string): Promise<DocPage | undefined> {
  try {
    const raw = await readFile(join(DIR, `${slug}.md`), "utf8");
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
    const meta = Object.fromEntries(
      (match?.[1] ?? "")
        .split(/\r?\n/)
        .map((line) => line.match(/^(\w+):\s*(.*)$/))
        .filter(Boolean)
        .map((kv) => [kv![1]!, kv![2]!.trim()])
    );
    return {
      slug,
      title: meta.title ?? slug,
      body: raw.slice(match?.[0].length ?? 0).trim(),
    };
  } catch {
    return undefined;
  }
}

/** Minimal markdown rendering — enough for a documentation page, no dependency. */
export function renderMarkdown(body: string): string {
  const lines = body.split(/\r?\n/);
  const html: string[] = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push("</ul>");
      inList = false;
    }
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    const bullet = line.match(/^\s*[-*]\s+(.*)$/);

    if (heading) {
      closeList();
      const level = heading[1]!.length;
      html.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
    } else if (bullet) {
      if (!inList) {
        html.push("<ul>");
        inList = true;
      }
      html.push(`<li>${inline(bullet[1]!)}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return html.join("\n");
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
