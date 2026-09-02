import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FactoryOrchestrator } from "../src/factory/orchestrator.js";
import { FactoryProjectStore } from "../src/factory/project-store.js";
import { evaluateClassifier, predict, stratifiedSplit, trainClassifier } from "../src/factory/text-classifier.js";

const dataset = [
  { text: "excelente producto", label: "positivo" },
  { text: "excelente servicio", label: "positivo" },
  { text: "excelente compra", label: "positivo" },
  { text: "producto muy malo", label: "negativo" },
  { text: "servicio muy malo", label: "negativo" },
  { text: "compra muy mala", label: "negativo" },
];

test("entrena y evalúa un clasificador real", () => {
  const { train, test: evaluation } = stratifiedSplit(dataset);
  const model = trainClassifier(train);
  assert.equal(predict(model, "servicio excelente"), "positivo");
  assert.equal(predict(model, "producto malo"), "negativo");
  const result = evaluateClassifier(model, evaluation);
  assert.equal(result.metrics.accuracy, 1);
  assert.equal(result.metrics.evaluatedExamples, 2);
});

test("crea dos generaciones, registra genealogía y selecciona un modelo", async () => {
  const directory = await mkdtemp(join(tmpdir(), "veltron-factory-test-"));
  try {
    const store = new FactoryProjectStore(join(directory, "projects.json"));
    const orchestrator = new FactoryOrchestrator({ store });
    const created = await orchestrator.createProject({
      objective: "Clasificar opiniones como positivas o negativas",
      dataset,
      autonomy: "supervised",
      successCriteria: { accuracy: 0.9 },
    });
    const completed = await orchestrator.run(created.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.models.length, 2);
    assert.equal(completed.experiments.length, 2);
    assert.equal(completed.models[1].parentModelId, completed.models[0].id);
    assert.ok(completed.bestModelId);
    assert.equal(completed.experiments.filter((item) => item.decision === "selected").length, 1);
    assert.ok(completed.auditLog.some((event) => event.type === "run.completed"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("respeta los límites configurados", async () => {
  const directory = await mkdtemp(join(tmpdir(), "veltron-factory-limits-"));
  try {
    const store = new FactoryProjectStore(join(directory, "projects.json"));
    const orchestrator = new FactoryOrchestrator({ store });
    const created = await orchestrator.createProject({
      objective: "Probar límites",
      dataset,
      limits: { maxModels: 1, maxExperiments: 1, maxGenerations: 1 },
    });
    const completed = await orchestrator.run(created.id);
    assert.equal(completed.models.length, 1);
    assert.equal(completed.experiments.length, 1);
    assert.equal(completed.generation, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
