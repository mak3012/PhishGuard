import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"

from flask import Flask, request, jsonify
from flask_cors import CORS
from bson import ObjectId
from datetime import datetime, timezone
datetime.now(timezone.utc)

from email_preprocessing import process_email_json
from ensemble import (
    ensemble_predict,
    risk_level_from_ensemble,
    update_weights_from_feedback,
    WEIGHTS
)
from database import store_email, emails_collection

app = Flask(__name__)
CORS(app)

@app.route("/analyze", methods=["POST", "OPTIONS"])
def analyze_email():

    if request.method == "OPTIONS":
        return jsonify({"status": "ok"}), 200

    email_json = request.get_json(force=True)

    processed = process_email_json(email_json)
    clean_text = processed["clean_text"]

    result = ensemble_predict(clean_text)
    phish_prob = result["ensemble_probabilities"]["phishing_email"]
    risk = risk_level_from_ensemble(phish_prob)

    inserted_id = store_email({
        "sender": processed["sender"],
        "subject": processed["subject"],
        "clean_text": clean_text[:500],
        "final_prediction": result["final_label"],
        "final_confidence": result["final_confidence"],
        "phishing_probability": phish_prob,
        "risk_level": risk["risk"],
        "model_outputs": result["per_model_probabilities"],
        "feedback": None,
        "weights_used": WEIGHTS.copy(),
        "timestamp": datetime.now(timezone.utc)
    })

    return jsonify({
        "email_id": str(inserted_id),
        "risk_level": risk["risk"],
        "phishing_probability": phish_prob,
        "confidence": result["final_confidence"],
        "explanation": risk["short_message"],
        "details": {
            "color": risk["color"],
            "action": risk["action"]
        }
    })


@app.route("/feedback", methods=["POST"])
def receive_feedback():

    data = request.json
    email_id = data.get("email_id")
    true_label = data.get("true_label")

    if not email_id or not true_label:
        return jsonify({"error": "Invalid input"}), 400

    emails_collection.update_one(
        {"_id": ObjectId(email_id)},
        {"$set": {"feedback": true_label}}
    )

    new_weights = update_weights_from_feedback()

    return jsonify({
        "message": "Feedback recorded",
        "updated_weights": new_weights
    })


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)