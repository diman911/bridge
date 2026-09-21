/** Version 1 wire metadata carried in the first multipart part. */
export interface AttachmentMetaV1 {
  protocolVersion: number;
  project_id: string;
  tracker_instance_id: string;
  issueId: string;
  filename: string;
  contentType: string;
  idempotencyKey: string;
}
