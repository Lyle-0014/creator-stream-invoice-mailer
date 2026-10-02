async function main(): Promise<void> {
  const response = await fetch("http://localhost:3000/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      invoiceId: "INV-STREAM-1042",
      customer: { name: "Maya Chen", email: "chenhua@changba.com" },
      creator: { displayName: "Nora Vale", channelName: "Studio Sessions" },
      asset: {
        assetId: "asset_live_204",
        title: "Live Set: Harbor Room",
        ingestedAt: "2026-09-18T08:30:00.000Z",
        durationSeconds: 3725,
      },
      processingJob: {
        jobId: "job_transcode_882",
        status: "completed",
        completedAt: "2026-09-18T08:42:00.000Z",
      },
      billing: { currency: "USD", centsPerStartedMinute: 18 },
    }),
  });

  const result: unknown = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
