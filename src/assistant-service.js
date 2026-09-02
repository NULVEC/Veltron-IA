import { createReply } from "./engine.js";

export class AssistantService {
  constructor({ llmClient, memoryStore, conversationStore }) {
    this.llmClient = llmClient;
    this.memoryStore = memoryStore;
    this.conversationStore = conversationStore;
  }

  async respond(conversationId, content) {
    const conversation = await this.conversationStore.get(conversationId);
    if (!conversation) throw new Error("Conversación no encontrada.");

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    let answer;
    let mode = "offline";
    let warning = null;

    if (this.llmClient.config.enabled) {
      try {
        const context = [...conversation.messages, userMessage]
          .slice(-20)
          .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
        answer = await this.llmClient.complete(context);
        mode = "model";
      } catch (error) {
        warning = error.message;
      }
    }

    if (!answer) {
      const memory = await this.memoryStore.load();
      const reply = createReply(content, memory);
      await this.memoryStore.save(reply.memory);
      answer = reply.text;
    }

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: answer,
      createdAt: new Date().toISOString(),
      mode,
    };
    const updated = await this.conversationStore.append(conversationId, [
      userMessage,
      assistantMessage,
    ]);

    return { conversation: updated, message: assistantMessage, mode, warning };
  }

  async respondStreaming(conversationId, content, { onDelta, signal } = {}) {
    const conversation = await this.conversationStore.get(conversationId);
    if (!conversation) throw new Error("Conversación no encontrada.");

    const userMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    let answer = "";
    let mode = "offline";
    let warning = null;

    if (this.llmClient.config.enabled) {
      try {
        const context = [...conversation.messages, userMessage]
          .slice(-20)
          .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
        for await (const delta of this.llmClient.stream(context, signal)) {
          answer += delta;
          onDelta?.(delta);
        }
        mode = "model";
      } catch (error) {
        warning = error.message;
      }
    }

    if (!answer) {
      const memory = await this.memoryStore.load();
      const reply = createReply(content, memory);
      await this.memoryStore.save(reply.memory);
      answer = reply.text;
      onDelta?.(answer);
    }

    const assistantMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: answer,
      createdAt: new Date().toISOString(),
      mode,
    };
    const updated = await this.conversationStore.append(conversationId, [
      userMessage,
      assistantMessage,
    ]);
    return { conversation: updated, message: assistantMessage, mode, warning };
  }
}
