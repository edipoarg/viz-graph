# Edipo Viz — Visualizador de Grafos

Herramienta para cargar datos relacionales desde archivos CSV y explorarlos como grafos interactivos. Pensada para analizar, por ejemplo, redes de personas, organizaciones y sus vínculos.

Los datos se almacenan en **Neo4j**, una base de datos de grafos que permite modelar relaciones complejas. El backend expone una API REST construida con **FastAPI**, y el frontend está desarrollado en **React** con visualización mediante **Cytoscape.js**.

## Stack

| Capa | Tecnología |
|------|-----------|
| Base de datos | Neo4j 5 Community |
| Backend | Python 3.11 · FastAPI · driver oficial Neo4j |
| Frontend | React 18 · MUI 5 · Cytoscape.js |
| Infra local | Docker Compose |

## Funcionalidades

- **Subir CSV** con preview de las primeras filas
- **Mapear columnas**: nodo origen, nodo destino, tipo de relación y peso opcional
- **Importación por lotes** con progreso en tiempo real (Server-Sent Events)
- **Datasets independientes** aislados entre sí
- **Visualización interactiva**: zoom, desplazamiento, layout automático
- **Búsqueda** de nodos por nombre
- **Filtros** por tipo de relación
- **Listar, abrir y eliminar** datasets existentes

## Requisitos

- [Docker](https://docs.docker.com/get-docker/) y Docker Compose
- [Make](https://www.gnu.org/software/make/) (incluido en macOS y Linux)
- Para desarrollo local sin Docker: Python 3.11+ y Node.js 18+

## Levantar el entorno local

El entorno local usa Docker Compose para correr Neo4j, el backend y el frontend juntos.

```bash
# 1. Clonar el repositorio
git clone https://github.com/edipoarg/viz-graph.git
cd viz-graph

# 2. Configurar variables de entorno
cp .env.example .env
# Editá .env con tu contraseña de Neo4j y credenciales de la app

# 3. Levantar todos los servicios
make up
```

Una vez levantado:

| Servicio | URL |
|----------|-----|
| Frontend | http://localhost:5173 |
| API (docs) | http://localhost:8000/docs |
| Neo4j Browser | http://localhost:7474 |

Para detener: `make down`

## Desarrollo local (sin Docker)

Requiere Neo4j corriendo por separado (por ejemplo, con `make up` solo para la base de datos).

```bash
# Levantar backend y frontend en paralelo
make dev
```

Esto inicia el backend en `http://localhost:8001` y el frontend en `http://localhost:5173`.

## Variables de entorno

Copiá `.env.example` a `.env` y completá los valores:

| Variable | Descripción | Default |
|----------|-------------|---------|
| `NEO4J_URI` | URI Bolt de Neo4j | `bolt://localhost:7687` |
| `NEO4J_USER` | Usuario de Neo4j | `neo4j` |
| `NEO4J_PASSWORD` | Contraseña de Neo4j | `your_neo4j_password` |
| `CORS_ORIGINS` | Orígenes CORS permitidos (JSON list) | `["http://localhost:5173"]` |

## Estructura del proyecto

```
edipo-viz/
├── docker-compose.yml
├── .env.example
├── data/
│   └── example.csv          # CSV de muestra
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py          # App FastAPI
│       ├── config.py        # Variables de entorno
│       ├── db.py            # Driver Neo4j + lifespan
│       ├── schemas.py       # Modelos Pydantic
│       ├── routers/
│       │   ├── datasets.py  # CRUD datasets + import CSV
│       │   └── graph.py     # Query grafo + tipos de relación
│       └── tests/
│           └── test_api.py
└── frontend/
    ├── Dockerfile
    ├── package.json
    └── src/
        ├── api/client.ts    # Llamadas a la API
        ├── types/index.ts   # Tipos TypeScript
        ├── pages/
        │   ├── DatasetListPage.tsx
        │   ├── UploadPage.tsx
        │   └── GraphPage.tsx
        └── components/
            └── GraphView.tsx  # Cytoscape.js
```

## API REST

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/datasets` | Listar datasets |
| `POST` | `/api/datasets` | Crear dataset |
| `DELETE` | `/api/datasets/{id}` | Eliminar dataset |
| `POST` | `/api/datasets/preview` | Preview CSV |
| `POST` | `/api/datasets/{id}/import` | Importar CSV (streaming NDJSON) |
| `GET` | `/api/datasets/{id}/graph` | Obtener grafo (con filtros) |
| `GET` | `/api/datasets/{id}/graph/relation-types` | Tipos de relación disponibles |

Documentación interactiva disponible en `http://localhost:8000/docs`.

## Flujo de trabajo con Git

Las ramas siempre salen de `dev`. Nunca se trabaja directamente sobre `main`.

| Prefijo | Cuándo usarlo |
|---------|---------------|
| `feature/` | Nueva funcionalidad |
| `bug/` | Corrección de un bug |

```bash
git checkout dev
git pull origin dev
git checkout -b feature/nombre-del-feature
# ... trabajar ...
git push origin feature/nombre-del-feature
# Abrir PR hacia dev
```

Una vez que `dev` está estable y probado, se hace PR de `dev` → `main` para deployar.
