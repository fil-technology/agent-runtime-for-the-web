export { defineAgent, docs, inline } from "./agent.js";
export { action, clientAction } from "./action.js";
export type { ServerActionSpec, ClientActionSpec } from "./action.js";
export { evaluatePermission, visibleActions } from "./permissions.js";
export type { PermissionDecision } from "./permissions.js";
export {
  AgentError,
  unknownActionError,
  invalidActionInputError,
  actionDisabledError,
  confirmationRequiredError,
  noProviderError,
  modelOutputInvalidError,
  configError,
} from "./errors.js";
export type { AgentErrorCode } from "./errors.js";
export { buildManifest, agentFromManifest, jsonSchemaToZod } from "./manifest.js";
export type {
  ActionManifest,
  AgentManifest,
  RemoteExecutor,
  ClientActionHandlers,
} from "./manifest.js";
export { toJsonSchema, describeSchema, objectFields, extractJson } from "./schema.js";
export type { JsonSchema } from "./schema.js";
export {
  Bm25Index,
  buildRetriever,
  loadKnowledgeChunks,
  registerDocsLoader,
  chunkMarkdown,
  tokenize,
} from "./knowledge/index.js";
export type { Retriever, DocsLoader } from "./knowledge/index.js";
export { ModelRouter } from "./model/router.js";
export type { RouteAttempt, RouteCandidate, RoutedResult } from "./model/router.js";
export { createFakeProvider } from "./model/fake.js";
export type { FakeProviderOptions } from "./model/fake.js";
export {
  buildFacts,
  explainPrompt,
  extractPrompt,
  routePrompt,
  renderContext,
  renderKnowledge,
} from "./model/prompt.js";
export type { PromptParts } from "./model/prompt.js";
export type {
  GenerateInput,
  GenerateResult,
  ModelCapabilities,
  ModelProvider,
  ModelTask,
  ProviderTier,
  StageHints,
  StructuredGenerateInput,
  StructuredResult,
} from "./model/types.js";
export { AgentRuntime } from "./runtime/runtime.js";
export { answerFromFields } from "./runtime/fields.js";
export type { FieldAnswer } from "./runtime/fields.js";
export type { RuntimeOptions, CallOptions } from "./runtime/runtime.js";
export { AgentDecisionSchema, agentDecisionSchema, newId } from "./runtime/protocol.js";
export type {
  ActionOutcome,
  AnswerSource,
  ActionProposal,
  AgentDecision,
  AgentEvent,
  AgentTurn,
  ClientResultRequest,
  ConfirmRequest,
  ExecuteRequest,
  MessageRequest,
  PendingClarification,
  RecallState,
  RuntimeRequest,
  StageTrace,
  Trace,
} from "./runtime/protocol.js";
export type {
  ActionDefinition,
  Choice,
  ActionExecutionContext,
  ActionMap,
  ActionSide,
  Agent,
  AgentContext,
  AgentDefinition,
  ChatMessage,
  ContextInput,
  ContextResolver,
  JsonObject,
  JsonValue,
  KnowledgeChunk,
  KnowledgeSource,
  ModelPolicy,
  PageState,
  Permission,
  PermissionInput,
  PermissionResolver,
  PermissionSpec,
  RetrievedChunk,
  SessionState,
} from "./types.js";
