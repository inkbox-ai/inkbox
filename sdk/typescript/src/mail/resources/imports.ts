import { HttpTransport, MailImportUploadError } from "../../_http.js";
import {
  MailImportCreateResult,
  MailImportFormat,
  MailImportJob,
  MailImportJobPage,
  MailImportJobStatus,
  MailImportUploadTarget,
  RawCursorPage,
  RawMailImportCreateResult,
  RawMailImportJob,
  RawMailImportUploadTarget,
  parseMailImportJob,
  parseMailImportUploadTarget,
} from "../types.js";

export interface CreateMailImportOptions {
  sourceFormat?: MailImportFormat;
  originalAddresses?: string[];
  markAsRead?: boolean;
}

export interface ListMailImportsOptions {
  cursor?: string;
  limit?: number;
}

export interface UploadMailImportOptions {
  fileName?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface WaitForMailImportOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  onPoll?: (job: MailImportJob) => void;
}

const TERMINAL = new Set<MailImportJobStatus>([
  MailImportJobStatus.COMPLETED,
  MailImportJobStatus.FAILED,
  MailImportJobStatus.CANCELLED,
]);

export class MailboxImportsResource {
  constructor(private readonly http: HttpTransport) {}

  private base(emailAddress: string): string {
    return `/mailboxes/${emailAddress}/imports`;
  }

  async create(
    emailAddress: string,
    options: CreateMailImportOptions = {},
  ): Promise<MailImportCreateResult> {
    const data = await this.http.post<RawMailImportCreateResult>(this.base(emailAddress), {
      source_format: options.sourceFormat ?? MailImportFormat.AUTO,
      original_addresses: options.originalAddresses,
      mark_as_read: options.markAsRead ?? true,
    });
    return {
      job: parseMailImportJob(data.job),
      upload: parseMailImportUploadTarget(data.upload),
    };
  }

  async refreshUploadTarget(
    emailAddress: string,
    jobId: string,
  ): Promise<MailImportUploadTarget> {
    const data = await this.http.post<RawMailImportUploadTarget>(
      `${this.base(emailAddress)}/${jobId}/upload-url`,
    );
    return parseMailImportUploadTarget(data);
  }

  async upload(
    uploadTarget: MailImportUploadTarget,
    file: Blob,
    options: UploadMailImportOptions = {},
  ): Promise<void> {
    if (options.timeoutMs !== undefined && options.timeoutMs <= 0) {
      throw new RangeError("timeoutMs must be greater than zero");
    }
    const form = new FormData();
    for (const [name, value] of Object.entries(uploadTarget.fields)) {
      form.append(name, value);
    }
    const fileName = options.fileName
      ?? ("name" in file && typeof file.name === "string" ? file.name : "upload");
    form.append("file", file, fileName);
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener("abort", abort, { once: true });
    const timer = options.timeoutMs === undefined
      ? undefined
      : setTimeout(() => controller.abort(), options.timeoutMs);
    let response: Response;
    try {
      response = await fetch(uploadTarget.url, {
        method: "POST",
        body: form,
        credentials: "omit",
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new MailImportUploadError(response.status, await response.text());
      }
    } catch (error) {
      if (error instanceof MailImportUploadError) throw error;
      throw new MailImportUploadError(
        null,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }

  async start(emailAddress: string, jobId: string): Promise<MailImportJob> {
    const data = await this.http.post<RawMailImportJob>(
      `${this.base(emailAddress)}/${jobId}/start`,
    );
    return parseMailImportJob(data);
  }

  async get(emailAddress: string, jobId: string): Promise<MailImportJob> {
    return this.getWithTimeout(emailAddress, jobId);
  }

  private async getWithTimeout(
    emailAddress: string,
    jobId: string,
    timeoutMs?: number,
  ): Promise<MailImportJob> {
    const data = await this.http.get<RawMailImportJob>(
      `${this.base(emailAddress)}/${jobId}`,
      undefined,
      { timeoutMs },
    );
    return parseMailImportJob(data);
  }

  async list(
    emailAddress: string,
    options: ListMailImportsOptions = {},
  ): Promise<MailImportJobPage> {
    const data = await this.http.get<RawCursorPage<RawMailImportJob>>(
      this.base(emailAddress),
      { cursor: options.cursor, limit: options.limit ?? 50 },
    );
    return {
      items: data.items.map(parseMailImportJob),
      nextCursor: data.next_cursor,
      hasMore: data.has_more,
    };
  }

  async cancel(emailAddress: string, jobId: string): Promise<MailImportJob> {
    const data = await this.http.post<RawMailImportJob>(
      `${this.base(emailAddress)}/${jobId}/cancel`,
    );
    return parseMailImportJob(data);
  }

  async wait(
    emailAddress: string,
    jobId: string,
    options: WaitForMailImportOptions = {},
  ): Promise<MailImportJob> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    if (pollIntervalMs <= 0) throw new RangeError("pollIntervalMs must be greater than zero");
    const started = performance.now();
    while (true) {
      let remaining: number | undefined;
      if (options.timeoutMs !== undefined) {
        remaining = options.timeoutMs - (performance.now() - started);
        if (remaining <= 0) throw new Error(`Timed out waiting for import job ${jobId}`);
      }
      let job: MailImportJob;
      try {
        job = await this.getWithTimeout(emailAddress, jobId, remaining);
      } catch (error) {
        if (
          options.timeoutMs !== undefined
          && (performance.now() - started >= options.timeoutMs
            || (error instanceof Error && error.name === "AbortError"))
        ) {
          throw new Error(`Timed out waiting for import job ${jobId}`, { cause: error });
        }
        throw error;
      }
      options.onPoll?.(job);
      if (TERMINAL.has(job.status)) return job;
      let delay = pollIntervalMs;
      if (options.timeoutMs !== undefined) {
        const remaining = options.timeoutMs - (performance.now() - started);
        if (remaining <= 0) throw new Error(`Timed out waiting for import job ${jobId}`);
        delay = Math.min(delay, remaining);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
