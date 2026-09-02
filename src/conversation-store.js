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
      .map(({ messages, documents = [], ...conversation }) => ({
        ...conversation,
        messageCount: messages.length,
        documentCount: documents.length,
        preview: messages.at(-1)?.content?.slice(0, 90) || "Conversación vacía",
      }))
      .sort((a, b) => Number(b.pinned || false) - Number(a.pinned || false) || b.updatedAt.localeCompare(a.updatedAt));
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
      pinned: false,
      messages: [],
      documents: [],
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

  async rename(id, title) {
    const data = await this.readData();
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) return null;
    conversation.title = title;
    conversation.updatedAt = new Date().toISOString();
    await this.writeData(data);
    return conversation;
  }

  async setPinned(id, pinned) {
    const data = await this.readData();
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) return null;
    conversation.pinned = Boolean(pinned);
    conversation.updatedAt = new Date().toISOString();
    await this.writeData(data);
    return conversation;
  }

  async addDocument(id, document) {
    const data = await this.readData();
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) return null;
    conversation.documents ||= [];
    if (conversation.documents.length >= 10) throw new Error("Cada conversación admite hasta 10 archivos.");
    const stored = {
      id: randomUUID(),
      name: document.name,
      type: document.type,
      size: document.content.length,
      content: document.content,
      createdAt: new Date().toISOString(),
    };
    conversation.documents.push(stored);
    conversation.updatedAt = stored.createdAt;
    await this.writeData(data);
    return conversation;
  }

  async removeDocument(id, documentId) {
    const data = await this.readData();
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) return null;
    conversation.documents ||= [];
    const originalLength = conversation.documents.length;
    conversation.documents = conversation.documents.filter((document) => document.id !== documentId);
    if (conversation.documents.length === originalLength) return false;
    conversation.updatedAt = new Date().toISOString();
    await this.writeData(data);
    return conversation;
  }

  async replaceLastAssistant(id, message) {
    const data = await this.readData();
    const conversation = data.conversations.find((item) => item.id === id);
    if (!conversation) return null;
    if (conversation.messages.at(-1)?.role === "assistant") conversation.messages.pop();
    conversation.messages.push(message);
    conversation.updatedAt = new Date().toISOString();
    await this.writeData(data);
    return conversation;
  }

  async exportData() {
    return this.readData();
  }

  async importData(payload) {
    if (!Array.isArray(payload?.conversations)) throw new Error("El respaldo no contiene conversaciones válidas.");
    const current = await this.readData();
    const byId = new Map(current.conversations.map((conversation) => [conversation.id, conversation]));
    for (const candidate of payload.conversations.slice(0, 500)) {
      if (!candidate || typeof candidate !== "object" || !Array.isArray(candidate.messages)) continue;
      const now = new Date().toISOString();
      const importedMessages = candidate.messages.slice(0, 500).filter((message) =>
        ["user", "assistant"].includes(message?.role) && typeof message?.content === "string",
      ).map((message) => ({
        id: typeof message.id === "string" ? message.id : randomUUID(),
        role: message.role,
        content: message.content.slice(0, 100_000),
        createdAt: message.createdAt || now,
        ...(message.role === "assistant" ? {
          mode: message.mode === "model" ? "model" : "offline",
          sources: Array.isArray(message.sources) ? message.sources.slice(0, 10).map(String) : [],
        } : {}),
      }));
      const importedDocuments = (candidate.documents || []).slice(0, 10).filter((document) =>
        typeof document?.name === "string" && typeof document?.content === "string" && document.content.length <= 500_000,
      ).map((document) => ({
        id: typeof document.id === "string" ? document.id : randomUUID(),
        name: document.name.slice(0, 120),
        type: String(document.type || "text/plain").slice(0, 80),
        size: document.content.length,
        content: document.content,
        createdAt: document.createdAt || now,
      }));
      const imported = {
        id: typeof candidate.id === "string" ? candidate.id : randomUUID(),
        title: String(candidate.title || "Conversación importada").slice(0, 80),
        createdAt: candidate.createdAt || now,
        updatedAt: candidate.updatedAt || now,
        pinned: Boolean(candidate.pinned),
        messages: importedMessages,
        documents: importedDocuments,
      };
      byId.set(imported.id, imported);
    }
    const data = { conversations: [...byId.values()] };
    await this.writeData(data);
    return data;
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
