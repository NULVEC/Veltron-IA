function identifier() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timestamp() {
  return new Date().toISOString();
}

function features(text, strategy) {
  const tokens = String(text).toLocaleLowerCase("es").match(/[\p{L}\p{N}]+/gu) || [];
  return strategy === "unigram-bigram"
    ? tokens.concat(tokens.slice(1).map((token, index) => `${tokens[index]}_${token}`))
    : tokens;
}

export function validateFactoryDataset(dataset) {
  if (!Array.isArray(dataset)) throw new Error("El dataset debe ser una lista JSON.");
  if (dataset.length > 2_000) throw new Error("El MVP admite hasta 2.000 ejemplos por proyecto.");
  const clean = dataset.map((sample) => ({
    text: typeof sample?.text === "string" ? sample.text.trim().slice(0, 4_000) : "",
    label: typeof sample?.label === "string" ? sample.label.trim().slice(0, 80) : "",
  })).filter((sample) => sample.text && sample.label);
  const counts = new Map();
  for (const sample of clean) counts.set(sample.label, (counts.get(sample.label) || 0) + 1);
  if (clean.length < 6 || counts.size < 2 || [...counts.values()].some((count) => count < 3)) {
    throw new Error("Usa al menos 2 clases y 3 ejemplos válidos por clase.");
  }
  return clean;
}

function split(dataset) {
  const groups = new Map();
  for (const sample of dataset) groups.set(sample.label, [...(groups.get(sample.label) || []), sample]);
  const train = [];
  const test = [];
  for (const group of groups.values()) {
    const testCount = Math.max(1, Math.floor(group.length * 0.25));
    train.push(...group.slice(0, -testCount));
    test.push(...group.slice(-testCount));
  }
  return { train, test };
}

function train(samples, strategy, alpha) {
  const labels = [...new Set(samples.map((sample) => sample.label))].sort();
  const vocabulary = new Set();
  const documents = Object.fromEntries(labels.map((label) => [label, 0]));
  const totals = Object.fromEntries(labels.map((label) => [label, 0]));
  const counts = Object.fromEntries(labels.map((label) => [label, {}]));
  for (const sample of samples) {
    documents[sample.label] += 1;
    for (const feature of features(sample.text, strategy)) {
      vocabulary.add(feature);
      totals[sample.label] += 1;
      counts[sample.label][feature] = (counts[sample.label][feature] || 0) + 1;
    }
  }
  return { type: "multinomial-naive-bayes", strategy, alpha, labels, vocabularySize: vocabulary.size, trainingExamples: samples.length, documents, totals, counts };
}

function predict(model, text) {
  const documentTotal = Object.values(model.documents).reduce((sum, value) => sum + value, 0);
  let best = null;
  for (const label of model.labels) {
    let score = Math.log(model.documents[label] / documentTotal);
    const denominator = model.totals[label] + model.alpha * Math.max(1, model.vocabularySize);
    for (const feature of features(text, model.strategy)) {
      score += Math.log(((model.counts[label][feature] || 0) + model.alpha) / denominator);
    }
    if (!best || score > best.score) best = { label, score };
  }
  return best.label;
}

function evaluate(model, samples) {
  const started = performance.now();
  const predictions = samples.map((sample) => ({ text: sample.text, expected: sample.label, predicted: predict(model, sample.text) }));
  const correct = predictions.filter((item) => item.expected === item.predicted).length;
  const scores = model.labels.map((label) => {
    const tp = predictions.filter((item) => item.expected === label && item.predicted === label).length;
    const fp = predictions.filter((item) => item.expected !== label && item.predicted === label).length;
    const fn = predictions.filter((item) => item.expected === label && item.predicted !== label).length;
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    return precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  });
  return {
    metrics: {
      accuracy: correct / samples.length,
      macroF1: scores.reduce((sum, value) => sum + value, 0) / scores.length,
      latencyMs: (performance.now() - started) / samples.length,
      evaluatedExamples: samples.length,
    },
    errors: predictions.filter((item) => item.expected !== item.predicted),
  };
}

export function createBrowserFactoryProject(input) {
  const objective = typeof input?.objective === "string" ? input.objective.trim().slice(0, 500) : "";
  if (!objective) throw new Error("Define un objetivo para el proyecto.");
  const dataset = validateFactoryDataset(input.dataset);
  const createdAt = timestamp();
  return {
    id: identifier(), objective, taskType: "text-classification", status: "ready", autonomy: "supervised",
    successCriteria: { accuracy: Math.min(1, Math.max(0, Number(input?.successCriteria?.accuracy) || 0.8)) },
    limits: { maxModels: 2, maxExperiments: 2, maxGenerations: 2, maxTimeMs: 30_000 },
    dataset, generation: 0, bestModelId: null, createdAt, updatedAt: createdAt, models: [], experiments: [],
    auditLog: [{ id: identifier(), type: "project.created", at: createdAt, details: { objective } }],
  };
}

export function runBrowserFactoryProject(project) {
  if (project.status === "running") throw new Error("El proyecto ya está ejecutándose.");
  project.status = "running";
  const startedAt = timestamp();
  project.auditLog.push({ id: identifier(), type: "run.started", at: startedAt, details: { limits: project.limits } });
  const { train: training, test } = split(project.dataset);
  const candidates = [
    ["unigram", 1, "Crear una línea base con palabras individuales."],
    ["unigram-bigram", 0.5, "Añadir contexto con bigramas y reducir el suavizado."],
  ];
  let parentModelId = null;
  for (const [index, [strategy, alpha, hypothesis]] of candidates.entries()) {
    if (project.models.length >= project.limits.maxModels) break;
    const trainingStarted = performance.now();
    const artifact = train(training, strategy, alpha);
    const trainingMs = performance.now() - trainingStarted;
    const result = evaluate(artifact, test);
    const createdAt = timestamp();
    const modelId = identifier();
    project.generation = index + 1;
    project.models.push({
      id: modelId, name: `IA-${String(project.models.length + 1).padStart(3, "0")}`, version: `0.${index + 1}.0`,
      generation: index + 1, parentModelId, architecture: artifact.type, features: strategy,
      hyperparameters: { alpha }, dataset: { total: project.dataset.length, train: training.length, test: test.length },
      metrics: result.metrics, status: "evaluated", createdAt, artifact,
    });
    const experimentId = identifier();
    project.experiments.push({ id: experimentId, modelId, generation: index + 1, hypothesis, trainingMs, metrics: result.metrics, errors: result.errors, decision: "pending-comparison", createdAt });
    project.auditLog.push({ id: identifier(), type: "experiment.completed", at: createdAt, details: { experimentId, modelId, metrics: result.metrics } });
    parentModelId = modelId;
  }
  const ranked = [...project.models].sort((a, b) => b.metrics.accuracy - a.metrics.accuracy || b.metrics.macroF1 - a.metrics.macroF1 || a.metrics.latencyMs - b.metrics.latencyMs);
  project.bestModelId = ranked[0]?.id || null;
  for (const experiment of project.experiments) experiment.decision = experiment.modelId === project.bestModelId ? "selected" : "discarded";
  project.status = "completed";
  project.updatedAt = timestamp();
  project.auditLog.push({ id: identifier(), type: "run.completed", at: project.updatedAt, details: { bestModelId: project.bestModelId, targetReached: (ranked[0]?.metrics.accuracy || 0) >= project.successCriteria.accuracy } });
  return project;
}
