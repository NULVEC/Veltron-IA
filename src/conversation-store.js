import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

const EMPTY_DATA = { conversations: [] };

export class ConversationStore {
  constructor(path = join(process.cwd(), ".data", "conversations.json")) {
    this.path = path;
    this.writeQueue = Promise.resolve();
  }

  async readData() {
    try {
      const data = JSON.parse(await readFile(this.path, "utf8"));
      return Array.isArray(data?.conversations) ? data : structuredClone(EMPTY_DATA);
    } catch (error) {
      if (error.code === "ENOENT" || error instanceof SyntaxError) {
        return structuredClone(EMPTY_DATA);
      }
      throw error;
    }
  }

  async writeData(data) {
    this.writeQueue = this.writeQueue.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      await writeFile(this.path, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    });
    return this.writeQueue;
  }

  async list() {
    const data = await this.readData();
    return data.conversations
      .map(({ messages, ...conversation }) => ({
        ...conversation,
        messageCount: messages.length,
        preview: messages.at(-1)?.content?.slice(0, 90) || "Conversación vacía",
      }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id) {
    const data = await this.readData();
    return data.conversations.find((conversation) => conversation.id === id) || null;
  }

  async create(title = "Nueva conversación") {
    const data = await this.readData();
    const now = new Date().toISOString();
    const conversation = {
      id: randomUUID(),
      title,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    data.conversations.push(conversation);
    await this.writeData(data);
    return conversation;
  }

  async append(id, messages) {
    const data = await this.readData();
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) return null;
    conversation.messages.push(...messages);
    conversation.updatedAt = new Date().toISOString();
    if (conversation.messages.length === messages.length) {
      const firstUserMessage = messages.find((message) => message.role === "user")?.content;
      if (firstUserMessage) conversation.title = firstUserMessage.slice(0, 52);
    }
    await this.writeData(data);
    return conversation;
  }

  async delete(id) {
    const data = await this.readData();
    const originalLength = data.conversations.length;
    data.conversations = data.conversations.filter((item) => item.id !== id);
    if (data.conversations.length === originalLength) return false;
    await this.writeData(data);
    return true;
  }
}
