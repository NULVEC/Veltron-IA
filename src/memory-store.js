import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export class MemoryStore {
  constructor(path = join(process.cwd(), ".data", "memory.json")) {
    this.path = path;
  }

  async load() {
    try {
      const stored = JSON.parse(await readFile(this.path, "utf8"));
      return stored && typeof stored === "object" ? stored : {};
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) return {};
      throw error;
    }
  }

  async save(memory) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
  }

  async clear() {
    await this.save({});
  }
}
