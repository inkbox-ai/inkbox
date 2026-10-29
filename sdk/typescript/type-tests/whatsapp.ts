import type { Inkbox, AgentIdentity, WhatsAppMessage, WhatsAppMedia, WhatsAppWebhookPayload, WhatsAppCorrespondenceItem, WhatsAppChannelStatus } from "../dist/index.js";
declare const client: Inkbox;
declare const identity: AgentIdentity;
const message: Promise<WhatsAppMessage> = identity.sendWhatsApp({to:["+15555550101"],text:"Hello",mediaIds:["owned-media-id"],idempotencyKey:"stable-key"});
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
