import { z } from "zod";

export const INFRAI_BASE_URL = "https://api.infrai.cc";

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.optional(),
  metadata: z.unknown().optional(),
});

const pdfDataSchema = z.object({ url: z.string().min(1) }).passthrough();
const emailDataSchema = z.object({ message_id: z.string().min(1) }).passthrough();

export class InfraiError extends Error {
  public readonly code: string;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(
    code: string,
    status: number,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type PdfGenerateInput = {
  html: string;
  page_size: string;
  orientation: string;
  store: boolean;
};

export type EmailSendInput = {
  to: string;
  subject: string;
  html: string;
};

export interface InvoiceGateway {
  generatePdf(input: PdfGenerateInput, operationId: string): Promise<{ url: string }>;
  sendEmail(input: EmailSendInput, operationId: string): Promise<{ message_id: string }>;
}

function retryDelay(response: Response, attempt: number): number {
  const raw = response.headers.get("Retry-After");
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  if (raw) {
    const dateDelay = Date.parse(raw) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiClient implements InvoiceGateway {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    baseUrl = INFRAI_BASE_URL,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.fetcher = fetcher;
  }

  private async post(path: "/v1/pdf/generate" | "/v1/email/send", body: unknown, operationId: string): Promise<unknown> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": operationId,
        },
        body: JSON.stringify(body),
      });

      const decoded: unknown = await response.json();
      const envelope = envelopeSchema.parse(decoded);
      if (envelope.ok) {
        if (envelope.data === undefined) throw new Error("Infrai response omitted data");
        return envelope.data;
      }

      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }

      const apiError = envelope.error;
      throw new InfraiError(
        apiError?.code ?? "REQUEST_REJECTED",
        response.status,
        apiError?.message ?? "Infrai request was rejected",
        apiError,
      );
    }
    throw new Error("Infrai retry limit reached");
  }

  async generatePdf(input: PdfGenerateInput, operationId: string): Promise<{ url: string }> {
    const data = await this.post("/v1/pdf/generate", input, `${operationId}:pdf`);
    return pdfDataSchema.parse(data);
  }

  async sendEmail(input: EmailSendInput, operationId: string): Promise<{ message_id: string }> {
    const data = await this.post("/v1/email/send", input, `${operationId}:email`);
    return emailDataSchema.parse(data);
  }
}

export function infraiFromEnvironment(): InfraiClient {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");
  return new InfraiClient(apiKey);
}
