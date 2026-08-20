"use client";

import { useAgentPage } from "@agent-runtime/react";
import type { PageState } from "@agent-runtime/core";

/**
 * How a page tells the agent what "this" means. Drop it into any route
 * segment; it is the difference between "rename this project" working and the
 * assistant having to ask which project you meant.
 */
export function PageContext(props: PageState) {
  useAgentPage(props);
  return null;
}
