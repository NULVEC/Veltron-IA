import test from "node:test";
import assert from "node:assert/strict";
import { isStaticDeployment, staticFetch } from "../public/static-api.js";

const values = new Map();
globalThis.location = {
  hostname: "nulvec.github.io",
  origin: "https://nulvec.github.io",
  search: "",
};
globalThis.localStorage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
};

test("activa el modo estático en GitHub Pages", () => {
  assert.equal(isStaticDeployment(), true);
});

test("crea chats y responde sin servidor en el modo estático", async () => {
  values.clear();
  const createdResponse = await staticFetch("/api/conversations", { method: "POST", body: "{}" });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).conversation;

  const stream = await staticFetch("/api/chat/stream", {
    method: "POST",
    body: JSON.stringify({ conversationId: created.id, message: "Calcula (24 + 6) / 3" }),
  });
  const events = (await stream.text()).trim().split("\n").map(JSON.parse);
  assert.match(events[0].delta, /10/);
  assert.equal(events[1].conversation.messages.length, 2);

  const list = await (await staticFetch("/api/conversations")).json();
  assert.equal(list.conversations[0].messageCount, 2);
});
