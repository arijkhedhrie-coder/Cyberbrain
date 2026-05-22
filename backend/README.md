# Linux_PFE Backend

## Description

Backend intelligent de détection et correction d’anomalies système Linux basé sur :

- FastAPI
- Machine Learning
- Détection hybride
- CrewAI
- Ollama
- Analyse comportementale

Le système permet :
- la collecte des logs système
- la détection d’anomalies
- l’analyse IA
- les recommandations correctives
- le monitoring intelligent

---

# Architecture

```text
app/
├── api/
├── services/
├── core/
├── models/
├── utils/
├── ai/
├── repositories/
└── schemas/
```

---

# Technologies utilisées

- Python 3.11
- FastAPI
- Scikit-learn
- CrewAI
- Ollama
- Uvicorn
- JWT Authentication

---

# Installation

## 1. Créer l’environnement virtuel

```bash
python -m venv .venv311
```

## 2. Activer l’environnement

### Windows

```bash
.venv311\Scripts\activate
```

### Linux

```bash
source .venv311/bin/activate
```

---

## 3. Installer les dépendances

```bash
pip install -r requirements.txt
```

---

# Lancer le backend

```bash
uvicorn app.services.auth_service:app --reload
```

## Redis + Celery worker

Infrastructure only: the existing business logic stays in place, and the worker currently wraps the existing pipeline entrypoint as an example async task.

Run locally:

```bash
set REDIS_URL=redis://localhost:6379/0
celery -A app.workers.celery_app.celery_app worker --pool=solo --loglevel=INFO --queues=pipeline,chat,default --concurrency=1
```

Notes:
- Local development defaults to `redis://localhost:6379/0`.
- Docker still uses `redis://redis:6379/0` through `docker-compose.yml`.
- On native Windows, use `--pool=solo` to avoid Celery `WinError 5` process-pool failures.
- If Redis is unavailable, set `TASK_QUEUE_ENABLED=false` and the API will fall back to in-process execution where supported.

Run with Docker Compose:

```bash
docker compose -f backend/docker-compose.yml up --build
```

---

# API principale

## Auth

- POST `/auth/login`
- POST `/auth/register`

## Dashboard

- GET `/dashboard/stats`
- GET `/dashboard/anomalies`

## Corrective AI

- POST `/corrective/analyze`
- POST `/corrective/recommend`

---

# Modèles ML utilisés

- Isolation Forest
- Local Outlier Factor
- One-Class SVM

---

# Fonctionnalités IA

- Détection hybride
- Analyse comportementale
- Génération de recommandations
- Profiling IP
- Analyse des logs système

---

# Sécurité

- JWT Authentication
- Validation Pydantic
- Gestion centralisée des erreurs

---

# Auteur

Projet PFE — 2026
