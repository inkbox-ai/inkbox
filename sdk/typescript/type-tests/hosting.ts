// sdk/typescript/type-tests/hosting.ts
import type { HostingModel, HostingUpdate, ScheduleHistory, HostedWorkspace } from "../dist/index.js";

const model: HostingModel = "gpt-6.1-terra";
const update: HostingUpdate = {expectedGeneration: 1, defaultModel: model, idleTimeoutSeconds: 600};
void update;
// @ts-expect-error Hosted agents require automatic idle shutdown.
const alwaysOn: HostingUpdate = {expectedGeneration: 1, idleStopEnabled: false};
// @ts-expect-error Arbitrary idle intervals are not supported.
const arbitraryInterval: HostingUpdate = {expectedGeneration: 1, idleTimeoutSeconds: 60};
void alwaysOn;
void arbitraryInterval;

async function readHistory(workspace: HostedWorkspace): Promise<ScheduleHistory> {
  const history = await workspace.scheduleHistory("schedule");
  const completeness: "partial" | "unavailable" = history.history_completeness;
  const conversation: string | null = history.conversation_id;
  // @ts-expect-error Schedule history is not a cursor-paginated endpoint.
  history.next_cursor;
  void completeness;
  void conversation;
  return history;
}
void readHistory;
