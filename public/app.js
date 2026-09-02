const state = {
  conversations: [],
  activeConversation: null,
  sending: false,
  health: null,
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
  deleteChat: document.querySelector("#delete-chat"),
  exportChat: document.querySelector("#export-chat"),
  sidebar: document.querySelector("#sidebar"),
  menu: document.querySelector("#mobile-menu"),
  backdrop: document.querySelector("#sidebar-backdrop"),
};

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

function renderList() {
  elements.list.replaceChildren();
  if (!state.conversations.length) {
    const paragraph = document.createElement("p");
    paragraph.className = "sidebar-footer";
    paragraph.textContent = "Todavía no hay conversaciones.";
    elements.list.append(paragraph);
    return;
  }

  for (const conversation of state.conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${state.activeConversation?.id === conversation.id ? " active" : ""}`;
    const title = document.createElement("strong");
    title.textContent = conversation.title;
    const preview = document.createElement("span");
    preview.textContent = conversation.preview;
    button.append(title, preview);
    button.addEventListener("click", () => openConversation(conversation.id));
    elements.list.append(button);
  }
}

function messageElement(message) {
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
  content.textContent = message.content;
  body.append(meta, content);
  article.append(avatar, body);
  return article;
}

function renderConversation() {
  elements.messages.replaceChildren();
  const conversation = state.activeConversation;
  elements.title.textContent = conversation?.title || "Nueva conversación";
  if (!conversation?.messages.length) {
    elements.messages.append(elements.empty);
  } else {
    for (const message of conversation.messages) elements.messages.append(messageElement(message));
  }
  elements.messages.scrollTop = elements.messages.scrollHeight;
  renderList();
}

function showThinking() {
  const article = document.createElement("article");
  article.className = "message assistant thinking";
  article.id = "thinking";
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = "V";
  const content = document.createElement("div");
  content.className = "message-content";
  content.setAttribute("aria-label", "Veltron IA está pensando");
  content.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
  article.append(avatar, content);
  elements.messages.append(article);
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function showError(message) {
  const banner = document.createElement("div");
  banner.className = "error-banner";
  banner.textContent = message;
  elements.messages.append(banner);
  elements.messages.scrollTop = elements.messages.scrollHeight;
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
  const payload = await api("/api/conversations", { method: "POST", body: "{}" });
  state.activeConversation = payload.conversation;
  await refreshList();
  renderConversation();
  setSidebar(false);
  elements.input.focus();
}

async function sendMessage(message) {
  if (state.sending || !message.trim()) return;
  if (!state.activeConversation) await newConversation();

  state.sending = true;
  elements.send.disabled = true;
  const optimistic = {
    id: crypto.randomUUID(),
    role: "user",
    content: message.trim(),
    createdAt: new Date().toISOString(),
  };
  state.activeConversation.messages.push(optimistic);
  renderConversation();
  showThinking();

  try {
    const payload = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        conversationId: state.activeConversation.id,
        message: message.trim(),
      }),
    });
    state.activeConversation = payload.conversation;
    elements.connection.textContent = payload.mode === "model" ? "Modelo generativo activo" : "Motor offline activo";
    renderConversation();
    if (payload.warning) showError(`El modelo no respondió. Se usó el modo offline: ${payload.warning}`);
    await refreshList();
  } catch (error) {
    state.activeConversation.messages = state.activeConversation.messages.filter((item) => item.id !== optimistic.id);
    renderConversation();
    showError(error.message);
  } finally {
    state.sending = false;
    elements.send.disabled = false;
    elements.input.focus();
  }
}

elements.composer.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = elements.input.value;
  elements.input.value = "";
  elements.input.style.height = "auto";
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
});

elements.newChat.addEventListener("click", newConversation);
elements.menu.addEventListener("click", () => setSidebar(true));
elements.backdrop.addEventListener("click", () => setSidebar(false));

elements.deleteChat.addEventListener("click", async () => {
  if (!state.activeConversation || !confirm("¿Borrar esta conversación? Esta acción no se puede deshacer.")) return;
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

document.querySelectorAll(".suggestions button").forEach((button) => {
  button.addEventListener("click", () => {
    elements.input.value = button.textContent;
    elements.input.focus();
  });
});

async function initialize() {
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
