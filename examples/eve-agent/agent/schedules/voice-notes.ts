import { createVoiceNoteRecoveryRequest } from "@inkbox/chat-sdk-adapter";
import { defineSchedule } from "eve/schedules";

export default defineSchedule({
  cron: "* * * * *",
  async run() {
    const url = process.env.INKBOX_WEBHOOK_URL;
    const secret = process.env.INKBOX_SIGNING_SECRET;
    if (!url || !secret)
      throw new Error("Configure the Inkbox webhook URL and signing secret.");
    // The bridge establishes its channel send context inside the webhook route.
    const response = await fetch(createVoiceNoteRecoveryRequest(url, secret));
    if (!response.ok)
      throw new Error(`Voice-note recovery returned HTTP ${response.status}`);
  },
});
