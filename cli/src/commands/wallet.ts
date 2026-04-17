import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

function parseCsv(value?: string): string[] | undefined {
  if (value === undefined) return undefined;
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

function collect(value: string, previous: string[] = []): string[] {
  previous.push(value);
  return previous;
}

function parseHeaders(values: string[] | undefined): Record<string, string> | undefined {
  if (!values || values.length === 0) return undefined;
  const headers: Record<string, string> = {};
  for (const entry of values) {
    const idx = entry.indexOf(":");
    if (idx <= 0) {
      throw new Error(`Invalid header '${entry}'. Use 'Name: value'.`);
    }
    const name = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (!name) {
      throw new Error(`Invalid header '${entry}'. Header name cannot be empty.`);
    }
    headers[name] = value;
  }
  return headers;
}

export function registerWalletCommands(program: Command): void {
  const wallet = program
    .command("wallet")
    .description("Custodial wallet operations");

  wallet
    .command("list")
    .description("List wallets visible to the caller")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const wallets = await inkbox.wallets.list();
        output(
          wallets.map((item) => ({
            id: item.id,
            agentIdentityId: item.agentIdentityId,
            status: item.status,
            evmAddress: item.addresses["evm"] ?? null,
            chains: item.chains.map((chain) => chain.chain).join(", "),
            createdAt: item.createdAt,
          })),
          {
            json: !!opts.json,
            columns: ["id", "agentIdentityId", "status", "evmAddress", "chains", "createdAt"],
          },
        );
      }),
    );

  wallet
    .command("create")
    .description("Create a new wallet for an identity")
    .requiredOption("--handle <handle>", "Agent handle to create the wallet for")
    .option("--chains <chains>", "Comma-separated chain list, e.g. base,tempo")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { handle: string; chains?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const created = await inkbox.wallets.create({
          agentHandle: cmdOpts.handle,
          chains: parseCsv(cmdOpts.chains),
        });
        output(
          {
            id: created.id,
            agentIdentityId: created.agentIdentityId,
            status: created.status,
            evmAddress: created.addresses["evm"] ?? null,
            chains: created.chains.map((chain) => chain.chain).join(", "),
            createdAt: created.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  wallet
    .command("get <wallet-id>")
    .description("Get wallet details")
    .action(
      withErrorHandler(async function (this: Command, walletId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const item = await inkbox.wallets.get(walletId);
        output(
          {
            id: item.id,
            organizationId: item.organizationId,
            agentIdentityId: item.agentIdentityId,
            status: item.status,
            addresses: item.addresses,
            chains: item.chains.map((chain) => chain.chain),
            createdAt: item.createdAt,
            updatedAt: item.updatedAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  wallet
    .command("balance <wallet-id>")
    .description("Fetch live on-chain wallet balances")
    .action(
      withErrorHandler(async function (this: Command, walletId: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const balance = await inkbox.wallets.getBalance(walletId);
        output(balance, { json: !!opts.json });
      }),
    );

  wallet
    .command("send <wallet-id>")
    .description("Broadcast an outbound wallet transaction")
    .requiredOption("--chain <chain>", "Chain, e.g. base or tempo")
    .requiredOption("--to <address>", "Destination address")
    .requiredOption("--token <token>", "Token symbol, e.g. ETH, USDC, USDC.e")
    .requiredOption("--amount <amount>", "Decimal amount string")
    .option("--memo <memo>", "Optional transaction memo")
    .option("--idempotency-key <key>", "Optional idempotency key")
    .action(
      withErrorHandler(async function (
        this: Command,
        walletId: string,
        cmdOpts: {
          chain: string;
          to: string;
          token: string;
          amount: string;
          memo?: string;
          idempotencyKey?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const tx = await inkbox.wallets.send(walletId, {
          chain: cmdOpts.chain,
          toAddress: cmdOpts.to,
          token: cmdOpts.token,
          amount: cmdOpts.amount,
          memo: cmdOpts.memo,
          idempotencyKey: cmdOpts.idempotencyKey,
        });
        output(
          {
            id: tx.id,
            chain: tx.chain,
            token: tx.token,
            amountDecimal: tx.amountDecimal,
            status: tx.status,
            chainTxHash: tx.chainTxHash,
            toAddress: tx.toAddress,
            createdAt: tx.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  wallet
    .command("sign-auth <wallet-id>")
    .description("Sign a SIWE-style authentication challenge")
    .requiredOption("--message <message>", "The full auth challenge text to sign")
    .action(
      withErrorHandler(async function (
        this: Command,
        walletId: string,
        cmdOpts: { message: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const signature = await inkbox.wallets.signAuth(walletId, {
          message: cmdOpts.message,
        });
        output(signature, { json: !!opts.json });
      }),
    );

  wallet
    .command("transactions <wallet-id>")
    .description("List wallet transactions from the server audit log")
    .option("--chain <chain>", "Filter by chain")
    .option("--status <status>", "Filter by status")
    .option("--limit <n>", "Maximum rows to return", "50")
    .action(
      withErrorHandler(async function (
        this: Command,
        walletId: string,
        cmdOpts: { chain?: string; status?: string; limit: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const transactions = await inkbox.wallets.listTransactions(walletId, {
          chain: cmdOpts.chain,
          status: cmdOpts.status,
          limit: parseInt(cmdOpts.limit, 10),
        });
        output(transactions, {
          json: !!opts.json,
          columns: ["id", "chain", "token", "amountDecimal", "status", "chainTxHash", "createdAt"],
        });
      }),
    );

  wallet
    .command("receipt <wallet-id> <transaction-id>")
    .description("Fetch the on-chain receipt state for one wallet transaction")
    .action(
      withErrorHandler(async function (
        this: Command,
        walletId: string,
        transactionId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const receipt = await inkbox.wallets.getTransactionReceipt(walletId, transactionId);
        output(receipt, { json: !!opts.json });
      }),
    );

  wallet
    .command("onchain-transactions <wallet-id>")
    .description("List read-through on-chain transaction history for a wallet")
    .option("--chain <chain>", "Chain to query")
    .option("--direction <direction>", "Filter by direction: in or out")
    .option("--cursor <cursor>", "Opaque cursor from a previous response")
    .option("--limit <n>", "Maximum rows to return", "50")
    .action(
      withErrorHandler(async function (
        this: Command,
        walletId: string,
        cmdOpts: { chain?: string; direction?: string; cursor?: string; limit: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const page = await inkbox.wallets.listOnchainTransactions(walletId, {
          chain: cmdOpts.chain,
          direction: cmdOpts.direction,
          cursor: cmdOpts.cursor,
          limit: parseInt(cmdOpts.limit, 10),
        });
        output(
          page.items,
          {
            json: !!opts.json,
            columns: ["hash", "chain", "direction", "token", "amountDecimal", "status", "confirmedAt"],
          },
        );
      }),
    );

  wallet
    .command("pay-request <wallet-id>")
    .description("Make an HTTP request and automatically pay any supported 402 challenge")
    .requiredOption("--url <url>", "Target URL")
    .option("--method <method>", "HTTP method", "GET")
    .option("--header <header>", "Header in 'Name: value' form; repeat as needed", collect, [])
    .option("--body-base64 <body>", "Base64-encoded request body")
    .option("--max-cost <usd>", "Maximum payment amount in USD")
    .action(
      withErrorHandler(async function (
        this: Command,
        walletId: string,
        cmdOpts: {
          url: string;
          method: string;
          header: string[];
          bodyBase64?: string;
          maxCost?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const result = await inkbox.wallets.payRequest(walletId, {
          url: cmdOpts.url,
          method: cmdOpts.method,
          headers: parseHeaders(cmdOpts.header),
          bodyBase64: cmdOpts.bodyBase64,
          maxCost: cmdOpts.maxCost,
        });
        output(result, { json: !!opts.json });
      }),
    );
}
