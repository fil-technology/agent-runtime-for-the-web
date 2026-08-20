import { notFound } from "next/navigation";
import { getNote } from "../../../agent";
import { PageContext } from "../../page-context";

export const dynamic = "force-dynamic";

export default async function NotePage({
  params,
}: {
  params: Promise<{ noteId: string }>;
}) {
  const { noteId } = await params;
  const note = getNote(noteId);
  if (!note) notFound();

  return (
    <>
      {/* This is what makes "rename this note" resolvable. */}
      <PageContext id="note.detail" noteId={note.id} noteText={note.text} />
      <h1>{note.text}</h1>
      <p className="sub">
        <code>{note.id}</code>
      </p>
      <p className="muted">
        Ask: <em>rename this note to &ldquo;Groceries&rdquo;</em>. The runtime fills{" "}
        <code>noteId</code> from page context, validates the input, evaluates the
        permission, and then asks you to confirm before anything is written.
      </p>
    </>
  );
}
