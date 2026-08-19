import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import type { MailAttachmentInput } from "@inkbox/sdk";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".html": "text/html",
  ".json": "application/json",
  ".zip": "application/zip",
};

export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function contentTypeForPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export function parseInlineImageSpec(spec: string): { cid: string; path: string } {
  const eq = spec.indexOf("=");
  if (eq <= 0 || eq === spec.length - 1) {
    throw new Error(`--inline-image must be <cid>=<path>, got: ${spec}`);
  }
  return { cid: spec.slice(0, eq).trim(), path: spec.slice(eq + 1).trim() };
}

function fileToAttachment(path: string, contentId?: string): MailAttachmentInput {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    throw new Error(`Cannot read attachment file: ${path}`);
  }
  const attachment: MailAttachmentInput = {
    filename: basename(path),
    contentType: contentTypeForPath(path),
    contentBase64: buf.toString("base64"),
  };
  if (contentId !== undefined) attachment.contentId = contentId;
  return attachment;
}

export function buildAttachments(
  attach: string[],
  inlineImage: string[],
): MailAttachmentInput[] | undefined {
  const attachments = attach.map((path) => fileToAttachment(path));
  for (const spec of inlineImage) {
    const parsed = parseInlineImageSpec(spec);
    const attachment = fileToAttachment(parsed.path, parsed.cid);
    if (!attachment.contentType.startsWith("image/")) {
      throw new Error(
        `--inline-image ${parsed.cid} must be an image; got ${attachment.contentType} for ${parsed.path}.`,
      );
    }
    attachments.push(attachment);
  }
  return attachments.length > 0 ? attachments : undefined;
}
