"use client";

import { useAgentPage } from "@agent-runtime/react";
import type { PageState } from "@agent-runtime/core";

export function PageContext(props: PageState) {
  useAgentPage(props);
  return null;
}
