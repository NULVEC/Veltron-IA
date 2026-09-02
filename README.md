# Veltron IA

Asistente web local con conversaciones persistentes, archivos de conocimiento,
voz, memoria y conexión opcional a cualquier API compatible con OpenAI. Sin un
proveedor configurado utiliza un motor offline de intenciones y aritmética.

**Versión web:** [nulvec.github.io/Veltron-IA](https://nulvec.github.io/Veltron-IA/)

En GitHub Pages funciona enteramente en el navegador y guarda los datos en
`localStorage`. La ejecución local con Node habilita el servidor, almacenamiento
en archivos y la conexión opcional con modelos compatibles con OpenAI.

## Modo online en GitHub Pages

La versión pública usa Puter AI con el modelo de pago por usuario. No contiene
claves del desarrollador: la primera consulta puede solicitar autorización o
inicio de sesión en Puter. El historial permanece en el navegador, pero los
mensajes enviados y los fragmentos relevantes de archivos se transmiten a Puter
para generar la respuesta. Si el servicio no está disponible, la conversación
continúa con el motor offline.

## Funciones

- Respuestas progresivas mediante streaming.
- Botón para detener una generación en curso.
- Historial persistente con búsqueda y títulos editables.
- Chats fijados y respaldos completos que se pueden importar o exportar.
- Consulta local de archivos de texto, Markdown, CSV y JSON por conversación.
- Dictado y lectura en voz alta mediante las funciones disponibles en el navegador.
- Regeneración de la última respuesta.
- Markdown seguro para enlaces, énfasis y bloques de código.
- Copia y exportación de respuestas.
- Tema del sistema, claro u oscuro.
- Aplicación web instalable (PWA) con caché de la interfaz.
- Interfaz VELTRON adaptable desde móviles compactos hasta monitores ultrawide.
- IA online en GitHub Pages mediante Puter AI, con autorización individual y caída offline.
- Contador de caracteres y atajo `Ctrl+K` para buscar chats.
- Caída automática al motor offline cuando un proveedor no responde.

## Requisitos

- Node.js 20 o superior

## Ejecutar la aplicación web

```powershell
npm start
```

Abre `http://127.0.0.1:4173`. El servidor escucha solo en el equipo local. Los
datos se guardan en `.data/`, que está excluido de Git.

También puedes iniciarla desde cualquier carpeta después de la instalación global:

```powershell
veltron-ia-web
```

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

Los documentos se procesan y almacenan localmente. Solo se envían al proveedor
los fragmentos relevantes cuando hay un modelo externo configurado. El contenido
de los archivos se trata como referencia no confiable, no como instrucciones.

## Archivos y respaldos

Usa **Archivos** dentro de un chat para adjuntar hasta 10 documentos de texto de
500 KB cada uno. Los respaldos JSON incluyen conversaciones, mensajes y archivos;
al importarlos se combinan con los datos existentes. La importación admite
respaldos de hasta 25 MB.

El dictado necesita un navegador compatible y permiso de micrófono. La lectura
en voz alta usa las voces instaladas en el sistema.

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
- `src/knowledge.js`: recuperación local de fragmentos de documentos.
- `src/llm-client.js`: cliente de modelos compatible con OpenAI.
- `src/assistant-service.js`: orquestación, contexto y streaming.
- `src/server.js`: servidor HTTP local y API.
- `public/`: interfaz web responsive.
- `src/cli.js`: interfaz alternativa de terminal.
- `test/`: pruebas del motor, conocimiento, proveedor y servidor web.
