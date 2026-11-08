"""
Batch training pipeline for the fuel-theft anomaly model. Run on a schedule
(weekly cron / Airflow DAG) in production, reading from the real
`ml_features` table instead of synthetic_data.py. Run directly for now:

    python3 train.py
"""
import os
import joblib
import numpy as np
from datetime import datetime, timezone
from sklearn.ensemble import IsolationForest
from sklearn.model_selection import train_test_split

from synthetic_data import load_training_data

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")


def train_fuel_theft_model() -> str:
    df = load_training_data()
    X = df[["fuel_drop_rate", "speed", "hour", "is_known_location"]].values

    X_train, X_test = train_test_split(X, test_size=0.2, random_state=42)

    model = IsolationForest(
        n_estimators=200,
        contamination=0.02,  # matches synthetic_data.py's ~2% theft rate
        random_state=42,
    )
    model.fit(X_train)

    predictions = model.predict(X_test)
    flagged = np.sum(predictions == -1)
    print(f"Trained on {len(X_train)} samples, flagged {flagged}/{len(X_test)} "
          f"({flagged / len(X_test) * 100:.1f}%) of held-out set as anomalies.")

    os.makedirs(MODELS_DIR, exist_ok=True)
    version = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    artifact_path = os.path.join(MODELS_DIR, f"fuel_theft_isolation_forest_{version}.pkl")
    joblib.dump(model, artifact_path)

    latest_path = os.path.join(MODELS_DIR, "fuel_theft_isolation_forest_latest.pkl")
    joblib.dump(model, latest_path)

    print(f"Saved model artifact: {artifact_path}")
    print(f"Updated latest pointer: {latest_path}")
    return artifact_path


if __name__ == "__main__":
    train_fuel_theft_model()
