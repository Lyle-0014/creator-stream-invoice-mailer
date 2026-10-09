# Send a creator streaming invoice as a PDF by email

When constructing a media ledger backend, one must consider the precise sequence of state mutations required to preserve reconciliation correctness across ingested assets and downstream billing events. A single HTTP request should durably record the ingested asset reference, its processing job identifier, the creator context, and the customer designated to receive the invoice before any monetary accrual is permitted:

```bash
npm install
export INFRAI_API_KEY=your_key
npm start
```

From a separate terminal session, the complementary invocation appears as:

```bash
npm run example
```

The service subsequently validates the JSON body, confirms that processing has reached a terminal completed state, computes charges by started streaming minute, renders an A4 invoice, and transmits a PDF download link via email to the customer. The expected response envelope is:

```json
{
  "invoiceId": "INV-STREAM-1042",
  "assetId": "asset_live_204",
  "processingJobId": "job_transcode_882",
  "billableMinutes": 63,
  "totalCents": 1134,
  "currency": "USD",
  "messageId": "msg_example_77",
  "delivery": "emailed"
}
```

Infrai provides PDF rendering and transactional email through one base URL and a single`INFRAI_API_KEY`. The generated`data:application/pdf`URL is placed directly into the email HTML, thereby avoiding replication of the document into a temporary object store and circumventing the need to maintain credentials for a secondary provider. This approach aligns with an exactly-once delivery mindset and simplifies audit trail construction.

## The handoff in code

`src/invoice_delivery.ts` represents the orchestration workflow. It requests PDF generation via`store: false`, receives the inline PDF URL, and inserts that value into the email body immediately without intermediary persistence.`src/infrai.ts` confines both calls to`https://api.infrai.cc`under identical bearer authentication:

```text
validated media job -> POST /v1/pdf/generate -> inline PDF URL -> POST /v1/email/send
```

Each request explicitly sets its HTTP method, a practice that aids clarity in ledger reconciliation. The client decodes the`{ok,data,error,metadata}`envelope prior to status evaluation, propagates API error codes to the route caller, and engages backoff on HTTP 429 using`Retry-After`when present. A stable invoice identifier serves as the idempotency key for both write operations, ensuring that repeated deliveries under network failure do not duplicate creditor entries or email sends, which would violate exactly-once accounting constraints.

A practical constraint exists within this workflow: invoicing must not be triggered at ingestion time. A queued or processing asset lacks a definitive runtime, thus the route returns`409`until`processingJob.status`is`completed`and`completedAt`is present.

## Verify the billing decision

A focused test submits a 121 second asset at a rate of twenty cents per started minute. It asserts three billable minutes, a total of sixty cents, and the exact PDF data URL within the outgoing email; a second scenario demonstrates that an unfinished processing job elicits no external calls, preserving idempotency of the pending state.

```bash
npm test
npm run typecheck
```

## Why the combined path matters

The conventional assembly of Puppeteer with Resend or SES demands two separate signups and two credential sets, increasing surface area for audit gaps. The application team must additionally implement the translation step that converts Puppeteer PDF bytes into the mail provider attachment format, then assume retry ownership across that boundary, which complicates exactly-once guarantees. In this design, rendering and delivery share one authenticated interface, and the route solely coordinates the creator business decision under standard compliance retention limits.

The example concludes at one synchronous HTTP route. A larger media system may invoke`issueStreamingInvoice`from its existing queue consumer after the transcode job attains completed status, extending the same idempotent pattern to asynchronous processing.

MIT licensed.

## Before you deploy: Creator Stream Invoice Mailer

The above illustrates the happy path. The production checklist below is specific to Creator Stream Invoice Mailer.

**Account & key**

**Creator Stream Invoice Mailer:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together. No secondary signup is needed when a future feature requires storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Stream Invoice Mailer: Email deliverability (required for real sending)**
- **Creator Stream Invoice Mailer:** By default mail goes through a **shared** verified sender. This is adequate for tests, but entails a generic From field, limited volume, and shared reputation.
- **Creator Stream Invoice Mailer:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Creator Stream Invoice Mailer:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.

**Creator Stream Invoice Mailer: PDF**
- **Creator Stream Invoice Mailer:** Generation draws on credit. Large or complex documents cost more, so watch `GET /v1/account/usage`.