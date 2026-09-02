import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createApp } from "../src/server.js";

const offlineConfig = {
  host: "127.0.0.1",
  port: 0,
  provider: {
    enabled: false,
    baseUrl: "",
    apiKey: "",
    model: "",
    systemPrompt: "Prueba",
    timeoutMs: 1_000,
  },
};

async function withServer(run) {
  const dataDirectory = await mkdtemp(join(tmpdir(), "veltron-ia-test-"));
  const server = createApp({ config: offlineConfig, dataDirectory });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDirectory, { recursive: true, force: true });
  }
}

async function request(baseUrl, path, options) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { "content-type": "application/json", ...(options?.headers || {}) },
  });
  return { response, payload: await response.json() };
}

test("expone el estado offline sin filtrar secretos", async () => {
  await withServer(async (baseUrl) => {
    const { response, payload } = await request(baseUrl, "/api/health");
    assert.equal(response.status, 200);
    assert.deepEqual(payload, { ok: true, version: "1.4.0", mode: "offline", model: null });
    assert.equal(JSON.stringify(payload).includes("apiKey"), false);
  });
});

test("crea, conversa, recupera y elimina una conversación", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/conversations", {
      method: "POST",
      body: "{}",
    });
    assert.equal(created.response.status, 201);
    const id = created.payload.conversation.id;

    const chat = await request(baseUrl, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId: id, message: "Hola" }),
    });
    assert.equal(chat.response.status, 200);
    assert.equal(chat.payload.mode, "offline");
    assert.equal(chat.payload.conversation.messages.length, 2);

    const fetched = await request(baseUrl, `/api/conversations/${id}`);
    assert.equal(fetched.payload.conversation.messages[0].content, "Hola");

    const renamed = await request(baseUrl, `/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Chat de prueba" }),
    });
    assert.equal(renamed.payload.conversation.title, "Chat de prueba");

    const deleted = await request(baseUrl, `/api/conversations/${id}`, { method: "DELETE" });
    assert.deepEqual(deleted.payload, { deleted: true });

    const missing = await request(baseUrl, `/api/conversations/${id}`);
    assert.equal(missing.response.status, 404);
  });
});

test("transmite respuestas offline como NDJSON y persiste el resultado", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/conversations", {
      method: "POST",
      body: "{}",
    });
    const id = created.payload.conversation.id;
    const response = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: id, message: "cuánto es 7 * 8" }),
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
    const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(events[0].type, "delta");
    assert.equal(events[0].delta, "El resultado es 56.");
    assert.equal(events.at(-1).type, "done");
    assert.equal(events.at(-1).conversation.messages.length, 2);
  });
});

test("fija chats, consulta archivos, regenera y exporta respaldos", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "/api/conversations", { method: "POST", body: "{}" });
    const id = created.payload.conversation.id;

    const pinned = await request(baseUrl, `/api/conversations/${id}/pin`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: true }),
    });
    assert.equal(pinned.payload.conversation.pinned, true);

    const uploaded = await request(baseUrl, `/api/conversations/${id}/documents`, {
      method: "POST",
      body: JSON.stringify({
        name: "proyecto.txt",
        type: "text/plain",
        content: "El código de lanzamiento del proyecto es VELTRON-42 y la fecha objetivo es noviembre.",
      }),
    });
    assert.equal(uploaded.response.status, 201);
    assert.equal(uploaded.payload.conversation.documents.length, 1);
    assert.equal("content" in uploaded.payload.conversation.documents[0], false);

    const streamed = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: id, message: "¿Cuál es el código de lanzamiento?" }),
    });
    const events = (await streamed.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.match(events[0].delta, /VELTRON-42/);
    assert.deepEqual(events.at(-1).conversation.messages[1].sources, ["proyecto.txt"]);

    const regenerated = await fetch(`${baseUrl}/api/chat/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: id, regenerate: true }),
    });
    const regeneratedEvents = (await regenerated.text()).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(regeneratedEvents.at(-1).conversation.messages.length, 2);

    const backup = await request(baseUrl, "/api/backup");
    assert.equal(backup.payload.format, "veltron-ia-backup");
    assert.equal(backup.payload.conversations.length, 1);
  });
});

test("rechaza mensajes vacíos y sirve la interfaz con cabeceras seguras", async () => {
  await withServer(async (baseUrl) => {
    const invalid = await request(baseUrl, "/api/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId: "x", message: "   " }),
    });
    assert.equal(invalid.response.status, 400);

    const page = await fetch(baseUrl);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /default-src 'self'/);
    assert.match(await page.text(), /Veltron IA/);
  });
});
