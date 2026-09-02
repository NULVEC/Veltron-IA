export class LlmClient {
  constructor(config, fetchImplementation = fetch) {
    this.config = config;
    this.fetch = fetchImplementation;
  }

  async complete(messages) {
    if (!this.config.enabled) {
      throw new Error("El proveedor de IA no está configurado.");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const headers = { "content-type": "application/json" };
      if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;

      const response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: this.config.systemPrompt },
            ...messages,
          ],
          temperature: 0.7,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`El proveedor respondió ${response.status}: ${body.slice(0, 180)}`);
      }

      const payload = await response.json();
      const text = payload?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || !text.trim()) {
        throw new Error("El proveedor devolvió una respuesta vacía.");
      }
      return text.trim();
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error("El proveedor tardó demasiado en responder.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(messages, signal) {
    if (!this.config.enabled) {
      throw new Error("El proveedor de IA no está configurado.");
    }

    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(abort, this.config.timeoutMs);
    try {
      const headers = { "content-type": "application/json" };
      if (this.config.apiKey) headers.authorization = `Bearer ${this.config.apiKey}`;
      const response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: this.config.systemPrompt },
            ...messages,
          ],
          temperature: 0.7,
          stream: true,
        }),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`El proveedor respondió ${response.status}: ${body.slice(0, 180)}`);
      }
      if (!response.body) throw new Error("El proveedor no habilitó streaming.");

      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;
          const payload = JSON.parse(data);
          const delta = payload?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        }
      }
      const finalLine = buffer.trim();
      if (finalLine.startsWith("data:")) {
        const data = finalLine.slice(5).trim();
        if (data && data !== "[DONE]") {
          const payload = JSON.parse(data);
          const delta = payload?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        }
      }
    } catch (error) {
      if (error.name === "AbortError") {
        throw new Error(signal?.aborted ? "Generación detenida." : "El proveedor tardó demasiado en responder.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
    }
  }
}
