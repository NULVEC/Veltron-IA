# Arquitectura de la Meta-IA de Veltron

## Estado actual

La versión 1.5 incorpora el primer núcleo ejecutable de AI Factory. Admite
proyectos de clasificación de texto, entrena dos modelos Naive Bayes con
estrategias de características distintas, los evalúa con un conjunto reservado,
registra sus generaciones y selecciona el mejor. No ejecuta código generado ni
usa GPU todavía.

## Componentes

```text
Interfaz Veltron / cliente API
              |
              v
       API HTTP de proyectos
              |
              v
    Factory Orchestrator ---------> Audit log
       |          |                    |
       |          v                    v
       |     Experiment Manager --> Project Store
       v                               |
   AI Factory                          v
       |                         Model Registry
       +--> entrenamiento confiable
       +--> evaluación objetiva
       +--> comparación y selección
```

El `FactoryOrchestrator` controla el ciclo, consulta límites antes de cada
experimento y mantiene el estado del proyecto. `text-classifier` contiene la
primera arquitectura confiable. `FactoryProjectStore` conserva proyectos,
modelos, experimentos y auditoría mediante escrituras atómicas.

## Flujo implementado

1. El usuario crea un proyecto con objetivo, dataset etiquetado, métrica objetivo
   y límites.
2. Se valida que existan al menos dos clases y tres ejemplos por clase.
3. Se hace una separación estratificada de entrenamiento y evaluación.
4. La generación 1 entrena una línea base con unigramas.
5. La generación 2 deriva del primer modelo y añade bigramas con otro suavizado.
6. Ambos modelos se evalúan con accuracy, F1 macro y latencia.
7. Se selecciona el mejor por accuracy, F1 y latencia, en ese orden.
8. El registro conserva el padre, arquitectura, hiperparámetros, dataset,
   métricas, errores, decisión y eventos de auditoría.

## API disponible

```text
POST /api/projects
GET  /api/projects
GET  /api/projects/{id}
POST /api/projects/{id}/run
POST /api/projects/{id}/stop
GET  /api/projects/{id}/models
GET  /api/projects/{id}/experiments
GET  /api/models/{id}
GET  /api/experiments/{id}
```

Ejemplo mínimo para crear un proyecto:

```json
{
  "objective": "Clasificar opiniones como positivas o negativas",
  "autonomy": "supervised",
  "successCriteria": { "accuracy": 0.9 },
  "limits": {
    "maxModels": 2,
    "maxExperiments": 2,
    "maxGenerations": 2,
    "maxTimeMs": 30000
  },
  "dataset": [
    { "text": "excelente producto", "label": "positivo" },
    { "text": "excelente servicio", "label": "positivo" },
    { "text": "excelente compra", "label": "positivo" },
    { "text": "producto muy malo", "label": "negativo" },
    { "text": "servicio muy malo", "label": "negativo" },
    { "text": "compra muy mala", "label": "negativo" }
  ]
}
```

## Límites de seguridad

- Solo se ejecuta código confiable incluido en el repositorio.
- Ningún proyecto puede aumentar sus permisos o cambiar sus límites.
- Los artefactos internos de modelos no se exponen en las respuestas generales.
- El ciclo comprueba tiempo, modelos, experimentos, generaciones y solicitudes
  de parada antes de crear cada candidato.
- El modo predeterminado es supervisado.

## Evolución prevista

1. Añadir el panel visual de proyectos y datasets.
2. Ejecutar trabajos en una cola persistente para permitir paradas inmediatas.
3. Incorporar sandbox externo con CPU, RAM, disco, red y tiempo limitados.
4. Añadir generación controlada de código y pruebas dentro del sandbox.
5. Conectar entrenamiento PyTorch y almacenamiento de checkpoints.
6. Incorporar agentes de investigación, datos, crítica y optimización.
7. Añadir presupuesto monetario, despliegues y múltiples GPUs.

GitHub Pages continúa siendo una interfaz estática. El entrenamiento, registro y
sandbox requieren ejecutar el servidor Node local o desplegar un backend privado.
