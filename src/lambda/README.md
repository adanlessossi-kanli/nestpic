# Lambda: Thumbnail Handler

## Overview

`thumbnailHandler.ts` exports a `handler` function that is triggered by S3 `ObjectCreated` events on the `originals/` prefix. For each event record it:

1. URL-decodes the S3 object key.
2. Looks up the corresponding `media` row in the database by `s3_key`.
3. Calls `processMedia` to generate and store a JPEG thumbnail.

## Dead Letter Queue (DLQ)

The handler throws on any error so that Lambda retries the event according to the configured retry policy. After the maximum number of retries, failed events are routed to an **SQS Dead Letter Queue (DLQ)** for inspection and manual retry.

DLQ configuration is done in the AWS infrastructure layer (CDK / CloudFormation / Terraform) — not in this code. When deploying, attach an SQS queue as the DLQ on the Lambda function's event source mapping or function configuration.

## Deployment Notes

- Runtime: Node.js 20.x (or later)
- Trigger: S3 Event Notification — `s3:ObjectCreated:*` filtered to prefix `originals/`
- Environment variables required: `DATABASE_URL`, `AWS_REGION`, `S3_BUCKET` (same as the Next.js app)
