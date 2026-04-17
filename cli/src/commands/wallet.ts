import { readFile } from "node:fs/promises";
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

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function readUtf8Input(path: string): Promise<string> {
  if (path === "-") {
    return (await readStdin()).toString("utf8");
  }
  return readFile(path, "utf8");
}

async function readBinaryInput(path: string): Promise<Buffer> {
  if (path === "-") {
    return readStdin();
  }
  return readFile(path);
}

async function resolveSignAuthMessage(
  options: { message?: string; messageFile?: string },
): Promise<string> {
  if (options.message !== undefined && options.messageFile !== undefined) {
    throw new Error("Use either --message or --message-file, not both.");
  }
  if (options.messageFile !== undefined) {
    return readUtf8Input(options.messageFile);
  }
  if (options.message === "-") {
    return readUtf8Input("-");
  }
  if (options.message !== undefined) {
    return options.message;
  }
  throw new Error("Provide --message or --message-file.");
}

async function resolveBodyBase64(
  options: { bodyBase64?: string; bodyFile?: string; bodyJson?: string },
): Promise<string | undefined> {
  const provided = [
    options.bodyBase64 !== undefined ? "--body-base64" : null,
    options.bodyFile !== undefined ? "--body-file" : null,
    options.bodyJson !== undefined ? "--body-json" : null,
  ].filter((value): value is string => value !== null);

  if (provided.length > 1) {
    throw new Error(`Use only one of ${provided.join(", ")}.`);
  }
  if (options.bodyBase64 !== undefined) {
    return options.bodyBase64;
  }
  if (options.bodyFile !== undefined) {
    return (await readBinaryInput(options.bodyFile)).toString("base64");
  }
  if (options.bodyJson !== undefined) {
    return Buffer.from(options.bodyJson, "utf8").toString("base64");
  }
  return undefined;
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
    .option("--message <message>", "The full auth challenge text to sign; pass '-' to read from stdin")
    .option("--message-file <path>", "Read the full auth challenge text from a file or '-' for stdin")
    .action(
      withErrorHandler(async function (
        this: Command,
        walletId: string,
        cmdOpts: { message?: string; messageFile?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const message = await resolveSignAuthMessage(cmdOpts);
        const signature = await inkbox.wallets.signAuth(walletId, {
          message,
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
    .command("pay-request <wallet-id>")
    .description("Make an HTTP request and automatically pay any supported 402 challenge")
    .requiredOption("--url <url>", "Target URL")
    .option("--method <method>", "HTTP method", "GET")
    .option("--header <header>", "Header in 'Name: value' form; repeat as needed", collect, [])
    .option("--body-base64 <body>", "Base64-encoded request body")
    .option("--body-file <path>", "Read raw request bytes from a file or '-' for stdin and base64-encode them")
    .option("--body-json <json>", "Encode a JSON string as UTF-8 and base64-encode it")
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
          bodyFile?: string;
          bodyJson?: string;
          maxCost?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const bodyBase64 = await resolveBodyBase64(cmdOpts);
        const result = await inkbox.wallets.payRequest(walletId, {
          url: cmdOpts.url,
          method: cmdOpts.method,
          headers: parseHeaders(cmdOpts.header),
          bodyBase64,
          maxCost: cmdOpts.maxCost,
        });
        output(result, { json: !!opts.json });
      }),
    );
}
