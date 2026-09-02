const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;

function words(text) {
  return String(text).toLocaleLowerCase("es").match(TOKEN_PATTERN) || [];
}

export function extractFeatures(text, strategy = "unigram") {
  const tokens = words(text);
  if (strategy === "unigram-bigram") {
    return tokens.concat(tokens.slice(1).map((token, index) => `${tokens[index]}_${token}`));
  }
  return tokens;
}

export function validateDataset(dataset) {
  if (!Array.isArray(dataset)) throw new Error("El dataset debe ser una lista de ejemplos.");
  if (dataset.length > 2_000) throw new Error("El MVP admite hasta 2.000 ejemplos por proyecto.");
  const clean = dataset.map((sample) => ({
    text: typeof sample?.text === "string" ? sample.text.trim().slice(0, 4_000) : "",
    label: typeof sample?.label === "string" ? sample.label.trim().slice(0, 80) : "",
  })).filter((sample) => sample.text && sample.label);

  if (clean.length < 6) throw new Error("El dataset necesita al menos 6 ejemplos válidos.");
  const counts = new Map();
  for (const sample of clean) counts.set(sample.label, (counts.get(sample.label) || 0) + 1);
  if (counts.size < 2) throw new Error("El dataset necesita al menos 2 clases.");
  if ([...counts.values()].some((count) => count < 3)) {
    throw new Error("Cada clase necesita al menos 3 ejemplos para separar entrenamiento y evaluación.");
  }
  return clean;
}

export function stratifiedSplit(dataset) {
  const groups = new Map();
  for (const sample of validateDataset(dataset)) {
    const group = groups.get(sample.label) || [];
    group.push(sample);
    groups.set(sample.label, group);
  }
  const train = [];
  const test = [];
  for (const group of groups.values()) {
    const testCount = Math.max(1, Math.floor(group.length * 0.25));
    train.push(...group.slice(0, -testCount));
    test.push(...group.slice(-testCount));
  }
  return { train, test };
}

export function trainClassifier(samples, { strategy = "unigram", alpha = 1 } = {}) {
  const labels = [...new Set(samples.map((sample) => sample.label))].sort();
  const vocabulary = new Set();
  const documents = Object.fromEntries(labels.map((label) => [label, 0]));
  const totals = Object.fromEntries(labels.map((label) => [label, 0]));
  const counts = Object.fromEntries(labels.map((label) => [label, {}]));

  for (const sample of samples) {
    documents[sample.label] += 1;
    for (const feature of extractFeatures(sample.text, strategy)) {
      vocabulary.add(feature);
      totals[sample.label] += 1;
      counts[sample.label][feature] = (counts[sample.label][feature] || 0) + 1;
    }
  }
  return {
    type: "multinomial-naive-bayes",
    strategy,
    alpha,
    labels,
    vocabularySize: vocabulary.size,
    trainingExamples: samples.length,
    documents,
    totals,
    counts,
  };
}

export function predict(model, text) {
  const totalDocuments = Object.values(model.documents).reduce((sum, count) => sum + count, 0);
  const features = extractFeatures(text, model.strategy);
  let best = null;
  for (const label of model.labels) {
    let score = Math.log(model.documents[label] / totalDocuments);
    const denominator = model.totals[label] + model.alpha * Math.max(1, model.vocabularySize);
    for (const feature of features) {
      score += Math.log(((model.counts[label][feature] || 0) + model.alpha) / denominator);
    }
    if (!best || score > best.score) best = { label, score };
  }
  return best?.label || null;
}

export function evaluateClassifier(model, samples) {
  const started = process.hrtime.bigint();
  const predictions = samples.map((sample) => ({
    text: sample.text,
    expected: sample.label,
    predicted: predict(model, sample.text),
  }));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;
  const correct = predictions.filter((item) => item.expected === item.predicted).length;
  const f1ByLabel = model.labels.map((label) => {
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
      macroF1: f1ByLabel.reduce((sum, value) => sum + value, 0) / f1ByLabel.length,
      latencyMs: elapsedMs / samples.length,
      evaluatedExamples: samples.length,
    },
    errors: predictions.filter((item) => item.expected !== item.predicted),
  };
}
