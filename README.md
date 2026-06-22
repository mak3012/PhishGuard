# PhishGuard: AI-Powered Phishing Email Detection System

## Overview

PhishGuard is an intelligent phishing-email detection system that integrates multiple Machine Learning (ML) and Deep Learning (DL) models within a browser extension. The system analyzes emails in real time, extracts relevant textual and structural features, and evaluates them using an ensemble of models to determine the likelihood that the email is phishing.

The architecture combines classical ML models, neural networks, and transformer-based models to achieve robust detection. Results are presented to the user through a browser extension using a simple risk-level interface (Green – Safe, Yellow – Suspicious, Red – Phishing). Feedback from users is stored and used to automatically adjust ensemble weights using reinforcement learning principles.

---

## Key Features

* Real-time phishing detection through a browser extension
* Ensemble learning combining 5 different models
* Transformer-based contextual analysis using DistilBERT
* Automatic ensemble weight adjustment using feedback
* MongoDB database integration for storing email analysis and feedback
* Risk-based classification system (Green / Yellow / Red)
* Reinforcement learning framework for continuous improvement
* Backend API built with Flask
* HTML parsing and preprocessing pipeline for email content

---

## System Architecture

```
Browser Extension
        │
        ▼
Email Extraction (content.js)
        │
        ▼
JSON Payload Sent to Backend
        │
        ▼
Flask Backend API
        │
        ▼
Email Preprocessing
    • HTML parsing
    • Visible text extraction
    • URL extraction
    • Feature generation
        │
        ▼
ML/DL Ensemble Models
    • Logistic Regression
    • Random Forest
    • LSTM
    • BiLSTM + Attention
    • DistilBERT
        │
        ▼
Ensemble Decision Engine
        │
        ▼
Risk Classification
(Green / Yellow / Red)
        │
        ▼
Result Sent to Extension UI
        │
        ▼
Stored in MongoDB
```

---

## Models Used

### Logistic Regression

A classical machine learning model trained using TF-IDF features extracted from email text.

### Random Forest

An ensemble tree-based model that improves robustness against noisy text and sparse features.

### LSTM

A recurrent neural network designed to capture sequential dependencies in email content.

### BiLSTM with Attention

An enhanced version of LSTM that processes sequences bidirectionally and uses an attention mechanism to focus on important tokens.

### DistilBERT

A lightweight transformer model capable of contextual language understanding. It captures semantic relationships within email content.

---

## Ensemble Model

All models produce probability scores for two classes:

```
0 → Legitimate Email
1 → Phishing Email
```

The final prediction is computed using a weighted ensemble:

```
Final Probability =
Σ (model_probability × model_weight)
```

Initial weights are manually set but later updated automatically using feedback.

---

## Risk Classification

Based on phishing probability:

| Probability | Risk Level | Color  |
| ----------- | ---------- | ------ |
| ≥ 0.70      | Phishing   | Red    |
| 0.50 – 0.70 | Suspicious | Yellow |
| < 0.50      | Safe       | Green  |

The extension displays:

* Risk badge
* Explanation
* Recommended action

---

## Reinforcement Learning Weight Adjustment

The system improves itself through user feedback.

When a user marks a prediction as correct or incorrect:

1. Feedback is stored in MongoDB.
2. Model predictions are compared with ground truth.
3. Ensemble weights are updated.

Weight update principle:

```
New Weight = Old Weight + α × (reward)
```

Where:

```
reward = +1 if model correct
reward = −1 if model incorrect
α = learning rate
```

Recent feedback receives higher importance using time-decay weighting.

---

## Email Preprocessing Pipeline

Incoming email JSON is processed through multiple stages.

### Step 1 – HTML Parsing

Removes HTML tags and scripts.

### Step 2 – Visible Text Extraction

Extracts meaningful content visible to users.

### Step 3 – URL Extraction

Identifies embedded links.

### Step 4 – Feature Generation

Computes features such as:

* URL count
* Suspicious domains
* IP-based URLs
* Punycode presence
* Text length

---

## Browser Extension

The extension performs three primary tasks:

### Email Extraction

Captures sender, subject, body, and links.

### Backend Communication

Sends extracted email data as JSON to the backend API.

### Result Display

Displays phishing risk information directly within the email interface.

---

## Backend API

The Flask backend exposes the following endpoint:

### Analyze Email

```
POST /analyze
```

Request format:

```
{
  "sender": "...",
  "subject": "...",
  "body": {
      "html": "...",
      "text": "..."
  },
  "links": [...]
}
```

Response format:

```
{
  "risk": "GREEN",
  "confidence": 0.98,
  "explanation": "...",
  "action": "allow"
}
```

---

## MongoDB Database

The system stores all analyzed emails and feedback for future training.

### Collections

**emails**

Stores analyzed email data.

Fields:

```
text
prediction
confidence
timestamp
model_probabilities
```

**feedback**

Stores user feedback used for reinforcement learning.

Fields:

```
email_id
true_label
timestamp
```

---

## Project Structure

```
PhishGuard
│
├── Backend
│   ├── app.py
│   ├── ensemble.py
│   ├── email_preprocessing.py
│   ├── database.py
│
├── Extension (Frontend)
│   ├── background.js
│   ├── manifest.json
│   ├── content.js
│   ├── onboarding.html
│   ├── onboarding.css
│   ├── onboarding.js
│   ├── settings.html
│   ├── settings.css
│   ├── settings.js
│   ├── popup.css
│   ├── popup.html
│   └── popup.js
│
├── Models
│   ├── logistic_model.pkl
│   ├── random_forest_model.pkl
│   ├── tfidf_vectorizer.pkl
│   ├── lstm_phishing_model.keras
│   └── bilstm_attn_model.h5
│
└── README.md
```

---

## Installation Guide

### 1. Clone Repository

```
git clone https://github.com/your-repo/PhishGuard.git
cd PhishGuard
```

### 2. Create Virtual Environment

```
python -m venv venv
source venv/bin/activate
```

Windows:

```
venv\Scripts\activate
```

### 3. Install Dependencies

```
pip install -r requirements.txt
```

### 4. Setting up .env file
The backend requires the following environment variables.

File location:
backend/.env

Contents:
```
HF_TOKEN=your_huggingface_api_token
BERT_API_URL=https://router.huggingface.co/hf-inference/models/cybersectony/phishing-email-detection-distilbert_v2.4.1
MONGO_URL=mongodb+srv://username:password@phishguard.afti2df.mongodb.net/phishing_db?retryWrites=true&w=majority
```

These variables configure:
- HuggingFace inference access
- DistilBERT inference endpoint
- MongoDB database connection

---
## Running the Backend

```
python app.py
```

Server will start at:

```
http://127.0.0.1:5000
```

---

## Running the Browser Extension

1. Open Chrome
2. Navigate to:

```
chrome://extensions
```

3. Enable **Developer Mode**
4. Click **Load Unpacked**
5. Select the extension folder

The extension will now analyze emails automatically.

---

## Model Evaluation

Models were evaluated using the following metrics:

* ROC Curve
* Precision-Recall Curve
* Confusion Matrix
* Accuracy
* Macro Precision
* Macro Recall
* Macro F1 Score
* Inference Speed

A comparative analysis was conducted between:

* Individual models
* Ensemble model

---

## Future Improvements

Potential future work includes:

* Fine-tuning transformer models on the phishing dataset
* OCR analysis for image-based phishing emails
* Graph-based analysis of phishing domains
* Federated learning for privacy-preserving updates
* Deployment on scalable cloud infrastructure

---

## License

This project is released for academic and research purposes.

---

## Authors

- **Savio David** - Models, Database and Backend
- **Aaron Coutinho** - Frontend and Extension
- **Deyon Tomy** - Data Acquisition and Dataset Generation
- **Ayush Makade** - Documentation

Developed as part of an academic research project on phishing detection using ensemble machine learning techniques.

