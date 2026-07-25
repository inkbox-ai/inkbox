/** Inkbox serve-side A2A inbox resource. */

import type { HttpTransport } from "../_http.js";
import type { FilterMode } from "../mail/types.js";
import type {
  A2AContactRule,
  A2AContext,
  A2AContextPage,
  A2AHistoryMessage,
  A2AHistoryMessagePage,
  A2AMessageListOptions,
  A2AReplyIntent,
  A2ARuleAction,
  A2ARuleDirection,
  A2ASettings,
  A2ASkill,
  A2ATask,
  A2ATaskListOptions,
  A2ATaskPage,
  A2ASentTaskListOptions,
} from "./types.js";
import {
  parseA2AContext,
  parseA2AHistoryMessage,
  parseA2ATask,
} from "./types.js";

type Raw = Record<string, any>;

function base(handle: string): string {
  return `/identities/${encodeURIComponent(handle)}/a2a`;
}

function ruleDirection(direction: A2ARuleDirection): "inbound" | "both" {
  if (direction !== "inbound" && direction !== "both") {
    throw new TypeError("A2A rule direction must be 'inbound' or 'both'");
  }
  return direction === "inbound" ? "inbound" : "both";
}

function parseSettings(raw: Raw): A2ASettings {
  return {
    enabled: raw.enabled,
    filterMode: raw.filter_mode,
    skills: raw.skills ?? null,
    cardUrl: raw.card_url,
    inboundTaskCount: raw.inbound_task_count ?? 0,
    outboundTaskCount: raw.outbound_task_count ?? 0,
    updatedAt: raw.updated_at ?? null,
  };
}

function parseRule(raw: Raw): A2AContactRule {
  return {
    id: raw.id,
    action: raw.action,
    matchType: raw.match_type,
    matchTarget: raw.match_target,
    direction: raw.direction,
    status: raw.status,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export class A2AResource {
  constructor(private readonly http: HttpTransport) {}

  async settings(handle: string): Promise<A2ASettings> {
    return parseSettings(await this.http.get<Raw>(`${base(handle)}/settings`));
  }

  async updateSettings(
    handle: string,
    changes: { enabled?: boolean; filter_mode?: FilterMode; skills?: A2ASkill[] | null },
  ): Promise<A2ASettings> {
    return parseSettings(
      await this.http.put<Raw>(`${base(handle)}/settings`, changes),
    );
  }

  card(handle: string): Promise<Record<string, unknown>> {
    return this.http.get(`${base(handle)}/card`);
  }

  async tasks(
    handle: string,
    options: A2ATaskListOptions = {},
  ): Promise<A2ATaskPage> {
    const raw = await this.http.get<Raw>(`${base(handle)}/tasks`, {
      direction: options.direction,
      requester_handle: options.requesterHandle,
      worker_handle: options.workerHandle,
      state: options.state,
      context_id: options.contextId,
      q: options.q,
      since: options.since,
      cursor: options.cursor,
      limit: options.limit ?? 50,
    });
    return {
      items: (raw.items ?? []).map(parseA2ATask),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  async *iterTasks(
    handle: string,
    options: Omit<A2ATaskListOptions, "cursor"> = {},
  ): AsyncGenerator<A2ATask> {
    let cursor: string | undefined;
    do {
      const page = await this.tasks(handle, { ...options, cursor });
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async task(handle: string, taskId: string): Promise<A2ATask> {
    return parseA2ATask(
      await this.http.get<Raw>(`${base(handle)}/tasks/${taskId}`),
    );
  }

  async sentTasks(
    handle: string,
    options: A2ASentTaskListOptions = {},
  ): Promise<A2ATaskPage> {
    const raw = await this.http.get<Raw>(`${base(handle)}/sent/tasks`, {
      requester_handle: options.requesterHandle,
      worker_handle: options.workerHandle,
      state: options.state,
      context_id: options.contextId,
      q: options.q,
      since: options.since,
      cursor: options.cursor,
      limit: options.limit ?? 50,
    });
    return {
      items: (raw.items ?? []).map(parseA2ATask),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  async *iterSentTasks(
    handle: string,
    options: Omit<A2ASentTaskListOptions, "cursor"> = {},
  ): AsyncGenerator<A2ATask> {
    let cursor: string | undefined;
    do {
      const page = await this.sentTasks(handle, { ...options, cursor });
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async sentTask(handle: string, taskId: string): Promise<A2ATask> {
    return parseA2ATask(
      await this.http.get<Raw>(`${base(handle)}/sent/tasks/${taskId}`),
    );
  }

  async messages(
    handle: string,
    options: A2AMessageListOptions = {},
  ): Promise<A2AHistoryMessagePage> {
    const raw = await this.http.get<Raw>(`${base(handle)}/messages`, {
      direction: options.direction,
      requester_handle: options.requesterHandle,
      worker_handle: options.workerHandle,
      task_id: options.taskId,
      context_id: options.contextId,
      role: options.role,
      q: options.q,
      since: options.since,
      cursor: options.cursor,
      limit: options.limit ?? 50,
    });
    return {
      items: (raw.items ?? []).map(parseA2AHistoryMessage),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  async *iterMessages(
    handle: string,
    options: Omit<A2AMessageListOptions, "cursor"> = {},
  ): AsyncGenerator<A2AHistoryMessage> {
    let cursor: string | undefined;
    do {
      const page = await this.messages(handle, { ...options, cursor });
      yield* page.items;
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  async reply(
    handle: string,
    taskId: string,
    options: {
      intent: A2AReplyIntent;
      text?: string;
      parts?: Record<string, unknown>[];
    },
  ): Promise<A2ATask> {
    if ((options.text === undefined) === (options.parts === undefined)) {
      throw new TypeError("Pass exactly one of text or parts");
    }
    return parseA2ATask(
      await this.http.post<Raw>(`${base(handle)}/tasks/${taskId}/reply`, {
        intent: options.intent,
        parts: options.text === undefined ? options.parts : [{ text: options.text }],
      }),
    );
  }

  async contexts(
    handle: string,
    options: {
      direction?: "inbound" | "outbound" | "both";
      cursor?: string;
      limit?: number;
    } = {},
  ): Promise<A2AContextPage> {
    const raw = await this.http.get<Raw>(`${base(handle)}/contexts`, {
      direction: options.direction,
      cursor: options.cursor,
      limit: options.limit ?? 50,
    });
    return {
      items: (raw.items ?? []).map(parseA2AContext),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  async context(handle: string, contextId: string): Promise<A2AContext> {
    return parseA2AContext(
      await this.http.get<Raw>(`${base(handle)}/contexts/${contextId}`),
    );
  }

  async sentContexts(
    handle: string,
    options: { cursor?: string; limit?: number } = {},
  ): Promise<A2AContextPage> {
    const raw = await this.http.get<Raw>(`${base(handle)}/sent/contexts`, {
      cursor: options.cursor,
      limit: options.limit ?? 50,
    });
    return {
      items: (raw.items ?? []).map(parseA2AContext),
      nextCursor: raw.next_cursor ?? null,
    };
  }

  async sentContext(handle: string, contextId: string): Promise<A2AContext> {
    return parseA2AContext(
      await this.http.get<Raw>(
        `${base(handle)}/sent/contexts/${contextId}`,
      ),
    );
  }

  async contactRules(handle: string): Promise<A2AContactRule[]> {
    return (
      await this.http.get<Raw[]>(`${base(handle)}/contact-rules`)
    ).map(parseRule);
  }

  async addContactRule(
    handle: string,
    options: {
      handle: string;
      action: A2ARuleAction;
      direction?: A2ARuleDirection;
    },
  ): Promise<A2AContactRule> {
    return parseRule(
      await this.http.post<Raw>(`${base(handle)}/contact-rules`, {
        action: options.action,
        match_type: "handle",
        match_target: options.handle,
        direction: ruleDirection(options.direction ?? "inbound"),
      }),
    );
  }

  async updateContactRule(
    handle: string,
    ruleId: string,
    options: {
      action?: A2ARuleAction;
      direction?: A2ARuleDirection;
    },
  ): Promise<A2AContactRule> {
    if (options.action === undefined && options.direction === undefined) {
      throw new TypeError("Pass at least one of action or direction");
    }
    const body = {
      action: options.action,
      direction: options.direction === undefined
        ? undefined
        : ruleDirection(options.direction),
    };
    return parseRule(
      await this.http.patch<Raw>(
        `${base(handle)}/contact-rules/${ruleId}`,
        body,
      ),
    );
  }

  async deleteContactRule(handle: string, ruleId: string): Promise<void> {
    await this.http.delete(`${base(handle)}/contact-rules/${ruleId}`);
  }
}
