"""
V-Track ML Service - anomaly detection inference API.

Run: uvicorn main:app --host 0.0.0.0 --port 8001
Docs: http://localhost:8001/docs

This is a real, running FastAPI service backed by an actual trained
scikit-learn model (see train.py) - not a mock. It's scoped to the
fuel-theft use case from the v2 spec; ev-battery/predictive-maintenance/
driver-risk models follow the same pattern (train a model, load it here,
add an endpoint) and are left as documented extension points rather than
built out, to keep this demonstration focused.
"""
import os
from contextlib import asynccontextmanager
from typing import Optional

import joblib
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
FUEL_THEFT_MODEL_PATH = os.path.join(MODELS_DIR, "fuel_theft_isolation_forest_latest.pkl")

models: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.path.exists(FUEL_THEFT_MODEL_PATH):
        models["fuel_theft"] = joblib.load(FUEL_THEFT_MODEL_PATH)
        print(f"Loaded fuel_theft model from {FUEL_THEFT_MODEL_PATH}")
    else:
        print(f"WARNING: no model found at {FUEL_THEFT_MODEL_PATH} - run train.py first. "
              f"/predict/fuel-theft will return 503 until then.")
    yield
    models.clear()


app = FastAPI(title="V-Track ML Service", version="0.1.0", lifespan=lifespan)


class FuelTheftFeatures(BaseModel):
    vehicle_id: str
    fuel_drop_rate_pct_per_min: float = Field(..., ge=0, description="Percentage points of fuel lost per minute")
    speed_kmh: float = Field(..., ge=0)
    hour_of_day: int = Field(..., ge=0, le=23)
    is_known_location: bool = Field(..., description="Whether this is a location the vehicle regularly visits")


class AnomalyResponse(BaseModel):
    vehicle_id: str
    score: float
    is_anomaly: bool
    explanation: dict


class FeedbackRequest(BaseModel):
    anomaly_event_id: str
    is_false_positive: bool
    reviewer_id: Optional[str] = None


@app.get("/health")
def health():
    return {"status": "ok", "models_loaded": list(models.keys())}


@app.post("/predict/fuel-theft", response_model=AnomalyResponse)
def predict_fuel_theft(features: FuelTheftFeatures):
    model = models.get("fuel_theft")
    if model is None:
        raise HTTPException(status_code=503, detail="fuel_theft model not loaded - run train.py first")

    X = np.array([[
        features.fuel_drop_rate_pct_per_min,
        features.speed_kmh,
        features.hour_of_day,
        int(features.is_known_location),
    ]])

    # IsolationForest: score_samples is higher = more normal, so negate it
    # to get a score where higher = more anomalous (matches anomaly_events.score
    # in the DB schema, which the NestJS AnalyticsService writes this into).
    raw_score = float(-model.score_samples(X)[0])
    is_anomaly = bool(model.predict(X)[0] == -1)

    top_factor = "fuel_drop_rate" if features.fuel_drop_rate_pct_per_min > 3 else (
        "unusual_time" if features.hour_of_day in (0, 1, 2, 3, 4, 22, 23) else
        "unfamiliar_location" if not features.is_known_location else
        "combined_factors"
    )

    return AnomalyResponse(
        vehicle_id=features.vehicle_id,
        score=round(raw_score, 4),
        is_anomaly=is_anomaly,
        explanation={
            "top_factor": top_factor,
            "fuel_drop_rate_pct_per_min": features.fuel_drop_rate_pct_per_min,
            "speed_kmh": features.speed_kmh,
            "hour_of_day": features.hour_of_day,
            "is_known_location": features.is_known_location,
        },
    )


@app.post("/feedback")
def submit_feedback(feedback: FeedbackRequest):
    """
    Mirrors POST /api/anomalies/:id/feedback from the v2 spec. In production
    this writes to anomaly_events.is_false_positive/reviewed_by/reviewed_at
    (via the NestJS API, which owns that table) - this service doesn't touch
    Postgres directly, it just needs to exist so NestJS has somewhere to
    eventually forward "was this a good call" signal for retraining. Stubbed
    here since there's no live anomaly_events table to write to in this demo.
    """
    return {
        "received": True,
        "note": "Feedback would be persisted to anomaly_events by the NestJS API; "
                "this service is inference-only.",
        "feedback": feedback.model_dump(),
    }
