import { Inkbox, type IdentityPackMutationResponse, type IdentityPackQuote, type IdentityPacksResponse } from "../dist/index.js";

const billing = new Inkbox({ apiKey: "synthetic-admin-key" }).billing;
const requestKey = "22222222-2222-4222-8222-222222222222";
const agreementId = "11111111-1111-4111-8111-111111111111";
const page: Promise<IdentityPacksResponse> = billing.identityPacks({ cursor: agreementId, limit: 1 });
const quote: Promise<IdentityPackQuote> = billing.quoteIdentityPack();
const paymentMode: Promise<"quantity"> = quote.then(value => value.payment_mode);
const purchase: Promise<IdentityPackMutationResponse> = billing.purchaseIdentityPack({ quote: "accepted", requestKey });
const cancel: Promise<IdentityPackMutationResponse> = billing.cancelIdentityPack(agreementId, { requestKey });
const resume: Promise<IdentityPackMutationResponse> = billing.resumeIdentityPack(agreementId, { requestKey });
void [page, quote, paymentMode, purchase, cancel, resume];

// @ts-expect-error Purchases require a caller-supplied request UUID.
billing.purchaseIdentityPack({ quote: "accepted" });
// @ts-expect-error Cancellation requires its own request UUID.
billing.cancelIdentityPack(agreementId);
// @ts-expect-error Resume requires its own request UUID.
billing.resumeIdentityPack(agreementId);
// @ts-expect-error Purchases do not accept payment return URLs.
billing.purchaseIdentityPack({ quote: "accepted", requestKey, successUrl: "https://example.com/return" });
// @ts-expect-error Purchases do not accept payment cancellation URLs.
billing.purchaseIdentityPack({ quote: "accepted", requestKey, cancelUrl: "https://example.com/return" });
