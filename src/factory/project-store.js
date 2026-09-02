import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const EMPTY_DATA = { projects: [] };

export class FactoryProjectStore {
  constructor(path = join(process.cwd(), ".data", "factory-projects.json")) {
    this.path = path;
    this.queue = Promise.resolve();
  }

  async readData() {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8"));
      return Array.isArray(data?.projects) ? data : structuredClone(EMPTY_DATA);
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return structuredClone(EMPTY_DATA);
      throw error;
    }
  }

  async writeData(data) {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await rename(temporary, this.path);
  }

  transaction(change) {
    const operation = this.queue.then(async () => {
      const data = await this.readData();
      const result = await change(data);
      await this.writeData(data);
      return structuredClone(result);
    });
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  async list() {
    await this.queue;
    const data = await this.readData();
    return data.projects.map(({ dataset, models, experiments, auditLog, ...project }) => ({
      ...project,
      datasetSize: dataset.length,
      modelCount: models.length,
      experimentCount: experiments.length,
      auditEvents: auditLog.length,
    })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    await this.queue;
    const data = await this.readData();
    return structuredClone(data.projects.find((project) => project.id === id) || null);
  }

  create(input) {
    return this.transaction((data) => {
      const now = new Date().toISOString();
      const project = {
        id: randomUUID(),
        objective: input.objective,
        taskType: "text-classification",
        status: "ready",
        autonomy: input.autonomy,
        successCriteria: input.successCriteria,
        limits: input.limits,
        dataset: input.dataset,
        generation: 0,
        bestModelId: null,
        stopRequested: false,
        createdAt: now,
        updatedAt: now,
        models: [],
        experiments: [],
        auditLog: [{ id: randomUUID(), type: "project.created", at: now, details: { objective: input.objective } }],
      };
      data.projects.push(project);
      return project;
    });
  }

  update(id, change) {
    return this.transaction((data) => {
      const project = data.projects.find((item) => item.id === id);
      if (!project) return null;
      change(project);
      project.updatedAt = new Date().toISOString();
      return project;
    });
  }
}
