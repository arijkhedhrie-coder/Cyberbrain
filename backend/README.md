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
uvicorn app.main:app --reload
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