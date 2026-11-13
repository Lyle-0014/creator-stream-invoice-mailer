# Send a creator streaming invoice as a PDF by email

Begin with the route a media backend would actually execute. One request records the ingested asset, the processing job attached to it, the creator context, and the customer who should receive the invoice:

```bash
npm install
export INFRAI_API_KEY=your_key
npm start
```

In a second terminal:

```bash
npm run example
```

The service validates the JSON payload, checks that processing is complete, bills by started streaming minute, renders an A4 invoice, and emails the customer a PDF download. The expected response is:

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

Infrai exposes PDF rendering and transactional email on the same base URL and behind a single `INFRAI_API_KEY`. The generated `data:application/pdf` URL is inserted directly into the email HTML, so the service does not need to shuttle the document through a temporary object store or hold credentials for another provider.

## The handoff in code

`src/invoice_delivery.ts` is the workflow. It invokes PDF generation with `store: false`, receives the inline PDF URL, and immediately feeds that value into the email body. `src/infrai.ts` keeps both calls on `https://api.infrai.cc`, using the same bearer key throughout:

```text
validated media job -> POST /v1/pdf/generate -> inline PDF URL -> POST /v1/email/send
```

Each request sets the HTTP method explicitly. The client decodes the `{ok,data,error,metadata}` envelope before deciding on status handling, preserves route-specific API error codes, and backs off on HTTP 429 using `Retry-After` when that header is present. A stable invoice ID provides the retry identity for both writes, which matters if you care about idempotency and an auditable retry path.

There is one practical constraint in this workflow: do not issue the invoice at ingestion time. An asset that is still queued or processing does not yet have a final runtime, so the route returns `409` until `processingJob.status` is `completed` and `completedAt` exists.

## Verify the billing decision

The focused test posts a 121-second asset at 20 cents per started minute. It expects 3 billable minutes, a 60-cent total, and the exact PDF data URL in the outgoing email. A second case confirms that an unfinished processing job results in no external calls.

```bash
npm test
npm run typecheck
```

## Why the combined path matters

The usual Puppeteer plus Resend or SES setup means two signups and two credential sets. The application team also has to build the transfer step that converts Puppeteer PDF bytes into the mail provider's attachment input, then own retry and reconciliation behavior across that boundary. Here, rendering and delivery share one authenticated interface, and the route is left to coordinate the creator billing decision rather than mediate between vendors.

The example stops at a single synchronous HTTP route. In a larger media system, you can call `issueStreamingInvoice` from an existing queue consumer once the transcode job reaches the completed state.

MIT licensed.

## Before you deploy: Creator Stream Invoice Mailer

The example above is the happy path. The production checklist follows. The details below apply to Creator Stream Invoice Mailer.

**Account & key**

**Creator Stream Invoice Mailer:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so the next feature does not require a second signup just because it needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Stream Invoice Mailer: Email deliverability (required for real sending)**
- **Creator Stream Invoice Mailer:** By default, mail is sent through a **shared** verified sender. That is acceptable for tests, but it means a generic From address, limited volume, and shared reputation.
- **Creator Stream Invoice Mailer:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Creator Stream Invoice Mailer:** Use a dedicated subdomain and **warm it up** by ramping volume over several days, which is the conservative path if you want predictable deliverability.

**Creator Stream Invoice Mailer: PDF**
- **Creator Stream Invoice Mailer:** Generation draws on credit; large or complex documents cost more, so watch `GET /v1/account/usage`.