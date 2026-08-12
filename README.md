# Edipo Viz — CSV → Graph Explorer

Open-source MVP para importar archivos CSV y visualizar grafos interactivos usando Neo4j, FastAPI y React.

## Stack

| Capa | Tecnología |
|------|-----------|
| Base de datos | Neo4j 5 Community (Docker) |
| Backend | FastAPI + driver oficial Neo4j |
| Frontend | React 18 + MUI 5 + Cytoscape.js |
| Infra | Docker Compose |

## Características

- **Subir CSV** con preview de las primeras 5 filas
- **Mapear columnas**: nodo origen, nodo destino, tipo de relación y peso opcional
- **Importación por lotes** con progreso en tiempo real (Server-Sent Events)
- **Merge sin duplicados** mediante `MERGE` en Neo4j
- **Datasets independientes** aislados por `dataset_id`
- **Visualización interactiva**: zoom, desplazamiento, selección, layout automático
- **Búsqueda** de nodos por nombre
- **Filtros** por tipo de relación
- **Listar, abrir y eliminar** datasets existentes
- **Credenciales de Neo4j** nunca expuestas al frontend

## Levantar con Docker Compose

```bash
# 1. Clonar
git clone https://github.com/tu-usuario/edipo-viz.git
cd edipo-viz

# 2. Configurar variables de entorno
cp .env.example .env
# Editá .env si querés cambiar la contraseña de Neo4j

# 3. Levantar
docker compose up --build

# Servicios:
#   Frontend  → http://localhost:5173
#   API       → http://localhost:8000/docs
#   Neo4j UI  → http://localhost:7474
```

## Desarrollo local (sin Docker)

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Con Neo4j corriendo localmente:
export NEO4J_URI=bolt://localhost:7687
export NEO4J_USER=neo4j
export NEO4J_PASSWORD=edipo_secret

uvicorn app.main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Datos de ejemplo

El archivo `data/example.csv` incluye un grafo de personas con relaciones `KNOWS`, `WORKS_WITH`, `MENTORS`, `REPORTS_TO` y `COLLABORATES`.

```
source,target,relation,weight
Alice,Bob,KNOWS,1
Bob,Carol,WORKS_WITH,3
...
```

## Ejecutar tests del backend

```bash
cd backend
# Requiere Neo4j corriendo (local o Docker)
pytest app/tests/ -v
```

## Variables de entorno

| Variable | Descripción | Default |
|----------|-------------|---------|
| `NEO4J_URI` | URI Bolt de Neo4j | `bolt://localhost:7687` |
| `NEO4J_USER` | Usuario de Neo4j | `neo4j` |
| `NEO4J_PASSWORD` | Contraseña de Neo4j | `edipo_secret` |
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

## Licencia

MIT
make dev-backend