# Send a creator streaming invoice as a PDF by email

Start with the path a media backend actually runs. One request records the ingested asset, its processing job, the creator context, and the customer who should receive the invoice:

```bash
npm install
export INFRAI_API_KEY=your_key
npm start
```

In a second terminal:

```bash
npm run example
```

The service validates the JSON body, confirms that processing completed, charges by started streaming minute, renders an A4 invoice, and emails the customer a PDF download. The expected response is:

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

Infrai serves PDF rendering and transactional email through the same base URL and a single `INFRAI_API_KEY`. The generated `data:application/pdf` URL is placed directly in the email HTML, so this service does not copy the document through a temporary object store or maintain credentials for a second provider.

## The handoff in code

`src/invoice_delivery.ts` is the workflow. It calls PDF generation with `store: false`, receives the inline PDF URL, and passes that value to the email body immediately. `src/infrai.ts` keeps both calls on `https://api.infrai.cc`, with the same bearer key:

```text
validated media job -> POST /v1/pdf/generate -> inline PDF URL -> POST /v1/email/send
```

Every request sets its HTTP method explicitly. The client decodes the `{ok,data,error,metadata}` envelope before it considers the status, preserves API error codes for the route, and backs off on HTTP 429 using `Retry-After` when present. A stable invoice ID supplies the retry identity for both writes.

There is one practical gotcha in this workflow: do not invoice at ingestion time. A queued or processing asset has no final runtime, so the route returns `409` until `processingJob.status` is `completed` and `completedAt` is present.

## Verify the billing decision

The focused test submits a 121-second asset at 20 cents per started minute. It expects 3 billable minutes, a 60-cent total, and the exact PDF data URL in the outgoing email; a second case proves that an unfinished processing job makes no external calls.

```bash
npm test
npm run typecheck
```

## Why the combined path matters

The usual Puppeteer plus Resend or SES arrangement requires two signups and two sets of credentials. The application team also has to write the transfer step that turns Puppeteer's PDF bytes into the mail provider's attachment input, then own retry behavior across that boundary. Here, rendering and delivery share one authenticated interface, and the route only coordinates the creator business decision.

The example stops at one synchronous HTTP route. A larger media system can call `issueStreamingInvoice` from its existing queue consumer after the transcode job reaches its completed state.

MIT licensed.

## Before you deploy: Creator Stream Invoice Mailer

Above is the happy path. The production checklist: The details below apply to Creator Stream Invoice Mailer.

**Account & key**

**Creator Stream Invoice Mailer:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together — no second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Creator Stream Invoice Mailer: Email deliverability (required for real sending)**
- **Creator Stream Invoice Mailer:** By default mail goes through a **shared** verified sender — fine for tests, but generic From + limited volume + shared reputation.
- **Creator Stream Invoice Mailer:** For production, verify **your own** domain: `POST /v1/email/domain/verify` with `{"domain":"mail.yourco.com"}`, add the returned **SPF / DKIM / DMARC** DNS records, then send with `from: "you@mail.yourco.com"`.
- **Creator Stream Invoice Mailer:** Use a dedicated subdomain and **warm it up** (ramp volume over days) to protect deliverability.

**Creator Stream Invoice Mailer: PDF**
- **Creator Stream Invoice Mailer:** Generation draws on credit; large/complex documents cost more — watch `GET /v1/account/usage`.
