import type { BundleCode, IdentityPackMutationResponse } from "@inkbox/sdk";
import { Command, InvalidArgumentError } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function requestUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new InvalidArgumentError("Expected a UUID request key");
  }
  return value;
}

async function identityPackMutation(requestKey: string, action: () => Promise<IdentityPackMutationResponse>): Promise<void> {
  try {
    output({ ...await action(), request_key: requestKey }, { json: true });
  } catch (error) {
    if (error instanceof Error) Object.assign(error, { requestKey });
    throw error;
  }
}

export function registerBillingCommands(program: Command): void {
  const billing = program.command("billing").description("Organization-admin pricing and add-on subscriptions");
  billing.command("pricing").description("Read published and contracted usage rates").action(withErrorHandler(async function (this: Command) {
    output(await createClient(getGlobalOpts(this)).billing.pricing() as unknown as Record<string, unknown>, { json: true });
  }));
  const countries = billing.command("countries").description("Manage calling-country subscriptions");
  countries.command("list").action(withErrorHandler(async function (this: Command) {
    output(await createClient(getGlobalOpts(this)).billing.callingCountries() as unknown as Record<string, unknown>, { json: true });
  }));
  countries.command("quote <country-code>").description("Preview the entire immediate invoice before paying").action(withErrorHandler(async function (this: Command, country: string) {
    output(await createClient(getGlobalOpts(this)).billing.quoteCountry(country) as unknown as Record<string, unknown>, { json: true });
  }));
  countries.command("purchase <country-code>").description("Pay the accepted quote; reuse the request key when retrying")
    .requiredOption("--quote <quote>", "Signed quote from countries quote")
    .requiredOption("--request-key <uuid>", "Stable UUID for this purchase and every retry")
    .requiredOption("--confirm", "Confirm the displayed invoice charge")
    .action(withErrorHandler(async function (this: Command, country: string, options: { quote: string; requestKey: string }) {
      output(await createClient(getGlobalOpts(this)).billing.purchaseCountry(country, options) as unknown as Record<string, unknown>, { json: true });
    }));
  countries.command("quote-many <country-codes...>").description("Preview one invoice for several countries")
    .action(withErrorHandler(async function (this: Command, codes: string[]) {
      output(await createClient(getGlobalOpts(this)).billing.quoteCountries(codes) as unknown as Record<string, unknown>, { json: true });
    }));
  countries.command("purchase-many <country-codes...>").description("Pay once for the quoted country selection")
    .requiredOption("--quote <quote>", "Signed quote from countries quote-many")
    .requiredOption("--request-key <uuid>", "Stable UUID for this purchase and every retry")
    .requiredOption("--confirm", "Confirm the displayed invoice charge")
    .action(withErrorHandler(async function (this: Command, codes: string[], options: { quote: string; requestKey: string }) {
      output(await createClient(getGlobalOpts(this)).billing.purchaseCountries(codes, options) as unknown as Record<string, unknown>, { json: true });
    }));
  countries.command("cancel <agreement-id>").description("Stop renewal; retain the already paid period").action(withErrorHandler(async function (this: Command, id: string) {
    output(await createClient(getGlobalOpts(this)).billing.cancelCountry(id) as unknown as Record<string, unknown>, { json: true });
  }));
  countries.command("resume <agreement-id>").description("Resume at the existing price before coverage expires").action(withErrorHandler(async function (this: Command, id: string) {
    output(await createClient(getGlobalOpts(this)).billing.resumeCountry(id) as unknown as Record<string, unknown>, { json: true });
  }));
  const bundles = billing.command("line-bundles").description("Additional line slots and shared usage credits");
  bundles.command("list").action(withErrorHandler(async function (this: Command) {
    output(await createClient(getGlobalOpts(this)).billing.lineBundles() as unknown as Record<string, unknown>, { json: true });
  }));
  bundles.command("quote <code>").description("Preview prorated charges and credits for a line bundle")
    .action(withErrorHandler(async function (this: Command, code: BundleCode) {
      output(await createClient(getGlobalOpts(this)).billing.quoteLineBundle(code) as unknown as Record<string, unknown>, { json: true });
    }));
  bundles.command("purchase <code>").description("Pay for voip_line_bundle or personal_imessage_line_bundle")
    .requiredOption("--quote <quote>", "Signed quote from line-bundles quote")
    .requiredOption("--request-key <uuid>", "Stable UUID for this purchase and every retry")
    .requiredOption("--confirm", "Confirm the displayed invoice charge")
    .action(withErrorHandler(async function (this: Command, code: BundleCode, options: { quote: string; requestKey: string }) {
      output(await createClient(getGlobalOpts(this)).billing.purchaseLineBundle(code, options) as unknown as Record<string, unknown>, { json: true });
    }));
  bundles.command("cancel <agreement-id>").description("Remove an unused slot and stop renewal; keep paid usage credits")
    .action(withErrorHandler(async function (this: Command, id: string) {
      output(await createClient(getGlobalOpts(this)).billing.cancelLineBundle(id) as unknown as Record<string, unknown>, { json: true });
    }));
  bundles.command("resume <agreement-id>").description("Restore capacity and renewal without refilling credits")
    .action(withErrorHandler(async function (this: Command, id: string) {
      output(await createClient(getGlobalOpts(this)).billing.resumeLineBundle(id) as unknown as Record<string, unknown>, { json: true });
    }));

  const packs = billing.command("identity-packs").description("Manage identity capacity add-ons; quotes, purchases and resumes require an active paid plan");
  packs.command("list").description("Read a page of agreements and total capacity; check status after payment")
    .option("--cursor <uuid>", "Next cursor from the previous page")
    .option("--limit <n>", "Maximum agreements (1-100, default 100)", (value: string) => {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new InvalidArgumentError("Expected an integer from 1 to 100");
      return limit;
    })
    .action(withErrorHandler(async function (this: Command, options: { cursor?: string; limit?: number }) {
      output(await createClient(getGlobalOpts(this)).billing.identityPacks(options) as unknown as Record<string, unknown>, { json: true });
    }));
  packs.command("quote").description("Preview proration to the active paid plan's existing monthly boundary")
    .action(withErrorHandler(async function (this: Command) {
      output(await createClient(getGlobalOpts(this)).billing.quoteIdentityPack() as unknown as Record<string, unknown>, { json: true });
    }));
  packs.command("purchase").description("Charge the quoted proration now; complete any payment_url action, then check list")
    .requiredOption("--quote <quote>", "Signed quote from identity-packs quote; retain it for retries")
    .requiredOption("--request-key <uuid>", "UUID for this purchase; reuse it for every retry", requestUuid)
    .requiredOption("--confirm", "Confirm the immediate prorated charge and renewal on the existing monthly cycle")
    .action(withErrorHandler(async function (this: Command, options: { quote: string; requestKey: string }) {
      const client = createClient(getGlobalOpts(this));
      await identityPackMutation(options.requestKey, () => client.billing.purchaseIdentityPack(options));
    }));
  packs.command("cancel <agreement-id>").description("Stop only pack renewal; retain capacity through the paid-through date")
    .requiredOption("--request-key <uuid>", "UUID for this cancellation; reuse it for every retry", requestUuid)
    .action(withErrorHandler(async function (this: Command, id: string, options: { requestKey: string }) {
      const client = createClient(getGlobalOpts(this));
      await identityPackMutation(options.requestKey, () => client.billing.cancelIdentityPack(id, options));
    }));
  packs.command("resume <agreement-id>").description("Resume before expiry on an active paid plan using a new action request key")
    .requiredOption("--request-key <uuid>", "UUID for this resume action; reuse it for every retry", requestUuid)
    .action(withErrorHandler(async function (this: Command, id: string, options: { requestKey: string }) {
      const client = createClient(getGlobalOpts(this));
      await identityPackMutation(options.requestKey, () => client.billing.resumeIdentityPack(id, options));
    }));
}
