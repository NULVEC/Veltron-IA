# Veltron IA

Asistente local con interfaz web, terminal, conversaciones persistentes, memoria
y conexión opcional a cualquier API compatible con OpenAI. Sin proveedor
configurado utiliza un motor offline de intenciones y aritmética.

## Requisitos

- Node.js 20 o superior

## Ejecutar la aplicación web

```powershell
npm start
```

Abre `http://127.0.0.1:4173`. El servidor escucha solo en el equipo local.

## Conectar un modelo generativo

La aplicación acepta servicios que implementen `POST /chat/completions`:

```powershell
$env:AI_BASE_URL = "https://tu-proveedor.example/v1"
$env:AI_API_KEY = "tu-clave"
$env:AI_MODEL = "nombre-del-modelo"
npm start
```

La clave se lee únicamente desde el entorno y nunca se guarda en el proyecto.
Para un servidor local que no requiera clave, omite `AI_API_KEY`.

## Ejecutar en terminal

```powershell
npm run cli
```

En la terminal están disponibles `/help`, `/memory`, `/clear` y `/exit`.

## Probar

```powershell
npm test
```

## Arquitectura

- `src/engine.js`: normalización, reconocimiento de intenciones y respuestas.
- `src/memory-store.js`: memoria persistente en JSON.
- `src/conversation-store.js`: historial de conversaciones.
- `src/llm-client.js`: cliente de modelos compatible con OpenAI.
- `src/server.js`: servidor HTTP local y API.
- `public/`: interfaz web responsive.
- `src/cli.js`: interfaz alternativa de terminal.
- `test/engine.test.js`: pruebas del comportamiento principal.
