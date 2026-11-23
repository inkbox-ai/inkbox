import type { Inkbox, AgentIdentity, IMessage, TextMessage, WhatsAppMessage, SlackAction } from "../dist/index.js";
declare const client: Inkbox;
declare const identity: AgentIdentity;
const imessage: Promise<IMessage> = identity.sendIMessage({conversationId:"conversation-id",text:"Hello",sendAsVoiceNote:true,fallbackToText:false});
const text: Promise<TextMessage> = identity.sendText({to:"+15555550101",text:"Hello",sendAsVoiceNote:true});
const whatsapp: Promise<WhatsAppMessage> = identity.sendWhatsApp({conversationId:"conversation-id",text:"Hello",sendAsVoiceNote:true,fallbackToText:false});
const slack: Promise<SlackAction> = client.slack.sendMessage("connection-id",{conversationId:"CEXAMPLE",text:"Hello",idempotencyKey:"voice:1",sendAsVoiceNote:true,fallbackToText:false});
void [imessage, text, whatsapp, slack];
// @ts-expect-error sendAsVoiceNote is a boolean.
identity.sendText({to:"+15555550101",text:"Hello",sendAsVoiceNote:"yes"});
