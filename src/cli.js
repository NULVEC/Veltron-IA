#!/usr/bin/env node

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createReply } from "./engine.js";
import { MemoryStore } from "./memory-store.js";

const HELP = `
Comandos disponibles:
  /help    Muestra esta ayuda
  /memory  Enseña lo que el bot recuerda
  /clear   Borra la memoria guardada
  /exit    Cierra el chat

También puedes decir "me llamo Ana" o pedir "cuánto es 12 * 4".
`;

async function main() {
  const store = new MemoryStore();
  let memory = await store.load();
  const chat = createInterface({ input, output });

  console.log("\n╭──────────────────────────────────╮");
  console.log("│        VELTRON IA · LOCAL         │");
  console.log("╰──────────────────────────────────╯");
  console.log('Bot: ¡Hola! Escribe /help para ver lo que puedo hacer.\n');

  try {
    while (true) {
      const message = (await chat.question("Tú: ")).trim();
      const command = message.toLocaleLowerCase("es");

      if (["/exit", "/salir"].includes(command)) {
        console.log("Bot: ¡Hasta luego!");
        break;
      }
      if (command === "/help") {
        console.log(HELP);
        continue;
      }
      if (command === "/memory") {
        console.log(`Bot: ${memory.name ? `Recuerdo que te llamas ${memory.name}.` : "Aún no recuerdo nada sobre ti."}`);
        continue;
      }
      if (command === "/clear") {
        memory = {};
        await store.clear();
        console.log("Bot: Memoria borrada.");
        continue;
      }

      const response = createReply(message, memory);
      memory = response.memory;
      await store.save(memory);
      console.log(`Bot: ${response.text}`);
    }
  } finally {
    chat.close();
  }
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
