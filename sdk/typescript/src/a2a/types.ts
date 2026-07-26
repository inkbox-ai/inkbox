/** Inkbox A2A inbox types and standard A2A 1.0 wire types. */

export type A2ATaskState =
  | "submitted"
  | "working"
  | "input_required"
  | "completed"
  | "failed"
  | "canceled"
  | (string & {});

export type A2AWireTaskState =
  | "TASK_STATE_UNSPECIFIED"
  | "TASK_STATE_SUBMITTED"
  | "TASK_STATE_WORKING"
  | "TASK_STATE_COMPLETED"
  | "TASK_STATE_FAILED"
  | "TASK_STATE_CANCELED"
  | "TASK_STATE_INPUT_REQUIRED"
  | "TASK_STATE_REJECTED"
  | "TASK_STATE_AUTH_REQUIRED"
  | (string & {});

export type A2ARuleAction = "allow" | "block" | (string & {});
export type A2ARuleDirection =
  | "inbound"
  | "outbound"
  | "both"
  | (string & {});
export type A2AHistoryDirection = "inbound" | "outbound" | "both" | (string & {});
export type A2AMessageRole = "caller" | "agent" | (string & {});
export type A2AReplyIntent = "progress" | "ask_caller" | "complete" | "fail";

export interface A2ASkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface A2ASettings {
  enabled: boolean;
  filterMode: string;
  skills: A2ASkill[] | null;
  cardUrl: string;
  inboundTaskCount: number;
  outboundTaskCount: number;
  updatedAt: string | null;
}

export interface A2AContactRule {
  id: string;
  action: A2ARuleAction;
  matchType: string;
  matchTarget: string;
  direction: A2ARuleDirection;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface A2ACaller {
  identityId: string;
  organizationId: string;
  handle: string | null;
  trustTier: string;
}

export interface A2ATarget {
  identityId: string;
  organizationId: string;
  handle: string | null;
}

export interface A2AMessage {
  id: string;
  messageId: string;
  role: string;
  parts: Record<string, unknown>[];
  metadata: Record<string, unknown> | null;
  extensions: string[] | null;
  referenceTaskIds: string[] | null;
  createdAt: string;
}

export interface A2ATask {
  id: string;
  contextId: string;
  state: A2ATaskState;
  caller: A2ACaller;
  target: A2ATarget | null;
  messages: A2AMessage[];
  historyTruncated: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface A2ATaskPage {
  items: A2ATask[];
  nextCursor: string | null;
}

export interface A2ATaskListOptions {
  direction?: A2AHistoryDirection;
  requesterHandle?: string;
  workerHandle?: string;
  state?: A2ATaskState;
  contextId?: string;
  q?: string;
  since?: string;
  cursor?: string;
  limit?: number;
}

export type A2ASentTaskListOptions = Omit<A2ATaskListOptions, "direction">;

export interface A2AContext {
  id: string;
  caller: A2ACaller;
  target: A2ATarget | null;
  tasks: A2ATask[];
  tasksTruncated: boolean;
  createdAt: string;
  lastActivityAt: string;
}

export interface A2AContextPage {
  items: A2AContext[];
  nextCursor: string | null;
}

export interface A2AHistoryMessage {
  id: string;
  messageId: string;
  taskId: string;
  contextId: string;
  taskState: A2ATaskState;
  caller: A2ACaller;
  target: A2ATarget | null;
  role: A2AMessageRole;
  parts: Record<string, unknown>[];
  metadata: Record<string, unknown> | null;
  extensions: string[] | null;
  referenceTaskIds: string[] | null;
  createdAt: string;
}

export interface A2AHistoryMessagePage {
  items: A2AHistoryMessage[];
  nextCursor: string | null;
}

export interface A2AMessageListOptions {
  direction?: A2AHistoryDirection;
  requesterHandle?: string;
  workerHandle?: string;
  taskId?: string;
  contextId?: string;
  role?: A2AMessageRole;
  q?: string;
  since?: string;
  cursor?: string;
  limit?: number;
}

export interface A2ACard {
  name: string;
  supportedInterfaces: Array<{
    url: string;
    protocolBinding: string;
    protocolVersion: string;
  }>;
  [key: string]: unknown;
}

export interface A2AResolvedTarget {
  readonly cardUrl: string;
  readonly rpcUrl: string;
  readonly protocolVersion: "1.0";
  readonly card: A2ACard;
}

export interface A2AWireMessage {
  messageId: string;
  role: string;
  parts: Record<string, unknown>[];
  [key: string]: unknown;
}

export interface A2AWireTask {
  id: string;
  contextId: string;
  status: {
    state: A2AWireTaskState;
    timestamp?: string;
    [key: string]: unknown;
  };
  history?: A2AWireMessage[];
  [key: string]: unknown;
}

export type A2ASendResult =
  | { kind: "task"; task: A2AWireTask }
  | { kind: "message"; message: A2AWireMessage };

export interface A2AWireTaskPage {
  tasks: A2AWireTask[];
  nextPageToken: string | null;
  pageSize: number;
  totalSize: number;
}

export function parseA2ATask(raw: Record<string, any>): A2ATask {
  return {
    id: raw.id,
    contextId: raw.context_id,
    state: raw.state,
    caller: {
      identityId: raw.caller.identity_id,
      organizationId: raw.caller.organization_id,
      handle: raw.caller.handle ?? null,
      trustTier: raw.caller.trust_tier ?? "inkbox_verified",
    },
    target: raw.target ? {
      identityId: raw.target.identity_id,
      organizationId: raw.target.organization_id,
      handle: raw.target.handle ?? null,
    } : null,
    messages: (raw.messages ?? []).map((item: Record<string, any>) => ({
      id: item.id,
      messageId: item.message_id,
      role: item.role,
      parts: item.parts ?? [],
      metadata: item.metadata ?? null,
      extensions: item.extensions ?? null,
      referenceTaskIds: item.reference_task_ids ?? null,
      createdAt: item.created_at,
    })),
    historyTruncated: raw.history_truncated ?? false,
    completedAt: raw.completed_at ?? null,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export function parseA2AContext(raw: Record<string, any>): A2AContext {
  return {
    id: raw.id,
    caller: {
      identityId: raw.caller.identity_id,
      organizationId: raw.caller.organization_id,
      handle: raw.caller.handle ?? null,
      trustTier: raw.caller.trust_tier ?? "inkbox_verified",
    },
    target: raw.target ? {
      identityId: raw.target.identity_id,
      organizationId: raw.target.organization_id,
      handle: raw.target.handle ?? null,
    } : null,
    tasks: (raw.tasks ?? []).map(parseA2ATask),
    tasksTruncated: raw.tasks_truncated ?? false,
    createdAt: raw.created_at,
    lastActivityAt: raw.last_activity_at,
  };
}

export function parseA2AHistoryMessage(
  raw: Record<string, any>,
): A2AHistoryMessage {
  return {
    id: raw.id,
    messageId: raw.message_id,
    taskId: raw.task_id,
    contextId: raw.context_id,
    taskState: raw.task_state,
    caller: {
      identityId: raw.caller.identity_id,
      organizationId: raw.caller.organization_id,
      handle: raw.caller.handle ?? null,
      trustTier: raw.caller.trust_tier ?? "inkbox_verified",
    },
    target: raw.target ? {
      identityId: raw.target.identity_id,
      organizationId: raw.target.organization_id,
      handle: raw.target.handle ?? null,
    } : null,
    role: raw.role,
    parts: raw.parts ?? [],
    metadata: raw.metadata ?? null,
    extensions: raw.extensions ?? null,
    referenceTaskIds: raw.reference_task_ids ?? null,
    createdAt: raw.created_at,
  };
}
