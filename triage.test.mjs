import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { server } from "./server.mjs";

let endpoint;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  endpoint = `http://127.0.0.1:${server.address().port}/api/triage`;
});

after(promisify(server.close.bind(server)));

async function post(body, maxWait = 5_000) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    signal: AbortSignal.timeout(maxWait),
  });
  assert.match(response.headers.get("content-type"), /^application\/json\b/);
  return { status: response.status, body: await response.json() };
}

for (const [label, body] of [
  ["empty body", ""],
  ["malformed JSON", '{"text":'],
  ["missing text", "{}"],
  ["null payload", "null"],
  ["non-string text", '{"text":123}'],
  ["empty text", '{"text":""}'],
  ["whitespace-only text", '{"text":"  \\n\\t "}'],
]) {
  test(`rejects ${label}`, async () => {
    assert.deepEqual(await post(body), {
      status: 400,
      body: { status: "invalid_input" },
    });
  });
}

for (const [text, topic] of [
  ["  Когда будет доставка?  ", "delivery"],
  ["Сколько стоит заказ? Какая цена?", "pricing"],
  ["Как изменить телефон в заказе?", "other"],
]) {
  test(`returns a draft for ${topic}`, async () => {
    assert.deepEqual(await post(JSON.stringify({ text })), {
      status: 200,
      body: {
        status: "ready",
        topic,
        draft: "Спасибо за обращение. Уточним детали заявки.",
      },
    });
  });
}

for (const marker of ["timeout", "error", "bad-json", "bad-topic", "empty-draft"]) {
  test(`returns manual_review for [${marker}]`, async () => {
    // Give HTTP and the test runner some slack, while staying below the mock's 1,200 ms delay.
    const maxWait = marker === "timeout" ? 1_000 : 5_000;
    assert.deepEqual(await post(JSON.stringify({ text: `Заявка [${marker}]` }), maxWait), {
      status: 200,
      body: { status: "manual_review", topic: null, draft: null },
    });
  });
}
