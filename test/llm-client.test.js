import assert from "node:assert/strict";
import test from "node:test";
import { LlmClient } from "../src/llm-client.js";

const config = {
  enabled: true,
  baseUrl: "https://provider.example/v1",
  apiKey: "secret-test-key",
  model: "test-model",
  systemPrompt: "Sé útil.",
  timeoutMs: 1_000,
};

test("consume fragmentos SSE de un proveedor compatible", async () => {
  let receivedRequest;
  const mockFetch = async (url, options) => {
    receivedRequest = { url, options };
    return new Response([
      'data: {"choices":[{"delta":{"content":"Hola"}}]}',
      'data: {"choices":[{"delta":{"content":" mundo"}}]}',
      "data: [DONE]",
      "",
    ].join("\n"), { status: 200 });
  };
  const client = new LlmClient(config, mockFetch);
  const fragments = [];
  for await (const fragment of client.stream([{ role: "user", content: "Hola" }])) {
    fragments.push(fragment);
  }

  assert.deepEqual(fragments, ["Hola", " mundo"]);
  assert.equal(receivedRequest.url, "https://provider.example/v1/chat/completions");
  assert.equal(receivedRequest.options.headers.authorization, "Bearer secret-test-key");
  assert.equal(JSON.parse(receivedRequest.options.body).stream, true);
});
