"use client";

import { useAgent } from "./context.js";

/**
 * Answers, for the most recent request: what was asked, what context was
 * supplied, what was retrieved, which provider served each stage, what was
 * proposed, whether confirmation was required, and how long it took.
 */
export function DebugPanel() {
  const { traces, diagnostics } = useAgent();
  const trace = traces[traces.length - 1];
  if (!trace) return <div className="ar-debug">No requests yet.</div>;

  return (
    <div className="ar-debug">
      <div className="ar-debug-h">
        request {trace.requestId} · {Math.round(trace.ms)}ms
        {trace.cloudFallbackUsed ? " · cloud fallback" : ""}
      </div>

      <div className="ar-debug-h">context</div>
      {Object.entries(trace.context).map(([key, value]) => (
        <div className="ar-debug-row" key={key}>
          <span>{key}</span>
          <span className="ar-kv">{JSON.stringify(value)}</span>
        </div>
      ))}

      <div className="ar-debug-h">retrieved ({trace.knowledge.length})</div>
      {trace.knowledge.map((chunk) => (
        <div className="ar-debug-row" key={chunk.id}>
          <span>{chunk.title}</span>
          <span className="ar-kv">{chunk.score}</span>
        </div>
      ))}

      <div className="ar-debug-h">stages</div>
      {trace.stages.map((stage, index) => (
        <div className="ar-debug-row" key={`${stage.stage}-${index}`}>
          <span>
            {stage.stage}
            {stage.provider ? ` · ${stage.provider}` : ""}
            {stage.confidence !== undefined
              ? ` · conf ${stage.confidence.toFixed(2)}`
              : ""}
            {stage.reason ? ` · ${stage.reason}` : ""}
            {stage.note ? ` · ${stage.note}` : ""}
          </span>
          <span className="ar-kv">{Math.round(stage.ms)}ms</span>
        </div>
      ))}

      <div className="ar-debug-h">actions</div>
      <div className="ar-debug-row">
        <span>visible to model</span>
        <span className="ar-kv">{trace.visibleActions.join(", ") || "none"}</span>
      </div>
      {trace.permission && (
        <div className="ar-debug-row">
          <span>{trace.permission.action}</span>
          <span className="ar-kv">
            {trace.permission.permission} ({trace.permission.source})
          </span>
        </div>
      )}
      {diagnostics.length > 0 && (
        <>
          <div className="ar-debug-h">recovered from</div>
          {diagnostics.slice(-3).map((issue, index) => (
            <div className="ar-debug-row" key={`${issue.code}-${index}`}>
              <span>{issue.code}</span>
              <span className="ar-kv">{issue.message.split("\n")[0]}</span>
            </div>
          ))}
        </>
      )}

      {trace.outcomes.map((outcome) => (
        <div className="ar-debug-row" key={outcome.proposalId}>
          <span>
            {outcome.action} · {outcome.side}
          </span>
          <span className="ar-kv">
            {outcome.ok ? "ok" : `failed: ${outcome.error?.message ?? ""}`} ·{" "}
            {Math.round(outcome.ms)}ms
          </span>
        </div>
      ))}
    </div>
  );
}
