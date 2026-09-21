/** Version 1 wire metadata carried in the first multipart part. */
/** Conservative ceiling (5 MiB) until per-provider limits are measured. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export interface AttachmentMetaV1 {
  protocolVersion: number;
  project_id: string;
  tracker_instance_id: string;
  issueId: string;
  filename: string;
  contentType: string;
  idempotencyKey: string;
}
