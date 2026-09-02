const INTENTS = [
  {
    name: "greeting",
    patterns: [/\b(hola|buenas|hey|buenos dias|buenas tardes|buenas noches)\b/],
    replies: [
      "¡Hola{name}! ¿En qué te ayudo?",
      "¡Buenas{name}! Cuéntame qué necesitas.",
    ],
  },
  {
    name: "farewell",
    patterns: [/\b(adios|hasta luego|nos vemos|chao|chau)\b/],
    replies: ["¡Hasta luego{name}!", "Nos vemos{name}. Aquí estaré cuando vuelvas."],
  },
  {
    name: "thanks",
    patterns: [/\b(gracias|muchas gracias|te agradezco)\b/],
    replies: ["¡Con gusto{name}!", "Para eso estamos{name}."],
  },
  {
    name: "identity",
    patterns: [/\b(quien eres|como te llamas|que eres)\b/],
    replies: [
      "Soy Veltron IA, un chatbot local con reglas, contexto y memoria persistente.",
    ],
  },
  {
    name: "capabilities",
    patterns: [/\b(que puedes hacer|ayuda|help|capacidades)\b/],
    replies: [
      "Puedo conversar, recordar tu nombre, detectar intenciones y resolver operaciones básicas. Escribe /help para ver los comandos.",
    ],
  },
  {
    name: "mood",
    patterns: [/\b(como estas|todo bien)\b/],
    replies: ["Funcionando al cien{name}. ¿Cómo estás tú?"],
  },
];

export function normalize(text) {
  return text
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+\-*/().\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(items, seed) {
  const total = [...seed].reduce((sum, char) => sum + char.codePointAt(0), 0);
  return items[total % items.length];
}

function personalize(reply, memory) {
  return reply.replace("{name}", memory.name ? `, ${memory.name}` : "");
}

function extractName(input) {
  const match = input.match(
    /(?:me llamo|mi nombre es|puedes llamarme)\s+([\p{L}][\p{L}'’-]{1,30})/iu,
  );
  if (!match) return null;
  const raw = match[1].toLocaleLowerCase("es");
  return raw.charAt(0).toLocaleUpperCase("es") + raw.slice(1);
}

function calculate(input) {
  const normalized = normalize(input)
    .replace(/^(cuanto es|calcula|resolver?)\s+/, "")
    .trim();

  if (!/^[0-9+\-*/().\s]+$/.test(normalized) || !/[+\-*/]/.test(normalized)) {
    return null;
  }

  const tokens = normalized.match(/\d+(?:\.\d+)?|[()+\-*/]/g);
  if (!tokens || tokens.join("") !== normalized.replace(/\s/g, "")) return null;

  try {
    // The allowlist above limits evaluation to arithmetic tokens only.
    const result = Function(`"use strict"; return (${normalized})`)();
    return Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

export function createReply(input, memory = {}) {
  const cleanInput = input.trim();
  if (!cleanInput) {
    return { text: "Escribe algo y conversamos.", intent: "empty", memory };
  }

  const name = extractName(cleanInput);
  if (name) {
    const nextMemory = { ...memory, name };
    return {
      text: `Mucho gusto, ${name}. Lo recordaré para la próxima vez.`,
      intent: "learn_name",
      memory: nextMemory,
    };
  }

  const expressionResult = calculate(cleanInput);
  if (expressionResult !== null) {
    return {
      text: `El resultado es ${expressionResult}.`,
      intent: "calculation",
      memory,
    };
  }

  const normalized = normalize(cleanInput);
  for (const intent of INTENTS) {
    if (intent.patterns.some((pattern) => pattern.test(normalized))) {
      return {
        text: personalize(pick(intent.replies, normalized), memory),
        intent: intent.name,
        memory,
      };
    }
  }

  const fallback = memory.name
    ? `${memory.name}, todavía no entendí eso. Prueba reformulándolo o escribe /help.`
    : "Todavía no entendí eso. Prueba reformulándolo o escribe /help.";
  return { text: fallback, intent: "fallback", memory };
}
