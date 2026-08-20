import Link from "next/link";
import { listNotes } from "../agent";
import { PageContext } from "./page-context";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      {/* One piece of context: which page this is. */}
      <PageContext id="notes.list" />
      <h1>Notes</h1>
      <p className="sub">Open a note, then ask the assistant to rename it.</p>
      {listNotes().map((note) => (
        <Link className="note" key={note.id} href={`/notes/${note.id}`}>
          {note.text} <code>{note.id}</code>
        </Link>
      ))}
    </>
  );
}
