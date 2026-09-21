/** Version 1 wire metadata carried in the first multipart part. */
/** Conservative ceiling (5 MiB) until per-provider limits are measured. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Trusted routing hints for the attachment endpoint. */
export const ATTACHMENT_PROJECT_ID_HEADER = 'X-Fairlead-Project-Id';
export const ATTACHMENT_INTEGRATION_INSTANCE_ID_HEADER =
  'X-Fairlead-Integration-Instance-Id';

export interface AttachmentMetaV1 {
  protocolVersion: number;
  issueId: string;
  filename: string;
  contentType: string;
}
