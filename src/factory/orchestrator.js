import { randomUUID } from "node:crypto";
import { evaluateClassifier, stratifiedSplit, trainClassifier, validateDataset } from "./text-classifier.js";

const DEFAULT_LIMITS = Object.freeze({
  maxExperiments: 2,
  maxModels: 2,
  maxGenerations: 2,
  maxTimeMs: 30_000,
});

function boundedInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function normalizeInput(input) {
  const objective = typeof input?.objective === "string" ? input.objective.trim().slice(0, 500) : "";
  if (!objective) throw new Error("Define un objetivo para el proyecto.");
  const dataset = validateDataset(input.dataset);
  const targetAccuracy = Number(input?.successCriteria?.accuracy);
  return {
    objective,
    dataset,
    autonomy: ["manual", "supervised", "autonomous"].includes(input.autonomy) ? input.autonomy : "supervised",
    successCriteria: {
      accuracy: Number.isFinite(targetAccuracy) ? Math.min(1, Math.max(0, targetAccuracy)) : 0.8,
    },
    limits: {
      maxExperiments: boundedInteger(input?.limits?.maxExperiments, DEFAULT_LIMITS.maxExperiments, 1, 10),
      maxModels: boundedInteger(input?.limits?.maxModels, DEFAULT_LIMITS.maxModels, 1, 10),
      maxGenerations: boundedInteger(input?.limits?.maxGenerations, DEFAULT_LIMITS.maxGenerations, 1, 10),
      maxTimeMs: boundedInteger(input?.limits?.maxTimeMs, DEFAULT_LIMITS.maxTimeMs, 100, 300_000),
    },
  };
}

function publicModel(model) {
  const { artifact, ...metadata } = model;
  return metadata;
}

export class FactoryOrchestrator {
  constructor({ store }) {
    this.store = store;
    this.running = new Map();
  }

  createProject(input) {
    return this.store.create(normalizeInput(input));
  }

  listProjects() {
    return this.store.list();
  }

  getProject(id) {
    return this.store.get(id);
  }

  async listModels(projectId) {
    const project = await this.store.get(projectId);
    return project?.models.map(publicModel) || null;
  }

  async getModel(modelId) {
    const projects = await this.store.readData();
    for (const project of projects.projects) {
      const model = project.models.find((item) => item.id === modelId);
      if (model) return { ...publicModel(model), projectId: project.id };
    }
    return null;
  }

  async getExperiment(experimentId) {
    const projects = await this.store.readData();
    for (const project of projects.projects) {
      const experiment = project.experiments.find((item) => item.id === experimentId);
      if (experiment) return { ...experiment, projectId: project.id };
    }
    return null;
  }

  async stop(projectId) {
    const controller = this.running.get(projectId);
    controller?.abort();
    return this.store.update(projectId, (project) => {
      project.stopRequested = true;
      project.auditLog.push({ id: randomUUID(), type: "project.stop_requested", at: new Date().toISOString(), details: {} });
      if (project.status === "ready") project.status = "stopped";
    });
  }

  async run(projectId) {
    if (this.running.has(projectId)) throw new Error("El proyecto ya está ejecutándose.");
    const initial = await this.store.get(projectId);
    if (!initial) return null;
    const controller = new AbortController();
    this.running.set(projectId, controller);
    const started = Date.now();

    await this.store.update(projectId, (project) => {
      project.status = "running";
      project.stopRequested = false;
      project.auditLog.push({ id: randomUUID(), type: "run.started", at: new Date().toISOString(), details: { limits: project.limits } });
    });

    try {
      const { train, test } = stratifiedSplit(initial.dataset);
      const candidates = [
        { strategy: "unigram", alpha: 1, hypothesis: "Crear una línea base con palabras individuales." },
        { strategy: "unigram-bigram", alpha: 0.5, hypothesis: "Añadir contexto con bigramas y reducir el suavizado." },
      ];
      let parentModelId = null;

      for (let index = 0; index < candidates.length; index += 1) {
        const current = await this.store.get(projectId);
        const timeExceeded = Date.now() - started >= current.limits.maxTimeMs;
        if (controller.signal.aborted || current.stopRequested || timeExceeded) break;
        if (current.models.length >= current.limits.maxModels || current.experiments.length >= current.limits.maxExperiments) break;
        if (index + 1 > current.limits.maxGenerations) break;

        const candidate = candidates[index];
        const trainingStarted = process.hrtime.bigint();
        const artifact = trainClassifier(train, candidate);
        const trainingMs = Number(process.hrtime.bigint() - trainingStarted) / 1_000_000;
        const evaluation = evaluateClassifier(artifact, test);
        const now = new Date().toISOString();
        const modelId = randomUUID();
        const experimentId = randomUUID();
        await this.store.update(projectId, (project) => {
          project.generation = index + 1;
          project.models.push({
            id: modelId,
            name: `IA-${String(project.models.length + 1).padStart(3, "0")}`,
            version: `0.${index + 1}.0`,
            generation: index + 1,
            parentModelId,
            architecture: artifact.type,
            features: artifact.strategy,
            hyperparameters: { alpha: artifact.alpha },
            dataset: { total: project.dataset.length, train: train.length, test: test.length },
            metrics: evaluation.metrics,
            status: "evaluated",
            createdAt: now,
            artifact,
          });
          project.experiments.push({
            id: experimentId,
            modelId,
            generation: index + 1,
            hypothesis: candidate.hypothesis,
            trainingMs,
            metrics: evaluation.metrics,
            errors: evaluation.errors,
            decision: "pending-comparison",
            createdAt: now,
          });
          project.auditLog.push({ id: randomUUID(), type: "experiment.completed", at: now, details: { experimentId, modelId, metrics: evaluation.metrics } });
        });
        parentModelId = modelId;
        await new Promise((resolve) => setImmediate(resolve));
      }

      return await this.store.update(projectId, (project) => {
        const ranked = [...project.models].sort((a, b) =>
          b.metrics.accuracy - a.metrics.accuracy || b.metrics.macroF1 - a.metrics.macroF1 || a.metrics.latencyMs - b.metrics.latencyMs,
        );
        project.bestModelId = ranked[0]?.id || null;
        for (const experiment of project.experiments) {
          experiment.decision = experiment.modelId === project.bestModelId ? "selected" : "discarded";
        }
        const stopped = controller.signal.aborted || project.stopRequested;
        project.status = stopped ? "stopped" : project.models.length ? "completed" : "limit-reached";
        project.auditLog.push({
          id: randomUUID(),
          type: stopped ? "run.stopped" : "run.completed",
          at: new Date().toISOString(),
          details: { bestModelId: project.bestModelId, targetReached: (ranked[0]?.metrics.accuracy || 0) >= project.successCriteria.accuracy },
        });
      });
    } catch (error) {
      await this.store.update(projectId, (project) => {
        project.status = "failed";
        project.auditLog.push({ id: randomUUID(), type: "run.failed", at: new Date().toISOString(), details: { message: error.message } });
      });
      throw error;
    } finally {
      this.running.delete(projectId);
    }
  }
}
