import { notFound } from "next/navigation";
import { getProject } from "@/lib/data";
import { PageContext } from "../../../page-context";

// The demo mutates data in memory, so pages must not be prerendered.
export const dynamic = "force-dynamic";

export default async function ProjectSettings({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = getProject(projectId);
  if (!project) notFound();

  return (
    <>
      {/*
        This is the whole "what does 'this' mean" mechanism. The page already
        knows which project it is showing, so the agent never has to guess.
      */}
      <PageContext
        id="project.settings"
        projectId={project.id}
        projectName={project.name}
      />

      <h1>{project.name}</h1>
      <p className="sub">
        Project settings · <code>{project.id}</code>
      </p>

      <div className="card">
        <div className="row">
          <span>Name</span>
          <span className="muted">{project.name}</span>
        </div>
        <div className="row">
          <span>Environment</span>
          <span className="pill">{project.environment}</span>
        </div>
        <div className="row">
          <span>Created</span>
          <span className="muted">{project.createdAt}</span>
        </div>
      </div>

      <h2>Danger zone</h2>
      <div className="card">
        <div className="row">
          <span>
            Delete this project
            <div className="muted">Permanent. Dashboards and API keys are removed.</div>
          </span>
        </div>
      </div>

      <p className="muted">
        Ask the assistant: “rename this project to EarthWatch” or “delete this project”.
        Both require an explicit confirmation before anything happens.
      </p>
    </>
  );
}
