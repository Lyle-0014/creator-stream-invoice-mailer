import { createServer, type ServerResponse } from "node:http";
import { ZodError } from "zod";
import { InfraiError, infraiFromEnvironment } from "./infrai.js";
import { AssetNotReadyError, issueStreamingInvoice } from "./invoice_delivery.js";

const port = Number(process.env.PORT ?? "3000");
const gateway = infraiFromEnvironment();

function reply(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/invoices") {
    reply(response, 404, { error: "Route not found" });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const buffer = Buffer.from(chunk);
      size += buffer.length;
      if (size > 64 * 1024) {
        reply(response, 413, { error: "Request body is too large" });
        return;
      }
      chunks.push(buffer);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const result = await issueStreamingInvoice(body, gateway);
    reply(response, 201, result);
  } catch (error) {
    if (error instanceof ZodError) {
      reply(response, 400, { error: "Invalid invoice request", issues: error.issues });
    } else if (error instanceof AssetNotReadyError) {
      reply(response, 409, { error: error.message, processingJobId: error.jobId });
    } else if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      reply(response, status, { error: error.message, code: error.code });
    } else if (error instanceof SyntaxError) {
      reply(response, 400, { error: "Request body must be valid JSON" });
    } else {
      console.error(error);
      reply(response, 500, { error: "Invoice delivery failed" });
    }
  }
});

server.listen(port, () => {
  console.log(`Media invoice service listening on http://localhost:${port}`);
});
