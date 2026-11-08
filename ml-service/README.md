# V-Track ML Service

A real, trained, running FastAPI service for the fuel-theft anomaly
detection use case from `docs/v2-architecture.md` section 13. Not a mock —
`train.py` actually trains a scikit-learn `IsolationForest`, and `main.py`
actually serves predictions from the resulting model.

## Setup & run

```bash
pip install fastapi uvicorn scikit-learn pandas joblib

python3 train.py     # trains on synthetic data, saves models/fuel_theft_isolation_forest_latest.pkl
uvicorn main:app --host 0.0.0.0 --port 8001
```

Docs at `http://localhost:8001/docs`.

## Verified behavior

Tested end-to-end against a running instance:

- `GET /health` → `{"status":"ok","models_loaded":["fuel_theft"]}`
- Normal driving (0.3%/min fuel drop, 60km/h, 2pm, known location) →
  `score: 0.4465, is_anomaly: false`
- Theft-like pattern (9.5%/min fuel drop, stationary, 2am, unknown location)
  → `score: 0.7284, is_anomaly: true`, explanation correctly identifies
  `fuel_drop_rate` as the top factor
- `POST /feedback` → acknowledges and explains it's inference-only (the
  NestJS API owns writing to `anomaly_events.is_false_positive`)

## Training data

`synthetic_data.py` generates data shaped like the `ml_features` table's
`fuel_theft` feature set, since there's no live Postgres instance with real
historical telemetry in this environment. Swap `load_training_data()`'s body
for a real query once this runs against production:

```python
def load_training_data():
    return pd.read_sql(
        """
        SELECT features->>'fuel_drop_rate' AS fuel_drop_rate, ...
        FROM ml_features
        WHERE feature_set = 'fuel_theft' AND computed_at > now() - interval '90 days'
        """,
        engine,
    )
```

## What's next

- **ev_battery, predictive_maintenance, driver_risk models**: same pattern
  (synthetic-or-real data → `IsolationForest` or another model → load in
  `main.py` → add a `/predict/...` endpoint). Only `fuel_theft` is built out
  here, to keep the demonstration real rather than four shallow copies.
- **NestJS integration**: `AnalyticsService` (in the main backend repo)
  would call this service over HTTP, write results to the `anomaly_events`
  table, and call `AlertsService.raise()` for anything above threshold —
  none of that wiring exists yet, this service is currently standalone.
- **Real training data**: connect `load_training_data()` to Postgres once
  `ml_features` has real rows (populated by a feature-extraction consumer
  reading from Kafka/`telemetry.position`, per the architecture doc).
