import os
import requests
import joblib
import numpy as np
import tensorflow as tf
from dotenv import load_dotenv
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing.sequence import pad_sequences
from tensorflow.keras.layers import Layer
from pymongo import MongoClient
from database import system_collection
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor

load_dotenv()

# -----------------------------
# HuggingFace Config
# -----------------------------
HF_TOKEN = os.getenv("HF_TOKEN") # Put your Hugging face API token in the .env file as HF_TOKEN
BERT_API_URL = os.getenv("BERT_API_URL") # Put the Link to the model you used in the .env file as BERT_API_URL

headers = {
    "Authorization": f"Bearer {HF_TOKEN}"
}

# -----------------------------
# Paths
# -----------------------------
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_DIR = os.path.join(BASE_DIR, "models")

LR_PATH = os.path.join(MODEL_DIR, "logistic_model.pkl")
RF_PATH = os.path.join(MODEL_DIR, "random_forest_model.pkl")
VECT_PATH = os.path.join(MODEL_DIR, "tfidf_vectorizer.pkl")

LSTM_MODEL_PATH = os.path.join(MODEL_DIR, "lstm_phishing_model.keras")
LSTM_TOKENIZER_PATH = os.path.join(MODEL_DIR, "tokenizer.pkl")

BILSTM_MODEL_PATH = os.path.join(MODEL_DIR, "bilstm_attn_model.h5")

LSTM_MAXLEN = 100

# -----------------------------
# Default Weights
# -----------------------------
DEFAULT_WEIGHTS = {
    "lr": 0.25,
    "rf": 0.15,
    "lstm": 0.10,
    "bilstm": 0.15,
    "bert": 0.35
}

stored = system_collection.find_one({"_id": "ensemble_weights"})

if stored and "weights" in stored:
    WEIGHTS = stored["weights"]
else:
    WEIGHTS = DEFAULT_WEIGHTS.copy()
    system_collection.update_one(
        {"_id": "ensemble_weights"},
        {"$set": {"weights": WEIGHTS}},
        upsert=True
    )

CLASS_LABELS = {0: "legitimate_email", 1: "phishing_email"}

# -----------------------------
# Load Classical Models
# -----------------------------
print("Loading classical models...")
lr = joblib.load(LR_PATH)
rf = joblib.load(RF_PATH)
vectorizer = joblib.load(VECT_PATH)

print("Loading LSTM...")
lstm_model = load_model(LSTM_MODEL_PATH)
lstm_tokenizer = joblib.load(LSTM_TOKENIZER_PATH)

# -----------------------------
# Custom Attention Layer
# -----------------------------
class AttentionLayer(Layer):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

    def build(self, input_shape):
        self.W = self.add_weight(
            shape=(input_shape[-1],),
            initializer="glorot_uniform",
            trainable=True,
        )
        super().build(input_shape)

    def call(self, inputs):
        scores = tf.tensordot(inputs, self.W, axes=1)
        weights = tf.nn.softmax(scores, axis=1)
        context = tf.reduce_sum(inputs * tf.expand_dims(weights, -1), axis=1)
        return context

print("Loading BiLSTM + Attention...")
bilstm_model = load_model(
    BILSTM_MODEL_PATH,
    custom_objects={"AttentionLayer": AttentionLayer}
)

# -----------------------------
# Shared Preprocessing
# -----------------------------

def prepare_sequence(text):
    seq = lstm_tokenizer.texts_to_sequences([text])
    pad = pad_sequences(seq, maxlen=LSTM_MAXLEN, padding="post", truncating="post")
    return pad

# -----------------------------
# Prediction Functions
# -----------------------------

def prob_lr_rf(text):
    X = vectorizer.transform([text])
    return lr.predict_proba(X)[0], rf.predict_proba(X)[0]


def prob_lstm_from_pad(pad):
    p = lstm_model.predict(pad, verbose=0).reshape(-1)
    prob1 = float(p[0]) if len(p) == 1 else float(p[1])
    prob0 = 1.0 - prob1
    return np.array([prob0, prob1])


def prob_bilstm_from_pad(pad):
    p = bilstm_model.predict(pad, verbose=0).reshape(-1)
    prob1 = float(p[0]) if len(p) == 1 else float(p[1])
    prob0 = 1.0 - prob1
    return np.array([prob0, prob1])


def prob_bert_binary_v4(text):
    MAX_CHARS = 2000
    text = text[:MAX_CHARS]

    payload = {
        "inputs": text,
        "options": {"wait_for_model": True}
    }

    response = requests.post(BERT_API_URL, headers=headers, json=payload)

    if response.status_code != 200:
        return np.array([0.5, 0.5])

    result = response.json()

    if isinstance(result, list) and len(result) > 0 and isinstance(result[0], list):
        result = result[0]

    probs = {item["label"]: item["score"] for item in result}

    prob_legit = probs.get("legitimate_email", 0) + probs.get("legitimate_url", 0)
    prob_phish = probs.get("phishing_url", 0) + probs.get("phishing_url_alt", 0)

    total = prob_legit + prob_phish

    if total > 0:
        prob_legit /= total
        prob_phish /= total
    else:
        prob_legit = prob_phish = 0.5

    return np.array([prob_legit, prob_phish])

# -----------------------------
# Parallel Ensemble Prediction
# -----------------------------

def ensemble_predict(email_text, weights=None):

    if weights is None:
        weights = WEIGHTS

    # shared preprocessing
    pad = prepare_sequence(email_text)

    with ThreadPoolExecutor(max_workers=4) as executor:

        future_lr_rf = executor.submit(prob_lr_rf, email_text)
        future_lstm = executor.submit(prob_lstm_from_pad, pad)
        future_bilstm = executor.submit(prob_bilstm_from_pad, pad)
        future_bert = executor.submit(prob_bert_binary_v4, email_text)

        p_lr, p_rf = future_lr_rf.result()
        p_lstm = future_lstm.result()
        p_bilstm = future_bilstm.result()
        p_bert = future_bert.result()

    probs_dict = {
        "lr": p_lr,
        "rf": p_rf,
        "lstm": p_lstm,
        "bilstm": p_bilstm,
        "bert": p_bert
    }

    avg = np.zeros(2)
    total_w = sum(weights.values())

    for model, w in weights.items():
        avg += probs_dict[model] * w

    avg /= total_w

    pred_index = int(np.argmax(avg))
    final_label = CLASS_LABELS[pred_index]

    return {
        "final_label": final_label,
        "final_confidence": float(avg[pred_index]),
        "ensemble_probabilities": {
            "legitimate_email": float(avg[0]),
            "phishing_email": float(avg[1])
        },
        "per_model_probabilities": {
            m: {
                "legitimate_email": float(v[0]),
                "phishing_email": float(v[1])
            }
            for m, v in probs_dict.items()
        }
    }

# -----------------------------
# Risk Classification
# -----------------------------

def risk_level_from_ensemble(phish_prob):

    if phish_prob >= 0.70:
        return {
            "risk": "RED",
            "color": "#e74c3c",
            "action": "block",
            "short_message": "High phishing probability"
        }

    elif phish_prob >= 0.50:
        return {
            "risk": "YELLOW",
            "color": "#f1c40f",
            "action": "review",
            "short_message": "This might be a phishing email"
        }

    else:
        return {
            "risk": "GREEN",
            "color": "#2ecc71",
            "action": "allow",
            "short_message": "Likely safe"
        }
