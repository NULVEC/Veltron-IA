const state = {
  conversations: [],
  activeConversation: null,
  sending: false,
  health: null,
  search: "",
  abortController: null,
};

const elements = {
  list: document.querySelector("#conversation-list"),
  messages: document.querySelector("#messages"),
  empty: document.querySelector("#empty-state"),
  title: document.querySelector("#chat-title"),
  modeLabel: document.querySelector("#mode-label"),
  connection: document.querySelector("#connection-status"),
  composer: document.querySelector("#composer"),
  input: document.querySelector("#message-input"),
  send: document.querySelector("#send-button"),
  newChat: document.querySelector("#new-chat"),
  renameChat: document.querySelector("#rename-chat"),
  renameDialog: document.querySelector("#rename-dialog"),
  renameForm: document.querySelector("#rename-form"),
  renameInput: document.querySelector("#rename-input"),
  renameCancel: document.querySelector("#rename-cancel"),
  deleteChat: document.querySelector("#delete-chat"),
  exportChat: document.querySelector("#export-chat"),
  themeToggle: document.querySelector("#theme-toggle"),
  knowledgeButton: document.querySelector("#knowledge-button"),
  documentCount: document.querySelector("#document-count"),
  knowledgeDialog: document.querySelector("#knowledge-dialog"),
  knowledgeForm: document.querySelector("#knowledge-form"),
  knowledgeInput: document.querySelector("#knowledge-input"),
  knowledgeClose: document.querySelector("#knowledge-close"),
  documentList: document.querySelector("#document-list"),
  backupExport: document.querySelector("#backup-export"),
  backupImportButton: document.querySelector("#backup-import-button"),
  backupImport: document.querySelector("#backup-import"),
  voiceInput: document.querySelector("#voice-input"),
  search: document.querySelector("#conversation-search"),
  characterCount: document.querySelector("#character-count"),
  sidebar: document.querySelector("#sidebar"),
  menu: document.querySelector("#mobile-menu"),
  backdrop: document.querySelector("#sidebar-backdrop"),
};

const THEMES = ["system", "light", "dark"];

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "No se pudo completar la operación.");
  return payload;
}

function formatTime(value) {
  return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function setSidebar(open) {
  elements.sidebar.classList.toggle("open", open);
  elements.backdrop.hidden = !open;
}

function applyTheme(theme) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
  elements.themeToggle.textContent = `Tema: ${theme === "system" ? "sistema" : theme === "light" ? "claro" : "oscuro"}`;
  localStorage.setItem("veltron-theme", theme);
}

function appendInlineMarkdown(container, text) {
  const pattern = /(https?:\/\/[^\s]+|`[^`\n]+`|\*\*[^*\n]+\*\*)/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    container.append(document.createTextNode(text.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith("http")) {
      const link = document.createElement("a");
      link.href = token;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      link.textContent = token;
      container.append(link);
    } else if (token.startsWith("`")) {
      const code = document.createElement("code");
      code.textContent = token.slice(1, -1);
      container.append(code);
    } else {
      const strong = document.createElement("strong");
      strong.textContent = token.slice(2, -2);
      container.append(strong);
    }
    cursor = match.index + token.length;
  }
  container.append(document.createTextNode(text.slice(cursor)));
}

function appendTextBlocks(container, text) {
  for (const block of text.split(/\n{2,}/)) {
    if (!block) continue;
    const paragraph = document.createElement("p");
    const lines = block.split("\n");
    lines.forEach((line, index) => {
      appendInlineMarkdown(paragraph, line);
      if (index < lines.length - 1) paragraph.append(document.createElement("br"));
    });
    container.append(paragraph);
  }
}

function renderMarkdown(container, source) {
  container.replaceChildren();
  const codePattern = /```([\w-]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of source.matchAll(codePattern)) {
    appendTextBlocks(container, source.slice(cursor, match.index));
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    if (match[1]) code.dataset.language = match[1];
    code.textContent = match[2].replace(/\n$/, "");
    pre.append(code);
    container.append(pre);
    cursor = match.index + match[0].length;
  }
  appendTextBlocks(container, source.slice(cursor));
}

function renderList() {
  elements.list.replaceChildren();
  const query = state.search.toLocaleLowerCase("es");
  const conversations = state.conversations.filter((conversation) =>
    `${conversation.title} ${conversation.preview}`.toLocaleLowerCase("es").includes(query),
  );
  if (!conversations.length) {
    const paragraph = document.createElement("p");
    paragraph.className = "sidebar-footer";
    paragraph.textContent = query ? "No hay coincidencias." : "Todavía no hay conversaciones.";
    elements.list.append(paragraph);
    return;
  }

  for (const conversation of conversations) {
    const row = document.createElement("div");
    row.className = "conversation-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${state.activeConversation?.id === conversation.id ? " active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = conversation.title;
    const preview = document.createElement("span");
    preview.textContent = conversation.preview;
    button.append(title, preview);
    button.addEventListener("click", () => openConversation(conversation.id));
    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = `pin-button${conversation.pinned ? " active" : ""}`;
    pin.textContent = conversation.pinned ? "Fijo" : "Fijar";
    pin.setAttribute("aria-label", `${conversation.pinned ? "Desfijar" : "Fijar"} ${conversation.title}`);
    pin.addEventListener("click", () => togglePinned(conversation));
    row.append(button, pin);
    elements.list.append(row);
  }
}

function copyButton(message) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Copiar";
  button.addEventListener("click", async () => {
    await navigator.clipboard.writeText(message.content);
    button.textContent = "Copiado";
    setTimeout(() => { button.textContent = "Copiar"; }, 1200);
  });
  return button;
}

function messageElement(message, { isLast = false } = {}) {
  const article = document.createElement("article");
  article.className = `message ${message.role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "assistant" ? "V" : "Tú";
  const body = document.createElement("div");
  const meta = document.createElement("div");
  meta.className = "message-meta";
  const author = document.createElement("strong");
  author.textContent = message.role === "assistant" ? "Veltron IA" : "Tú";
  const time = document.createElement("span");
  time.textContent = formatTime(message.createdAt);
  meta.append(author, time);
  const content = document.createElement("div");
  content.className = "message-content";
  renderMarkdown(content, message.content);
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(copyButton(message));
  if (message.role === "assistant" && "speechSynthesis" in window) {
    const speak = document.createElement("button");
    speak.type = "button";
    speak.textContent = "Escuchar";
    speak.addEventListener("click", () => speakMessage(message.content, speak));
    actions.append(speak);
  }
  if (message.role === "assistant" && isLast) {
    const regenerate = document.createElement("button");
    regenerate.type = "button";
    regenerate.textContent = "Regenerar";
    regenerate.addEventListener("click", () => sendMessage("", true));
    actions.append(regenerate);
  }
  body.append(meta, content);
  if (message.sources?.length) {
    const sources = document.createElement("div");
    sources.className = "message-sources";
    sources.textContent = `Fuentes: ${message.sources.join(", ")}`;
    body.append(sources);
  }
  body.append(actions);
  article.append(avatar, body);
  return article;
}

function renderConversation() {
  elements.messages.replaceChildren();
  const conversation = state.activeConversation;
  elements.title.textContent = conversation?.title || "Nueva conversación";
  if (!conversation?.messages.length) elements.messages.append(elements.empty);
  else conversation.messages.forEach((message, index) => {
    elements.messages.append(messageElement(message, { isLast: index === conversation.messages.length - 1 }));
  });
  elements.documentCount.textContent = String(conversation?.documents?.length || 0);
  elements.messages.scrollTop = elements.messages.scrollHeight;
  renderList();
}

function showError(message) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = message;
  elements.messages.append(banner);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function setSending(sending) {
  state.sending = sending;
  elements.send.textContent = sending ? "Detener" : "Enviar";
  elements.send.classList.toggle("stop", sending);
  elements.input.disabled = sending;
  elements.newChat.disabled = sending;
}

async function refreshList() {
  const payload = await api("/api/conversations");
  state.conversations = payload.conversations;
  renderList();
}

async function openConversation(id) {
  const payload = await api(`/api/conversations/${id}`);
  state.activeConversation = payload.conversation;
  renderConversation();
  setSidebar(false);
  elements.input.focus();
}

async function newConversation() {
  if (state.sending) return;
  const payload = await api("/api/conversations", { method: "POST", body: "{}" });
  state.activeConversation = payload.conversation;
  await refreshList();
  renderConversation();
  setSidebar(false);
  elements.input.focus();
}

async function togglePinned(conversation) {
  await api(`/api/conversations/${conversation.id}/pin`, {
    method: "PATCH",
    body: JSON.stringify({ pinned: !conversation.pinned }),
  });
  await refreshList();
}

function speakMessage(content, button) {
  if (button.dataset.speaking === "true") {
    speechSynthesis.cancel();
    button.dataset.speaking = "false";
    button.textContent = "Escuchar";
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(content);
  utterance.lang = "es-CR";
  button.dataset.speaking = "true";
  button.textContent = "Detener voz";
  const reset = () => {
    button.dataset.speaking = "false";
    button.textContent = "Escuchar";
  };
  utterance.addEventListener("end", reset);
  utterance.addEventListener("error", reset);
  speechSynthesis.speak(utterance);
}

function formatBytes(size) {
  return size < 1024 ? `${size} B` : `${Math.round(size / 1024)} KB`;
}

function renderDocuments() {
  elements.documentList.replaceChildren();
  const documents = state.activeConversation?.documents || [];
  if (!documents.length) {
    const empty = document.createElement("p");
    empty.textContent = "Aún no hay archivos en esta conversación.";
    elements.documentList.append(empty);
    return;
  }
  for (const documentInfo of documents) {
    const row = document.createElement("div");
    row.className = "document-row";
    const info = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = documentInfo.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(documentInfo.size);
    info.append(name, size);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Quitar";
    remove.addEventListener("click", async () => {
      if (!confirm(`¿Quitar ${documentInfo.name} de esta conversación?`)) return;
      const payload = await api(`/api/conversations/${state.activeConversation.id}/documents/${documentInfo.id}`, { method: "DELETE" });
      state.activeConversation = payload.conversation;
      renderDocuments();
      renderConversation();
      await refreshList();
    });
    row.append(info, remove);
    elements.documentList.append(row);
  }
}

function downloadJson(filename, payload) {
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

async function readStream(response, onEvent) {
  if (!response.ok) {
    const payload = await response.json();
    throw new Error(payload.error || "No se pudo iniciar la respuesta.");
  }
  if (!response.body) throw new Error("El navegador no admite respuestas en streaming.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) if (line.trim()) onEvent(JSON.parse(line));
  }
  if (buffer.trim()) onEvent(JSON.parse(buffer));
}

async function sendMessage(message, regenerate = false) {
  if (state.sending || (!regenerate && !message.trim())) return;
  if (!state.activeConversation) await newConversation();

  const conversationId = state.activeConversation.id;
  const originalMessages = [...state.activeConversation.messages];
  const optimistic = {
    id: crypto.randomUUID(),
    role: "user",
    content: message.trim(),
    createdAt: new Date().toISOString(),
  };
  if (regenerate) {
    if (state.activeConversation.messages.at(-1)?.role !== "assistant") return;
    state.activeConversation.messages.pop();
  } else {
    state.activeConversation.messages.push(optimistic);
  }
  renderConversation();
  const streamingMessage = {
    id: "streaming",
    role: "assistant",
    content: "",
    createdAt: new Date().toISOString(),
  };
  const streamingElement = messageElement(streamingMessage);
  const streamingContent = streamingElement.querySelector(".message-content");
  streamingElement.querySelector(".message-actions").remove();
  elements.messages.append(streamingElement);
  state.abortController = new AbortController();
  setSending(true);

  let completed = false;
  let warning = null;
  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: state.abortController.signal,
      body: JSON.stringify({ conversationId, message: message.trim(), regenerate }),
    });
    await readStream(response, (event) => {
      if (event.type === "delta") {
        streamingMessage.content += event.delta;
        renderMarkdown(streamingContent, streamingMessage.content);
        elements.messages.scrollTop = elements.messages.scrollHeight;
      } else if (event.type === "done") {
        state.activeConversation = event.conversation;
        warning = event.warning;
        completed = true;
        elements.connection.textContent = event.mode === "model" ? "Modelo generativo activo" : "Motor offline activo";
      } else if (event.type === "error") {
        throw new Error(event.error);
      }
    });
    if (!completed) throw new Error("La respuesta terminó de forma inesperada.");
    renderConversation();
    if (warning) showError(`El modelo no respondió. Se usó el modo offline: ${warning}`);
    await refreshList();
  } catch (error) {
    if (error.name === "AbortError") {
      showError("Generación detenida.");
      await new Promise((resolve) => setTimeout(resolve, 120));
      try { await openConversation(conversationId); } catch { /* Puede seguir vacía. */ }
    } else {
      state.activeConversation.messages = regenerate
        ? originalMessages
        : state.activeConversation.messages.filter((item) => item.id !== optimistic.id);
      renderConversation();
      showError(error.message);
    }
  } finally {
    state.abortController = null;
    setSending(false);
    elements.input.focus();
  }
}

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.sending) {
    state.abortController?.abort();
    return;
  }
  const message = elements.input.value;
  elements.input.value = "";
  elements.input.style.height = "auto";
  elements.characterCount.textContent = "0 / 8000";
  await sendMessage(message);
});

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});

elements.input.addEventListener("input", () => {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
  elements.characterCount.textContent = `${elements.input.value.length} / 8000`;
});

elements.search.addEventListener("input", () => {
  state.search = elements.search.value.trim();
  renderList();
});

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase("es") === "k") {
    event.preventDefault();
    setSidebar(true);
    elements.search.focus();
  }
});

elements.newChat.addEventListener("click", newConversation);
elements.menu.addEventListener("click", () => setSidebar(true));
elements.backdrop.addEventListener("click", () => setSidebar(false));

elements.renameChat.addEventListener("click", () => {
  if (!state.activeConversation || state.sending) return;
  elements.renameInput.value = state.activeConversation.title;
  elements.renameDialog.showModal();
  elements.renameInput.select();
});

elements.renameCancel.addEventListener("click", () => elements.renameDialog.close());

elements.renameForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const title = elements.renameInput.value.trim();
  if (!title || title === state.activeConversation.title) {
    elements.renameDialog.close();
    return;
  }
  const payload = await api(`/api/conversations/${state.activeConversation.id}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
  state.activeConversation = payload.conversation;
  elements.renameDialog.close();
  await refreshList();
  renderConversation();
});

elements.deleteChat.addEventListener("click", async () => {
  if (state.sending || !state.activeConversation || !confirm("¿Borrar esta conversación? Esta acción no se puede deshacer.")) return;
  await api(`/api/conversations/${state.activeConversation.id}`, { method: "DELETE" });
  state.activeConversation = null;
  await refreshList();
  if (state.conversations[0]) await openConversation(state.conversations[0].id);
  else await newConversation();
});

elements.exportChat.addEventListener("click", () => {
  if (!state.activeConversation) return;
  const lines = state.activeConversation.messages.map((message) => {
    const author = message.role === "assistant" ? "Veltron IA" : "Tú";
    return `${author}\n${message.content}`;
  });
  const blob = new Blob([`${state.activeConversation.title}\n\n${lines.join("\n\n")}\n`], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${state.activeConversation.title.replace(/[^a-z0-9áéíóúñ]+/gi, "-").toLowerCase() || "chat"}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
});

elements.themeToggle.addEventListener("click", () => {
  const current = localStorage.getItem("veltron-theme") || "system";
  applyTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
});

elements.knowledgeButton.addEventListener("click", () => {
  if (!state.activeConversation || state.sending) return;
  renderDocuments();
  elements.knowledgeDialog.showModal();
});

elements.knowledgeClose.addEventListener("click", () => elements.knowledgeDialog.close());

elements.knowledgeForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const files = [...elements.knowledgeInput.files];
  if (!files.length) return;
  try {
    for (const file of files) {
      if (file.size > 500_000) throw new Error(`${file.name} supera el límite de 500 KB.`);
      const content = await file.text();
      const payload = await api(`/api/conversations/${state.activeConversation.id}/documents`, {
        method: "POST",
        body: JSON.stringify({ name: file.name, type: file.type, content }),
      });
      state.activeConversation = payload.conversation;
    }
    elements.knowledgeInput.value = "";
    renderDocuments();
    renderConversation();
    await refreshList();
  } catch (error) {
    elements.knowledgeDialog.close();
    showError(error.message);
  }
});

elements.backupExport.addEventListener("click", async () => {
  const backup = await api("/api/backup");
  downloadJson(`veltron-ia-${new Date().toISOString().slice(0, 10)}.json`, backup);
});

elements.backupImportButton.addEventListener("click", () => elements.backupImport.click());

elements.backupImport.addEventListener("change", async () => {
  const file = elements.backupImport.files[0];
  if (!file || !confirm("¿Importar este respaldo y combinarlo con tus conversaciones actuales?")) return;
  try {
    const backup = JSON.parse(await file.text());
    await api("/api/backup", { method: "POST", body: JSON.stringify(backup) });
    await refreshList();
    if (state.conversations[0]) await openConversation(state.conversations[0].id);
  } catch (error) {
    showError(`No se pudo importar el respaldo: ${error.message}`);
  } finally {
    elements.backupImport.value = "";
  }
});

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognition) {
  const recognition = new SpeechRecognition();
  let recognizing = false;
  recognition.lang = "es-CR";
  recognition.interimResults = false;
  recognition.addEventListener("start", () => {
    recognizing = true;
    elements.voiceInput.classList.add("listening");
    elements.voiceInput.textContent = "Escuchando";
  });
  recognition.addEventListener("end", () => {
    recognizing = false;
    elements.voiceInput.classList.remove("listening");
    elements.voiceInput.textContent = "Dictar";
  });
  recognition.addEventListener("result", (event) => {
    elements.input.value = event.results[0][0].transcript;
    elements.input.dispatchEvent(new Event("input"));
    elements.input.focus();
  });
  recognition.addEventListener("error", (event) => showError(`No se pudo usar el micrófono: ${event.error}.`));
  elements.voiceInput.addEventListener("click", () => {
    if (recognizing) recognition.stop();
    else recognition.start();
  });
} else {
  elements.voiceInput.disabled = true;
  elements.voiceInput.title = "El reconocimiento de voz no está disponible en este navegador.";
}

document.querySelectorAll(".suggestions button").forEach((button) => {
  button.addEventListener("click", () => {
    elements.input.value = button.textContent;
    elements.input.dispatchEvent(new Event("input"));
    elements.input.focus();
  });
});

async function initialize() {
  applyTheme(localStorage.getItem("veltron-theme") || "system");
  try {
    state.health = await api("/api/health");
    const modelActive = state.health.mode === "model";
    elements.modeLabel.textContent = modelActive ? state.health.model : "Motor offline";
    elements.connection.textContent = modelActive ? "Modelo generativo activo" : "Motor offline activo";
    await refreshList();
    if (state.conversations[0]) await openConversation(state.conversations[0].id);
    else await newConversation();
  } catch (error) {
    elements.modeLabel.textContent = "Sin conexión";
    elements.connection.textContent = "No se pudo iniciar";
    showError(error.message);
  }
}

initialize();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/service-worker.js").catch(() => {}));
}
