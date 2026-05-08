# 🛡️ Linux PFE — Hybrid IDPS with Multi-Agent AI

## Overview
An intelligent Intrusion Detection and Prevention System (IDPS) for Linux servers,
combining machine learning, multi-agent AI (CrewAI), and a real-time dashboard.
Developed as a Final Year Project final studies project at "essect" Higher School of Economic and Commercial Sciences of Tunis

---

## 🏗️ Architecture

---

## 🤖 Multi-Agent System (CrewAI)

| Agent | Role |
|-------|------|
| Collector | Fetches logs from AWS S3 |
| Analyst | Analyzes patterns and trends |
| Detector | Detects anomalies, triggers alarms |
| Corrector | Semi-automatic remediation (TRAINING / SUGGESTION / AUTO) |
| Orchestrator | Coordinates all agents |
| Reporter | Generates and saves final report to S3 |

---

## 🔑 Key Features

- **Hybrid Detection** — ML models + rule-based engine (Pass 1 & Pass 2)
- **Human-in-the-Loop** — Admin validates corrective actions before execution
- **Adaptive Memory** — System learns from admin decisions over time
- **Real-time Dashboard** — FastAPI + WebSocket + React
- **AWS S3 Integration** — Logs loaded and reports saved to S3
- **Trust Gate** — Confidence scoring before any automated action

---

## ⚙️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.11, FastAPI, CrewAI 1.14 |
| AI/ML | Scikit-learn, Isolation Forest, LLM (Groq/Llama) |
| Storage | AWS S3, Local JSON memory |
| Frontend | React, WebSocket, Chart.js |
| SSH Execution | Paramiko |
| Infrastructure | Ubuntu Server (VirtualBox lab) |

---

## 🚀 Quick Start

### Prerequisites
- Python 3.11
- Node.js 18+
- AWS account with S3 bucket
- Groq API key

### Backend
```bash
cd backend
python -m venv .venv311
.venv311\Scripts\Activate.ps1
pip install -r requirements.txt
cp .env.example .env   # fill in your credentials
python -m app.main
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

---

## 🔧 Environment Variables

Create a `.env` file in `backend/` :

```env
# AWS
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
AWS_REGION=eu-north-1
S3_BUCKET_NAME=pfe-linux-logs-supervision

# Groq LLM
GROQ_API_KEY=your_groq_key

# Agent Mode: TRAINING | SUGGESTION | AUTO
CORRECTIVE_AGENT_MODE=SUGGESTION
CONFIDENCE_THRESHOLD=0.85

# SSH Target
SSH_USER=ubuntu
SSH_TARGET_HOST=192.168.56.10
SSH_KEY_PATH=~/.ssh/id_rsa
```

---

## 📊 Pipeline Flow

---

## 👨‍💻 Author

- **Name:** arij khedhri & mariem ben ghalia
- **Email:** arij.khedhrie@gmail.com
- **university:** essect
- **Year:** 2026