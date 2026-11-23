import type { Inkbox, AgentIdentity, WhatsAppMessage, WhatsAppMedia, WhatsAppWebhookPayload, WhatsAppCorrespondenceItem, WhatsAppChannelStatus } from "../dist/index.js";
declare const client: Inkbox;
declare const identity: AgentIdentity;
const message: Promise<WhatsAppMessage> = identity.sendWhatsApp({to:"+15555550101",text:"Hello",mediaIds:["owned-media-id"],idempotencyKey:"stable-key"});
const attachment: Promise<WhatsAppMedia> = identity.getWhatsAppMedia("owned-media-id");
const status: Promise<WhatsAppChannelStatus|null> = identity.getWhatsAppStatus();
const direct: Promise<WhatsAppMessage> = client.whatsapp.send({conversationId:"conversation-id",text:"Hello",agentIdentityId:"identity-id"});
declare const webhook: WhatsAppWebhookPayload;
const event: "whatsapp.received"|"whatsapp.sent"|"whatsapp.delivered"|"whatsapp.delivery_failed"|"whatsapp.delivery_unconfirmed"|"whatsapp.reaction_received" = webhook.event_type;
const url: string|null = webhook.data.message!.media[0].url;
// @ts-expect-error Request-only refresh state is not delivered in notifications.
webhook.data.message!.status_refresh_pending;
// @ts-expect-error Blocked content is not sent to ordinary message receivers.
webhook.data.message!.is_blocked;
declare const history: WhatsAppCorrespondenceItem;
const channel: "whatsapp" = history.channel;
void [message,attachment,status,direct,event,url,channel];
const reactionTarget: string | undefined = webhook.data.reaction?.target_message_id;
const reactionActor: string | null | undefined = webhook.data.reaction?.remote_number;
const reactionEvent: WhatsAppWebhookPayload = { id: "evt-reaction", event_type: "whatsapp.reaction_received", timestamp: "2026-10-01T12:00:00Z", data: { reaction: null, contacts: [], agent_identities: [] } };
void [reactionTarget, reactionActor, reactionEvent];

// @ts-expect-error WhatsApp accepts one recipient string, not a recipient array.
identity.sendWhatsApp({to:["+15555550101"],text:"Hello"});

const groupReply: Promise<WhatsAppMessage> = identity.sendWhatsApp({conversationId:"conversation-id",replyToMessageId:"message-id",mediaIds:["owned-media-id"],gifPlayback:true});
declare const groupMessage: WhatsAppMessage;
const groupName: string | null = groupMessage.groupName;
const groupRemote: string | null = groupMessage.remoteNumber;
const groupSender: string | null = groupMessage.senderNumber;
const incomingGroup: boolean | undefined = webhook.data.message?.is_group;
void [groupReply, groupName, groupRemote, groupSender, incomingGroup];

import type { WhatsAppOnboarding } from "../dist/index.js";
const onboarding: Promise<WhatsAppOnboarding> = client.whatsapp.getOnboarding();
const ownOnboarding: Promise<WhatsAppOnboarding> = identity.getWhatsAppOnboarding();
void [onboarding, ownOnboarding];
const companionPhase: "ordinary" | "initialization" | "live" | undefined = webhook.companion?.phase;
void companionPhase;

const connected: Promise<import("../dist/index.js").WhatsAppConnectResult> = client.whatsapp.connect({agentIdentityId:"identity-id",recipientNumber:"+15555550101",idempotencyKey:"stable-key"});
// @ts-expect-error Connecting never sends an opening message.
client.whatsapp.connect({agentIdentityId:"identity-id",recipientNumber:"+15555550101",idempotencyKey:"stable-key",firstMessage:"Hi"});
// @ts-expect-error Connect requires a stable idempotency key.
client.whatsapp.connect({agentIdentityId:"identity-id",recipientNumber:"+15555550101"});
const sharedMedia: Promise<WhatsAppMedia> = identity.uploadWhatsAppMedia({content:new Uint8Array([1]),filename:"a.png",recipientNumber:"+15555550101"});
void [connected, sharedMedia];

import type { WhatsAppAssignment, WhatsAppTriageNumber, WhatsAppMarkReadResult } from "../dist/index.js";
const assignments: Promise<WhatsAppAssignment[]> = client.whatsapp.listAssignments({ limit: 20, offset: 0 });
const triage: Promise<WhatsAppTriageNumber> = client.whatsapp.getTriageNumber({ agentIdentityId: "agent-id" });
const allRead: Promise<WhatsAppMarkReadResult> = identity.markWhatsAppRead("conversation-id");
const typing: Promise<{ status: string }> = identity.sendWhatsAppTyping("conversation-id");
const removal: Promise<import("../dist/index.js").WhatsAppReaction> = identity.removeWhatsAppReaction("reaction-id", "stable-key");
const localNumber: string | null = groupMessage.localNumber;
void [assignments, triage, allRead, typing, removal, localNumber];

const directRemoval: Promise<import("../dist/index.js").WhatsAppReaction> = client.whatsapp.removeReaction("reaction-id", { idempotencyKey: "stable-key" });
void directRemoval;

declare const completed: import("../dist/index.js").MessageTranscriptionFinishedWebhookPayload;
const completionType: "message.transcription_finished" = completed.event_type;
const originalId: string = completed.data.message_id;
const sourceId: string | null | undefined = completed.data.channel === "text"
  ? completed.data.text_message.id
  : completed.data.channel === "slack"
    ? completed.data.message_ts
    : completed.data.message.id;
// @ts-expect-error The original message projection depends on the channel.
completed.data.text_message;
if (completed.data.channel === "slack") {
  const slackCompletion: import("../dist/index.js").SlackTranscriptionFinishedWebhookData = completed.data;
  const coordinates: [string, string | null | undefined, string | null | undefined] = [
    slackCompletion.connection_id, slackCompletion.conversation_id, slackCompletion.thread_ts,
  ];
  const files: unknown = slackCompletion.event.files;
  // @ts-expect-error Slack completions carry no contact list.
  slackCompletion.contacts;
  void [coordinates, files];
}
declare const received: import("../dist/index.js").SlackWebhookData;
const receivedKey: string | undefined = received.message_id;
declare const archived: import("../dist/index.js").SlackArchivedMessage;
const archivedTranscript: string | null | undefined = archived.files[0]?.transcription?.text;
void [completionType, originalId, sourceId, receivedKey, archivedTranscript];
