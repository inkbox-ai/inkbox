/** Transcription result for an incoming audio attachment. */
export type TranscriptionStatus = "pending" | "completed" | "failed" | "skipped";
export interface MediaTranscription {
  status: TranscriptionStatus;
  text: string | null;
  errorCode: string | null;
}
export interface RawMediaTranscription {
  status: TranscriptionStatus;
  text: string | null;
  error_code: string | null;
}
export function parseMediaTranscription(r: RawMediaTranscription): MediaTranscription {
  return { status: r.status, text: r.text, errorCode: r.error_code };
}
