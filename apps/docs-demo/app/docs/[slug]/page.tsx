import Link from "next/link";
import { notFound } from "next/navigation";
import { listPages, readPage, renderMarkdown } from "@/lib/pages";
import { PageContext } from "../../page-context";

export const dynamic = "force-dynamic";

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const [page, pages] = await Promise.all([readPage(slug), listPages()]);
  if (!page) notFound();

  return (
    <div className="layout">
      {/* The assistant knows which page you are reading, so "summarise this
          page" needs no further explanation from you. */}
      <PageContext id={page.slug} docTitle={page.title} />

      <aside className="sidebar">
        <p className="group">Documentation</p>
        {pages.map((entry) => (
          <Link
            key={entry.slug}
            href={`/docs/${entry.slug}`}
            data-active={entry.slug === page.slug}
          >
            {entry.title}
          </Link>
        ))}
      </aside>

      <article dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }} />
    </div>
  );
}
