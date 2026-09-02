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

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("La solicitud es demasiado grande.");
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
          mode: config.provider.enabled ? "model" : "offline",
          model: config.provider.enabled ? config.provider.model : null,
        });
      }

      if (request.method === "GET" && url.pathname === "/api/conversations") {
        return json(response, 200, { conversations: await conversationStore.list() });
      }

      if (request.method === "POST" && url.pathname === "/api/conversations") {
        return json(response, 201, { conversation: await conversationStore.create() });
      }

      const conversationMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)$/);
      if (conversationMatch && request.method === "GET") {
        const conversation = await conversationStore.get(conversationMatch[1]);
        return conversation
          ? json(response, 200, { conversation })
          : json(response, 404, { error: "Conversación no encontrada." });
      }

      if (conversationMatch && request.method === "DELETE") {
        const deleted = await conversationStore.delete(conversationMatch[1]);
        return json(response, deleted ? 200 : 404, { deleted });
      }

      if (request.method === "POST" && url.pathname === "/api/chat") {
        const body = await readJson(request);
        const content = validateMessage(body.message);
        if (!content || typeof body.conversationId !== "string") {
          return json(response, 400, { error: "Mensaje o conversación inválidos." });
        }
        return json(response, 200, await service.respond(body.conversationId, content));
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
