import assert from "node:assert/strict";
import test from "node:test";
import { formatKnowledge, retrieveKnowledge } from "../src/knowledge.js";

const documents = [
  { name: "ventas.txt", content: "Las ventas del trimestre fueron 184 unidades en Costa Rica." },
  { name: "equipo.txt", content: "El equipo de diseño se reúne los martes a las nueve." },
];

test("recupera fragmentos relevantes sin mezclar documentos ajenos", () => {
  const matches = retrieveKnowledge(documents, "¿Cuántas ventas hubo en Costa Rica?");
  assert.equal(matches[0].name, "ventas.txt");
  assert.match(matches[0].content, /184 unidades/);
  assert.equal(matches.some((match) => match.name === "equipo.txt"), false);
});

test("formatea las fuentes para el contexto del modelo", () => {
  const context = formatKnowledge(retrieveKnowledge(documents, "reunión del equipo de diseño"));
  assert.match(context, /\[Archivo: equipo.txt\]/);
  assert.match(context, /martes/);
});
