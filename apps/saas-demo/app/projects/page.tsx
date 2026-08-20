import Link from "next/link";
import { currentUser, listProjects } from "@/lib/data";
import { PageContext } from "../page-context";

// The demo mutates data in memory, so pages must not be prerendered.
export const dynamic = "force-dynamic";

export default function Projects() {
  const projects = listProjects(currentUser().id);
  return (
    <>
      <PageContext id="projects.list" />
      <h1>Projects</h1>
      <p className="sub">Projects you own.</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Environment</th>
            <th>Created</th>
            <th>Id</th>
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <tr key={project.id}>
              <td>
                <Link href={`/projects/${project.id}/settings`}>{project.name}</Link>
              </td>
              <td className="muted">{project.environment}</td>
              <td className="muted">{project.createdAt}</td>
              <td>
                <code>{project.id}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
