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
