"""
Generates synthetic training data shaped like what the ml_features table
(backend/src/database/migrations/1700000000014-*.ts) would hold for the
'fuel_theft' feature set, so the model can be trained and tested end-to-end
without a live Postgres instance. Swap `load_training_data()`'s body for a
real query against ml_features once this runs against the actual database.
"""
import numpy as np
import pandas as pd

RNG = np.random.default_rng(42)


def generate_normal_samples(n: int) -> pd.DataFrame:
    """Ordinary driving/parking - fuel changes slowly and predictably."""
    return pd.DataFrame(
        {
            "fuel_drop_rate": np.abs(RNG.normal(0.3, 0.4, n)).clip(0, 3),
            "speed": RNG.uniform(0, 110, n),
            "hour": RNG.integers(0, 24, n),
            "is_known_location": RNG.choice([0, 1], n, p=[0.3, 0.7]),
        }
    )


def generate_theft_samples(n: int) -> pd.DataFrame:
    """Simulated theft: rapid fuel drop, stationary or near-stationary, often off-hours, at an unfamiliar location."""
    return pd.DataFrame(
        {
            "fuel_drop_rate": RNG.uniform(4, 12, n),
            "speed": np.abs(RNG.normal(1, 2, n)).clip(0, 8),
            "hour": RNG.choice(
                list(range(24)), n, p=_night_weighted_hour_distribution()
            ),
            "is_known_location": RNG.choice([0, 1], n, p=[0.75, 0.25]),
        }
    )


def _night_weighted_hour_distribution():
    weights = np.ones(24)
    for h in [0, 1, 2, 3, 4, 22, 23]:
        weights[h] = 4.0
    return weights / weights.sum()


def load_training_data(n_normal: int = 2000, n_theft: int = 40) -> pd.DataFrame:
    """
    n_theft defaults to ~2% contamination, matching the IsolationForest
    contamination parameter in train.py - keep these in sync if you change
    either.
    """
    normal = generate_normal_samples(n_normal)
    theft = generate_theft_samples(n_theft)
    df = pd.concat([normal, theft], ignore_index=True)
    return df.sample(frac=1, random_state=42).reset_index(drop=True)
