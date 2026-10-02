import { z } from "zod";
import type { InvoiceGateway } from "./infrai.js";

export const invoiceRequestSchema = z.object({
  invoiceId: z.string().min(1),
  customer: z.object({
    name: z.string().min(1),
    email: z.string().email(),
  }),
  creator: z.object({
    displayName: z.string().min(1),
    channelName: z.string().min(1),
  }),
  asset: z.object({
    assetId: z.string().min(1),
    title: z.string().min(1),
    ingestedAt: z.string().datetime(),
    durationSeconds: z.number().int().positive(),
  }),
  processingJob: z.object({
    jobId: z.string().min(1),
    status: z.enum(["queued", "processing", "completed", "failed"]),
    completedAt: z.string().datetime().optional(),
  }),
  billing: z.object({
    currency: z.enum(["USD", "EUR", "GBP"]),
    centsPerStartedMinute: z.number().int().nonnegative(),
  }),
});

export type InvoiceRequest = z.infer<typeof invoiceRequestSchema>;

export class AssetNotReadyError extends Error {
  public readonly jobId: string;

  constructor(jobId: string) {
    super(`Processing job ${jobId} is not completed`);
    this.name = "AssetNotReadyError";
    this.jobId = jobId;
  }
}

export function calculateInvoice(input: InvoiceRequest): { billableMinutes: number; totalCents: number } {
  if (input.processingJob.status !== "completed" || !input.processingJob.completedAt) {
    throw new AssetNotReadyError(input.processingJob.jobId);
  }
  const billableMinutes = Math.ceil(input.asset.durationSeconds / 60);
  return {
    billableMinutes,
    totalCents: billableMinutes * input.billing.centsPerStartedMinute,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] as string);
}

function invoiceHtml(input: InvoiceRequest, billableMinutes: number, totalCents: number): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:Arial,sans-serif;color:#17202a;margin:48px}h1{font-size:26px}dl{display:grid;grid-template-columns:180px 1fr;gap:10px}dt{font-weight:700}.total{font-size:20px;margin-top:28px}
</style></head><body><h1>Media streaming invoice</h1><dl>
<dt>Invoice</dt><dd>${escapeHtml(input.invoiceId)}</dd>
<dt>Customer</dt><dd>${escapeHtml(input.customer.name)}</dd>
<dt>Creator</dt><dd>${escapeHtml(input.creator.displayName)} / ${escapeHtml(input.creator.channelName)}</dd>
<dt>Asset</dt><dd>${escapeHtml(input.asset.title)} (${escapeHtml(input.asset.assetId)})</dd>
<dt>Processing job</dt><dd>${escapeHtml(input.processingJob.jobId)}</dd>
<dt>Stream length</dt><dd>${billableMinutes} started minute(s)</dd>
</dl><p class="total">Total: ${input.billing.currency} ${(totalCents / 100).toFixed(2)}</p></body></html>`;
}

export async function issueStreamingInvoice(rawInput: unknown, gateway: InvoiceGateway) {
  const input = invoiceRequestSchema.parse(rawInput);
  const amount = calculateInvoice(input);
  const pdf = await gateway.generatePdf({
    html: invoiceHtml(input, amount.billableMinutes, amount.totalCents),
    page_size: "A4",
    orientation: "portrait",
    store: false,
  }, input.invoiceId);

  const message = await gateway.sendEmail({
    to: input.customer.email,
    subject: `Invoice ${input.invoiceId} for ${input.asset.title}`,
    html: `<p>Hello ${escapeHtml(input.customer.name)},</p><p>Your invoice for <strong>${escapeHtml(input.asset.title)}</strong> is ready.</p><p><a href="${escapeHtml(pdf.url)}" download="${escapeHtml(input.invoiceId)}.pdf">Download the PDF invoice</a></p>`,
  }, input.invoiceId);

  return {
    invoiceId: input.invoiceId,
    assetId: input.asset.assetId,
    processingJobId: input.processingJob.jobId,
    billableMinutes: amount.billableMinutes,
    totalCents: amount.totalCents,
    currency: input.billing.currency,
    messageId: message.message_id,
    delivery: "emailed" as const,
  };
}
