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

test("expone Puter AI como motor online", async () => {
  const health = await (await staticFetch("/api/health")).json();
  assert.deepEqual(health, {
    ok: true,
    version: "1.5.0",
    mode: "online",
    model: "Puter AI",
    deployment: "static",
  });
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

test("transmite una respuesta online y conserva la conversación", async () => {
  values.clear();
  globalThis.puter = {
    ai: {
      async *chat() {
        yield { text: "Respuesta " };
        yield { text: "online completa." };
      },
    },
  };
  const created = (await (await staticFetch("/api/conversations", { method: "POST", body: "{}" })).json()).conversation;
  const stream = await staticFetch("/api/chat/stream", {
    method: "POST",
    body: JSON.stringify({ conversationId: created.id, message: "Explícame algo nuevo" }),
  });
  const events = (await stream.text()).trim().split("\n").map(JSON.parse);
  assert.equal(events.filter((event) => event.type === "delta").map((event) => event.delta).join(""), "Respuesta online completa.");
  assert.equal(events.at(-1).mode, "online");
  assert.equal(events.at(-1).conversation.messages.at(-1).mode, "model");
  delete globalThis.puter;
});

test("ejecuta la fábrica de IAs dentro del navegador", async () => {
  values.clear();
  const dataset = [
    { text: "excelente producto", label: "positivo" },
    { text: "excelente servicio", label: "positivo" },
    { text: "excelente compra", label: "positivo" },
    { text: "producto muy malo", label: "negativo" },
    { text: "servicio muy malo", label: "negativo" },
    { text: "compra muy mala", label: "negativo" },
  ];
  const createdResponse = await staticFetch("/api/projects", {
    method: "POST",
    body: JSON.stringify({ objective: "Clasificar opiniones", dataset, successCriteria: { accuracy: 0.8 } }),
  });
  assert.equal(createdResponse.status, 201);
  const created = (await createdResponse.json()).project;
  assert.equal(created.datasetSize, 6);

  const run = await staticFetch(`/api/projects/${created.id}/run`, { method: "POST", body: "{}" });
  const completed = (await run.json()).project;
  assert.equal(completed.status, "completed");
  assert.equal(completed.models.length, 2);
  assert.equal(completed.models[1].parentModelId, completed.models[0].id);
  assert.ok(completed.bestModelId);

  const projects = await (await staticFetch("/api/projects")).json();
  assert.equal(projects.projects[0].experimentCount, 2);
});
