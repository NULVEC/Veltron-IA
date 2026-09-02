#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { LlmClient } from "./llm-client.js";
import { MemoryStore } from "./memory-store.js";
import { ConversationStore } from "./conversation-store.js";
import { AssistantService } from "./assistant-service.js";
import { FactoryProjectStore } from "./factory/project-store.js";
import { FactoryOrchestrator } from "./factory/orchestrator.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function json(response, status, payload) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function ndjson(response, payload) {
  response.write(`${JSON.stringify(payload)}\n`);
}

function serializeConversation(conversation) {
  if (!conversation) return conversation;
  return {
    ...conversation,
    documents: (conversation.documents || []).map(({ content, ...document }) => document),
  };
}

function serializeResult(result) {
  return { ...result, conversation: serializeConversation(result.conversation) };
}

function serializeFactoryProject(project) {
  if (!project) return project;
  const { dataset, ...metadata } = project;
  return {
    ...metadata,
    datasetSize: dataset.length,
    models: project.models.map(({ artifact, ...model }) => model),
  };
}

async function readJson(request, maxLength = 1_000_000) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > maxLength) throw new Error("La solicitud es demasiado grande.");
  }
  return body ? JSON.parse(body) : {};
}

function validateMessage(value) {
  if (typeof value !== "string") return null;
  const content = value.trim();
  return content && content.length <= 8_000 ? content : null;
}

export function createApp({ config = loadConfig(), dataDirectory } = {}) {
  const memoryStore = new MemoryStore(
    dataDirectory ? join(dataDirectory, "memory.json") : undefined,
  );
  const conversationStore = new ConversationStore(
    dataDirectory ? join(dataDirectory, "conversations.json") : undefined,
  );
  const factoryStore = new FactoryProjectStore(
    dataDirectory ? join(dataDirectory, "factory-projects.json") : undefined,
  );
  const factory = new FactoryOrchestrator({ store: factoryStore });
  const service = new AssistantService({
    llmClient: new LlmClient(config.provider),
    memoryStore,
    conversationStore,
  });

  return createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (request.method === "GET" && url.pathname === "/api/health") {
        return json(response, 200, {
          ok: true,
          version: "1.5.0",
          mode: config.provider.enabled ? "model" : "offline",
          model: config.provider.enabled ? config.provider.model : null,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/projects") {
        return json(response, 200, { projects: await factory.listProjects() });
      }

      if (request.method === "POST" && url.pathname === "/api/projects") {
        try {
          const project = await factory.createProject(await readJson(request, 5_000_000));
          return json(response, 201, { project: serializeFactoryProject(project) });
        } catch (error) {
          return json(response, 400, { error: error.message });
        }
      }

      const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(run|stop|models|experiments))?$/);
      if (projectMatch && request.method === "GET" && !projectMatch[2]) {
        const project = await factory.getProject(projectMatch[1]);
        return project
          ? json(response, 200, { project: serializeFactoryProject(project) })
          : json(response, 404, { error: "Proyecto no encontrado." });
      }

      if (projectMatch && request.method === "POST" && projectMatch[2] === "run") {
        try {
          const project = await factory.run(projectMatch[1]);
          return project
            ? json(response, 200, { project: serializeFactoryProject(project) })
            : json(response, 404, { error: "Proyecto no encontrado." });
        } catch (error) {
          return json(response, 409, { error: error.message });
        }
      }

      if (projectMatch && request.method === "POST" && projectMatch[2] === "stop") {
        const project = await factory.stop(projectMatch[1]);
        return project
          ? json(response, 200, { project: serializeFactoryProject(project) })
          : json(response, 404, { error: "Proyecto no encontrado." });
      }

      if (projectMatch && request.method === "GET" && projectMatch[2] === "models") {
        const models = await factory.listModels(projectMatch[1]);
        return models
          ? json(response, 200, { models })
          : json(response, 404, { error: "Proyecto no encontrado." });
      }

      if (projectMatch && request.method === "GET" && projectMatch[2] === "experiments") {
        const project = await factory.getProject(projectMatch[1]);
        return project
          ? json(response, 200, { experiments: project.experiments })
          : json(response, 404, { error: "Proyecto no encontrado." });
      }

      const modelMatch = url.pathname.match(/^\/api\/models\/([^/]+)$/);
      if (modelMatch && request.method === "GET") {
        const model = await factory.getModel(modelMatch[1]);
        return model
          ? json(response, 200, { model })
          : json(response, 404, { error: "Modelo no encontrado." });
      }

      const experimentMatch = url.pathname.match(/^\/api\/experiments\/([^/]+)$/);
      if (experimentMatch && request.method === "GET") {
        const experiment = await factory.getExperiment(experimentMatch[1]);
        return experiment
          ? json(response, 200, { experiment })
          : json(response, 404, { error: "Experimento no encontrado." });
      }

      if (request.method === "GET" && url.pathname === "/api/conversations") {
        return json(response, 200, { conversations: await conversationStore.list() });
      }

      if (request.method === "GET" && url.pathname === "/api/backup") {
        return json(response, 200, {
          format: "veltron-ia-backup",
          version: 1,
          exportedAt: new Date().toISOString(),
          ...(await conversationStore.exportData()),
        });
      }

      if (request.method === "POST" && url.pathname === "/api/backup") {
        const body = await readJson(request, 25_000_000);
        const data = await conversationStore.importData(body);
        return json(response, 200, { imported: data.conversations.length });
      }

      if (request.method === "POST" && url.pathname === "/api/conversations") {
        return json(response, 201, { conversation: await conversationStore.create() });
      }

      const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (conversationMatch && request.method === "GET") {
        const conversation = await conversationStore.get(conversationMatch[1]);
        return conversation
          ? json(response, 200, { conversation: serializeConversation(conversation) })
          : json(response, 404, { error: "Conversación no encontrada." });
      }

      if (conversationMatch && request.method === "DELETE") {
        const deleted = await conversationStore.delete(conversationMatch[1]);
        return json(response, deleted ? 200 : 404, { deleted });
      }

      if (conversationMatch && request.method === "PATCH") {
        const body = await readJson(request);
        const title = typeof body.title === "string" ? body.title.trim().slice(0, 80) : "";
        if (!title) return json(response, 400, { error: "El título no puede estar vacío." });
        const conversation = await conversationStore.rename(conversationMatch[1], title);
        return conversation
          ? json(response, 200, { conversation: serializeConversation(conversation) })
          : json(response, 404, { error: "Conversación no encontrada." });
      }

      const pinMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/pin$/);
      if (pinMatch && request.method === "PATCH") {
        const body = await readJson(request);
        const conversation = await conversationStore.setPinned(pinMatch[1], body.pinned);
        return conversation
          ? json(response, 200, { conversation: serializeConversation(conversation) })
          : json(response, 404, { error: "Conversación no encontrada." });
      }

      const documentMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/documents(?:\/([^/]+))?$/);
      if (documentMatch && request.method === "POST" && !documentMatch[2]) {
        const body = await readJson(request);
        const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
        const content = typeof body.content === "string" ? body.content.trim() : "";
        if (!name || !content || content.length > 500_000) {
          return json(response, 400, { error: "Archivo inválido o mayor de 500 KB de texto." });
        }
        const conversation = await conversationStore.addDocument(documentMatch[1], {
          name,
          type: String(body.type || "text/plain").slice(0, 80),
          content,
        });
        return conversation
          ? json(response, 201, { conversation: serializeConversation(conversation) })
          : json(response, 404, { error: "Conversación no encontrada." });
      }

      if (documentMatch && request.method === "DELETE" && documentMatch[2]) {
        const conversation = await conversationStore.removeDocument(documentMatch[1], documentMatch[2]);
        if (conversation === false) return json(response, 404, { error: "Archivo no encontrado." });
        return conversation
          ? json(response, 200, { conversation: serializeConversation(conversation) })
          : json(response, 404, { error: "Conversación no encontrada." });
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(request);
        const content = validateMessage(body.message);
        if (!content || typeof body.conversationId !== "string") {
          return json(response, 400, { error: "Mensaje o conversación inválidos." });
        }
        return json(response, 200, serializeResult(await service.respond(body.conversationId, content)));
      }

      if (request.method === "POST" && url.pathname === "/api/chat/stream") {
        const body = await readJson(request);
        const content = validateMessage(body.message);
        const regenerate = body.regenerate === true;
        if ((!content && !regenerate) || typeof body.conversationId !== "string") {
          return json(response, 400, { error: "Mensaje o conversación inválidos." });
        }
        const controller = new AbortController();
        request.on("aborted", () => controller.abort());
        response.on("close", () => {
          if (!response.writableEnded) controller.abort();
        });
        response.writeHead(200, {
          "content-type": "application/x-ndjson; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
          "x-content-type-options": "nosniff",
        });
        try {
          const result = await service.respondStreaming(body.conversationId, content, {
            signal: controller.signal,
            regenerate,
            onDelta: (delta) => ndjson(response, { type: "delta", delta }),
          });
          ndjson(response, {
            type: "done",
            conversation: serializeConversation(result.conversation),
            mode: result.mode,
            warning: result.warning,
          });
        } catch (error) {
          ndjson(response, { type: "error", error: error.message });
        }
        return response.end();
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        return json(response, 404, { error: "Ruta no encontrada." });
      }

      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const safePath = normalize(requested).replace(/^(\.\.[/\\])+/, "");
      const filePath = join(PUBLIC_DIR, safePath);
      if (!filePath.startsWith(PUBLIC_DIR)) return json(response, 403, { error: "Acceso denegado." });

      const file = await readFile(filePath);
      response.writeHead(200, {
        "content-type": MIME_TYPES[extname(filePath)] || "application/octet-stream",
        "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      });
      response.end(request.method === "HEAD" ? undefined : file);
    } catch (error) {
      if (error.code === "ENOENT") return json(response, 404, { error: "Recurso no encontrado." });
      if (error instanceof SyntaxError) return json(response, 400, { error: "JSON inválido." });
      console.error(error);
      return json(response, 500, { error: "Error interno del servidor." });
    }
  });
}

if (process.argv[1] && basename(process.argv[1]) === "server.js") {
  const config = loadConfig();
  const server = createApp({ config });
  server.listen(config.port, config.host, () => {
    console.log(`Veltron IA está lista en http://${config.host}:${config.port}`);
    console.log(`Modo: ${config.provider.enabled ? `modelo ${config.provider.model}` : "offline"}`);
    console.log("Presiona Ctrl+C para detenerla.");
  });
}
