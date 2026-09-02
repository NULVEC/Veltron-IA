const STORAGE_KEY = "veltron-ia-static-v1";

function readData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(parsed?.conversations)) return parsed;
  } catch {}
  return { conversations: [] };
}

function writeData(data) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function id() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function now() {
  return new Date().toISOString();
}

function publicConversation(conversation) {
  return {
    ...conversation,
    documents: (conversation.documents || []).map(({ content, ...document }) => document),
  };
}

function listConversations(data) {
  return data.conversations.map(({ messages = [], documents = [], ...conversation }) => ({
    ...conversation,
    messageCount: messages.length,
    documentCount: documents.length,
    preview: messages.at(-1)?.content?.slice(0, 90) || "Conversación vacía",
  })).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
}

function tokenize(value) {
  return value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9áéíóúñü]{3,}/g) || [];
}

function documentAnswer(conversation, question) {
  const terms = new Set(tokenize(question));
  const matches = [];
  for (const document of conversation.documents || []) {
    for (const fragment of document.content.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
      const score = tokenize(fragment).reduce((total, term) => total + Number(terms.has(term)), 0);
      if (score) matches.push({ score, name: document.name, fragment: fragment.slice(0, 900) });
    }
  }
  matches.sort((a, b) => b.score - a.score);
  if (!matches.length) return null;
  const selected = matches.slice(0, 3);
  return {
    content: `Encontré esto en tus archivos:\n\n${selected.map((match) => `**${match.name}**\n${match.fragment}`).join("\n\n")}`,
    sources: [...new Set(selected.map((match) => match.name))],
  };
}

function calculate(expression) {
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.join("") !== expression.replace(/\s/g, "")) return null;
  let index = 0;
  const primary = () => {
    const token = tokens[index++];
    if (token === "+") return primary();
    if (token === "-") return -primary();
    if (token === "(") {
      const value = addition();
      if (tokens[index++] !== ")") throw new Error("Paréntesis inválidos");
      return value;
    }
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("Número inválido");
    return value;
  };
  const multiplication = () => {
    let value = primary();
    while (tokens[index] === "*" || tokens[index] === "/") {
      const operator = tokens[index++];
      const right = primary();
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const addition = () => {
    let value = multiplication();
    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = multiplication();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const value = addition();
    return index === tokens.length && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

function offlineAnswer(conversation, question) {
  const fromDocuments = documentAnswer(conversation, question);
  if (fromDocuments) return fromDocuments;
  const normalized = question.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const name = question.match(/(?:me llamo|mi nombre es)\s+([\p{L}][\p{L}\s'-]{0,40})/iu)?.[1]?.trim();
  if (name) return { content: `Mucho gusto, ${name}. Lo recordaré dentro de esta conversación.`, sources: [] };
  if (/que puedes hacer|ayuda|\/help/.test(normalized)) {
    return { content: "Puedo conversar, consultar los archivos que adjuntes, recordar el contexto del chat y resolver operaciones básicas. Para razonamiento generativo avanzado, ejecuta la versión local con un proveedor configurado.", sources: [] };
  }
  const expression = question.match(/(?:calcula|cuanto es|resuelve)?\s*([\d\s()+\-*/.,]+)\??$/i)?.[1]?.replace(",", ".").trim();
  if (expression && /^[\d\s()+\-*/.]+$/.test(expression)) {
    const result = calculate(expression);
    if (result !== null) return { content: `El resultado es **${result}**.`, sources: [] };
  }
  if (/^(hola|buenas|hey)\b/.test(normalized)) return { content: "¡Hola! ¿Qué quieres resolver hoy?", sources: [] };
  return { content: "Estoy funcionando en modo web offline. Puedo consultar archivos, resolver cálculos y mantener este historial en tu navegador. Para respuestas generativas más amplias, usa la versión local con un modelo configurado.", sources: [] };
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bodyOf(options) {
  try { return options.body ? JSON.parse(options.body) : {}; } catch { return {}; }
}

export function isStaticDeployment() {
  return location.hostname.endsWith(".github.io") || new URLSearchParams(location.search).has("static");
}

export async function staticFetch(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const pathname = new URL(path, location.origin).pathname.replace(/^.*?\/api\//, "/api/");
  const body = bodyOf(options);
  const data = readData();

  if (method === "GET" && pathname === "/api/health") {
    return json({ ok: true, version: "1.3.0", mode: "offline", model: null, deployment: "static" });
  }
  if (method === "GET" && pathname === "/api/conversations") return json({ conversations: listConversations(data) });
  if (method === "POST" && pathname === "/api/conversations") {
    const timestamp = now();
    const conversation = { id: id(), title: "Nueva conversación", createdAt: timestamp, updatedAt: timestamp, pinned: false, messages: [], documents: [] };
    data.conversations.push(conversation);
    writeData(data);
    return json({ conversation: publicConversation(conversation) }, 201);
  }
  if (method === "GET" && pathname === "/api/backup") {
    return json({ format: "veltron-ia-backup", version: 1, exportedAt: now(), ...data });
  }
  if (method === "POST" && pathname === "/api/backup") {
    if (!Array.isArray(body.conversations)) return json({ error: "Respaldo inválido." }, 400);
    const byId = new Map(data.conversations.map((conversation) => [conversation.id, conversation]));
    for (const conversation of body.conversations.slice(0, 500)) {
      if (conversation?.id && Array.isArray(conversation.messages)) byId.set(conversation.id, conversation);
    }
    data.conversations = [...byId.values()];
    writeData(data);
    return json({ imported: data.conversations.length });
  }

  const pinMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/pin$/);
  const documentMatch = pathname.match(/^\/api\/conversations\/([^/]+)\/documents(?:\/([^/]+))?$/);
  const conversationMatch = pathname.match(/^\/api\/conversations\/([^/]+)$/);
  const conversationId = pinMatch?.[1] || documentMatch?.[1] || conversationMatch?.[1];
  const conversation = data.conversations.find((item) => item.id === conversationId);

  if (pinMatch && method === "PATCH" && conversation) {
    conversation.pinned = Boolean(body.pinned);
    conversation.updatedAt = now();
    writeData(data);
    return json({ conversation: publicConversation(conversation) });
  }
  if (documentMatch && method === "POST" && !documentMatch[2] && conversation) {
    conversation.documents ||= [];
    if (conversation.documents.length >= 10) return json({ error: "Cada conversación admite hasta 10 archivos." }, 400);
    if (!body.name || !body.content || body.content.length > 500_000) return json({ error: "Archivo inválido o mayor de 500 KB." }, 400);
    conversation.documents.push({ id: id(), name: String(body.name).slice(0, 120), type: body.type || "text/plain", size: body.content.length, content: body.content, createdAt: now() });
    conversation.updatedAt = now();
    writeData(data);
    return json({ conversation: publicConversation(conversation) }, 201);
  }
  if (documentMatch && method === "DELETE" && documentMatch[2] && conversation) {
    conversation.documents = (conversation.documents || []).filter((document) => document.id !== documentMatch[2]);
    conversation.updatedAt = now();
    writeData(data);
    return json({ conversation: publicConversation(conversation) });
  }
  if (conversationMatch && method === "GET" && conversation) return json({ conversation: publicConversation(conversation) });
  if (conversationMatch && method === "PATCH" && conversation) {
    conversation.title = String(body.title || conversation.title).slice(0, 80);
    conversation.updatedAt = now();
    writeData(data);
    return json({ conversation: publicConversation(conversation) });
  }
  if (conversationMatch && method === "DELETE" && conversation) {
    data.conversations = data.conversations.filter((item) => item.id !== conversation.id);
    writeData(data);
    return json({ deleted: true });
  }
  if (method === "POST" && pathname === "/api/chat/stream") {
    const active = data.conversations.find((item) => item.id === body.conversationId);
    if (!active) return json({ error: "Conversación no encontrada." }, 404);
    const regenerate = body.regenerate === true;
    const question = regenerate ? active.messages.filter((message) => message.role === "user").at(-1)?.content : String(body.message || "").trim();
    if (!question) return json({ error: "Mensaje inválido." }, 400);
    if (regenerate && active.messages.at(-1)?.role === "assistant") active.messages.pop();
    if (!regenerate) active.messages.push({ id: id(), role: "user", content: question, createdAt: now() });
    const answer = offlineAnswer(active, question);
    active.messages.push({ id: id(), role: "assistant", content: answer.content, createdAt: now(), mode: "offline", sources: answer.sources });
    active.updatedAt = now();
    if (active.messages.length === 2) active.title = question.slice(0, 52);
    writeData(data);
    const output = `${JSON.stringify({ type: "delta", delta: answer.content })}\n${JSON.stringify({ type: "done", conversation: publicConversation(active), mode: "offline" })}\n`;
    return new Response(output, { headers: { "content-type": "application/x-ndjson; charset=utf-8" } });
  }
  return json({ error: "Ruta no encontrada." }, 404);
}
