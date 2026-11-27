import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const MODEL_TIMEOUT_MS = 300;
const allowedTopics = new Set(["delivery", "pricing", "other"]);
const manualReview = { status: "manual_review", topic: null, draft: null };

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function handleTriage(request, response) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);

  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return json(response, 400, { status: "invalid_input" });
  }
  if (typeof input?.text !== "string" || !input.text.trim()) {
    return json(response, 400, { status: "invalid_input" });
  }

  let result;
  try {
    const signal = AbortSignal.timeout(MODEL_TIMEOUT_MS);
    result = JSON.parse(await classify(input.text.trim(), { signal }));
  } catch {
    return json(response, 200, manualReview);
  }
  if (!allowedTopics.has(result?.topic) || typeof result.draft !== "string" || !result.draft.trim()) {
    return json(response, 200, manualReview);
  }
  return json(response, 200, { status: "ready", topic: result.topic, draft: result.draft });
}

export const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/") {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(html);
    return;
  }
  if (request.method !== "POST" || request.url !== "/api/triage") {
    return json(response, 404, { status: "not_found" });
  }
  try {
    await handleTriage(request, response);
  } catch {
    json(response, 500, { status: "server_error" });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(Number(process.env.PORT || 3000), "127.0.0.1");
}
