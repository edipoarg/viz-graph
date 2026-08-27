.PHONY: up down dev dev-backend dev-frontend install test logs clean

# ── Docker (producción) ──────────────────────────────────────────────────────

up: .env
	docker compose up --build

down:
	docker compose down

logs:
	docker compose logs -f

# ── Desarrollo local ─────────────────────────────────────────────────────────

dev:
	@trap 'kill 0' INT; \
	$(MAKE) dev-backend & \
	$(MAKE) dev-frontend & \
	wait

dev-backend:
	cd backend && \
	[ -d .venv ] || python3 -m venv .venv && \
	. .venv/bin/activate && \
	pip install -q -r requirements.txt && \
	uvicorn app.main:app --reload --port 8001

dev-frontend:
	cd frontend && \
	[ -d node_modules ] || npm install && \
	npm run dev

install:
	cd backend && [ -d .venv ] || python3 -m venv .venv && . .venv/bin/activate && pip install -q -r requirements.txt
	cd frontend && npm install

# ── Tests ────────────────────────────────────────────────────────────────────

test:
	cd backend && . .venv/bin/activate && pytest app/tests/ -v

# ── Utilidades ───────────────────────────────────────────────────────────────

.env:
	cp .env.example .env
	@echo "✔ .env creado desde .env.example — editalo si necesitás cambiar credenciales"

clean:
	docker compose down -v
	rm -rf backend/.venv frontend/node_modules frontend/dist
