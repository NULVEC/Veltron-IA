import assert from "node:assert/strict";
import test from "node:test";
import { createReply, normalize } from "../src/engine.js";

test("normaliza mayúsculas, acentos y espacios", () => {
  assert.equal(normalize("  ¡CÓMO   ESTÁS!  "), "como estas");
});

test("aprende y utiliza el nombre del usuario", () => {
  const learned = createReply("Me llamo María", {});
  assert.equal(learned.intent, "learn_name");
  assert.deepEqual(learned.memory, { name: "María" });

  const greeting = createReply("hola", learned.memory);
  assert.equal(greeting.intent, "greeting");
  assert.match(greeting.text, /María/);
});

test("detecta intenciones sin depender de los acentos", () => {
  assert.equal(createReply("¿Quién eres?", {}).intent, "identity");
  assert.equal(createReply("adiós", {}).intent, "farewell");
});

test("resuelve aritmética básica", () => {
  assert.equal(createReply("cuánto es (12 + 3) * 2", {}).text, "El resultado es 30.");
  assert.equal(createReply("calcula 5 / 0", {}).intent, "fallback");
});

test("usa una respuesta segura cuando no reconoce el mensaje", () => {
  const reply = createReply("ornitorrinco cuántico", { name: "Leo" });
  assert.equal(reply.intent, "fallback");
  assert.match(reply.text, /^Leo,/);
});
