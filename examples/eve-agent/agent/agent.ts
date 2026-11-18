import { defineAgent } from "eve";

const model = process.env.EVE_MODEL;
if (!model) throw new Error("Set EVE_MODEL to a model configured for your Eve deployment.");

export default defineAgent({ model, defaultTools: false });
