import type {
  ActionDefinition,
  AgentContext,
  JsonObject,
  Permission,
} from "./types.js";

export interface PermissionDecision {
  action: string;
  permission: Permission;
  /** Deterministic explanation, shown in traces and the debug panel. */
  reason: string;
  /** Where the decision came from. Never from the model. */
  source: "static" | "resolver" | "engine-default";
}

export interface PermissionEvaluation {
  input: unknown;
  context: AgentContext;
  user: JsonObject | null;
}

/**
 * The permission engine is deterministic application code. The model's output
 * is an input to it, never a participant in it.
 *
 * It is not a replacement for server-side authorization: an "auto" decision
 * only means the runtime may call the application. The application still has
 * to verify that this user may do this thing.
 */
export function evaluatePermission(
  action: ActionDefinition,
  evaluation: PermissionEvaluation
): PermissionDecision {
  const spec = action.permission;

  if (typeof spec === "function") {
    let permission: Permission;
    try {
      permission = spec({
        input: evaluation.input,
        context: evaluation.context,
        user: evaluation.user,
      });
    } catch {
      // A throwing policy is a closed policy.
      return {
        action: action.name,
        permission: "disabled",
        reason: "permission resolver threw; failing closed",
        source: "engine-default",
      };
    }
    if (permission !== "auto" && permission !== "confirm" && permission !== "disabled") {
      return {
        action: action.name,
        permission: "disabled",
        reason: `permission resolver returned ${JSON.stringify(
          permission
        )}; failing closed`,
        source: "engine-default",
      };
    }
    return {
      action: action.name,
      permission,
      reason: `permission resolver returned "${permission}"`,
      source: "resolver",
    };
  }

  if (spec !== "auto" && spec !== "confirm" && spec !== "disabled") {
    return {
      action: action.name,
      permission: "disabled",
      reason: "permission is not one of auto | confirm | disabled; failing closed",
      source: "engine-default",
    };
  }

  return {
    action: action.name,
    permission: spec,
    reason: `declared permission "${spec}"`,
    source: "static",
  };
}

/**
 * The model's capability surface. Actions whose permission resolves to
 * "disabled" for this user/context are never described to the model, so it
 * cannot be talked into proposing them.
 */
export function visibleActions(
  actions: ActionDefinition[],
  evaluation: Omit<PermissionEvaluation, "input">
): ActionDefinition[] {
  return actions.filter((action) => {
    if (typeof action.permission === "function") {
      // Input is not known yet; resolvers must tolerate an empty input when
      // used for surface filtering. A resolver that needs input still gets a
      // second, authoritative evaluation before execution.
      const decision = evaluatePermission(action, { ...evaluation, input: {} });
      return decision.permission !== "disabled";
    }
    return action.permission !== "disabled";
  });
}
