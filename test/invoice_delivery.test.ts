import assert from "node:assert/strict";
import { test } from "node:test";
import type { EmailSendInput, InvoiceGateway, PdfGenerateInput } from "../src/infrai.js";
import { AssetNotReadyError, issueStreamingInvoice } from "../src/invoice_delivery.js";

const readyInvoice = {
  invoiceId: "INV-42",
  customer: { name: "Maya Chen", email: "maya@example.com" },
  creator: { displayName: "Nora Vale", channelName: "Studio Sessions" },
  asset: {
    assetId: "asset-9",
    title: "Harbor Room",
    ingestedAt: "2026-09-18T08:30:00.000Z",
    durationSeconds: 121,
  },
  processingJob: {
    jobId: "job-8",
    status: "completed",
    completedAt: "2026-09-18T08:42:00.000Z",
  },
  billing: { currency: "USD", centsPerStartedMinute: 20 },
};

class RecordingGateway implements InvoiceGateway {
  generated?: PdfGenerateInput;
  emailed?: EmailSendInput;

  async generatePdf(input: PdfGenerateInput): Promise<{ url: string }> {
    this.generated = input;
    return { url: "data:application/pdf;base64,JVBERi0xLjQ=" };
  }

  async sendEmail(input: EmailSendInput): Promise<{ message_id: string }> {
    this.emailed = input;
    return { message_id: "msg-77" };
  }
}

test("a completed processing job is billed by started minute and delivered", async () => {
  const gateway = new RecordingGateway();
  const result = await issueStreamingInvoice(readyInvoice, gateway);

  assert.equal(result.billableMinutes, 3);
  assert.equal(result.totalCents, 60);
  assert.equal(result.delivery, "emailed");
  assert.match(gateway.generated?.html ?? "", /job-8/);
  assert.match(gateway.emailed?.html ?? "", /data:application\/pdf;base64,JVBERi0xLjQ=/);
  assert.equal(gateway.emailed?.to, "maya@example.com");
});

test("a processing job that is still running never reaches PDF or email", async () => {
  const gateway = new RecordingGateway();
  const pending = {
    ...readyInvoice,
    processingJob: { jobId: "job-8", status: "processing" },
  };

  await assert.rejects(() => issueStreamingInvoice(pending, gateway), AssetNotReadyError);
  assert.equal(gateway.generated, undefined);
  assert.equal(gateway.emailed, undefined);
});
