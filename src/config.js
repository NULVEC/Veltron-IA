const DEFAULT_SYSTEM_PROMPT = `Eres Veltron IA, un asistente útil, preciso y honesto.
Responde en el idioma del usuario. Prioriza respuestas claras y accionables.
No inventes hechos. Si no sabes algo, dilo. Protege la privacidad del usuario.
No afirmes haber realizado acciones que no ejecutaste.`;

export function loadConfig(env = process.env) {
  const baseUrl = env.AI_BASE_URL?.trim().replace(/\/$/, "") || "";
  const apiKey = env.AI_API_KEY?.trim() || "";
  const model = env.AI_MODEL?.trim() || "";
  const providerEnabled = Boolean(baseUrl && model);

  return {
    host: env.HOST?.trim() || "127.0.0.1",
    port: Number.parseInt(env.PORT || "4173", 10),
    provider: {
      enabled: providerEnabled,
      baseUrl,
      apiKey,
      model,
      systemPrompt: env.AI_SYSTEM_PROMPT?.trim() || DEFAULT_SYSTEM_PROMPT,
      timeoutMs: Number.parseInt(env.AI_TIMEOUT_MS || "60000", 10),
    },
  };
}
