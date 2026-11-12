---
---

# Kartik Bajaj

**Seeking: AI/LLM Engineer Internship**

Available now for 3-6 months | Hybrid or in-person (Delhi-NCR, Chandigarh, Bangalore) or remote

Ambala, Haryana, India | [kartikbajaj.me@gmail.com](mailto:kartikbajaj.me@gmail.com) | +91 98965-35933

[github.com/kbxai](https://github.com/kbxai) | [linkedin.com/in/kbxai](https://www.linkedin.com/in/kbxai)

## Education

**Indian Institute of Technology Madras, BS in Data Science and Applications**
  : **Jun 2024 - Present**

CGPA 8.04/10 | Degree requirements complete Jul 2027 | Expected graduation Jun 2028

**S.A. Jain Senior Model School, Ambala, CBSE Class XII**
  : **2023 - 2024**

Grade 9.0/10

**Coursework:** Machine Learning, Deep Learning, NLP, DBMS, Operating Systems, Probability and Statistics, Modern Application Development

## Projects

**Interview Intelligence AI** | [interview-ai-assistance.vercel.app](https://interview-ai-assistance.vercel.app/app)
  : **Aug 2026 - Sep 2026**

*React 19, Node.js, Express 5, MongoDB, Gemini, Docker* | [github.com/kbxai/interview-intelligence-ai](https://github.com/kbxai/interview-intelligence-ai)

- Developed a full-stack app that turns a resume and job description into an interview report (evidence-grounded answers, skill gaps by severity, prep plan), with Gemini output constrained by a Zod JSON schema.
- Secured the API with JWT authentication, a token blacklist for logout, rate limiting and per-user report isolation.
- Exported ATS-style resume Markdown to PDF through headless Chrome (Puppeteer) in a Docker image; deployed the frontend on Vercel and the backend on Render.

**Messy Mashup Genre Classification** | IITM Deep Learning Kaggle competition (private)
  : **Feb 2026 - Apr 2026**

*PyTorch, Hugging Face Transformers* | [github.com/kbxai/Messy-Mashup-Genre-Classification](https://github.com/kbxai/Messy-Mashup-Genre-Classification) | [Live demo](https://huggingface.co/spaces/24f2007692/audio-classifier-genai)

- Closed a train/test distribution gap by synthesizing 10,000 noisy training clips from 1,000 clean stems with ESC-50 background noise, validated with 5-fold StratifiedGroupKFold grouped by song to prevent leakage.
- Raised validation Macro F1 from \~0.45-0.49 (MFCC, Random Forest/Gradient Boosting) to \~0.92 (ResNet-50) and \~0.96 (Audio Spectrogram Transformer) by fine-tuning pretrained models on log-mel spectrograms.
- Combined AST and ResNet-50 in a 60/40 weighted ensemble with test-time augmentation, reaching a final leaderboard Macro F1 of 0.954.

**LLM Code Deployment Agent** | IITM Tools in Data Science project
  : **Oct 2025**

*FastAPI, Pydantic, PyGithub, Docker* | [github.com/kbxai/LLM-Powered-Code-Deployment-Agent](https://github.com/kbxai/LLM-Powered-Code-Deployment-Agent) | [Live demo](https://huggingface.co/spaces/24f2007692/llm-code-deployer)

- Created a FastAPI service that turns a natural-language brief into a static web app using an LLM (OpenAI-compatible API), then creates or updates a GitHub repository and enables GitHub Pages.
- Verified each deployment by polling the live URL, ran generation as background tasks, validated requests with Pydantic, and supported revision requests on existing repositories.

**MedSyncPro Hospital Management System** | IITM MAD-2 coursework
  : **2026**

*Flask, Vue.js, Celery, Redis, Docker Compose* | [github.com/kbxai/MedSyncPro-Hospital-Management-System](https://github.com/kbxai/MedSyncPro-Hospital-Management-System)

- Implemented a role-based (admin, doctor, patient) appointment system with JWT authentication and server-side double-booking checks.
- Scheduled Celery Beat jobs on Redis: daily 08:00 appointment reminders and a monthly report.

**Comment Category Prediction** | IITM ML competition
  : **2026**

*scikit-learn, TF-IDF* | [github.com/kbxai/Comment-Category-Prediction-Challenge](https://github.com/kbxai/Comment-Category-Prediction-Challenge)

- Compared 8 models on TF-IDF features; a voting ensemble of SGD, bagged Logistic Regression and SVC reached Macro F1 0.8295, ahead of LightGBM (0.7386) and an MLP (0.7460).

## Skills

**LLM and GenAI:** Gemini API, OpenAI-compatible APIs, structured output (Pydantic, Zod), prompt design  
**RAG:** RAG pipelines, ChromaDB, bge-small-en-v1.5 embeddings, LangChain  
**ML and Data:** PyTorch, scikit-learn, Hugging Face Transformers, Pandas, NumPy, TF-IDF, model evaluation  
**Languages:** Python, JavaScript, SQL  
**Backend and Frontend:** FastAPI, Flask, Node.js, Express, REST, JWT, Celery, Redis, MongoDB, React, Vue.js  
**Tools:** Docker, Docker Compose, Git, GitHub, GitHub Pages, Vercel, Render, Hugging Face Spaces  
**AI coding tools:** Claude Code, Google Antigravity
