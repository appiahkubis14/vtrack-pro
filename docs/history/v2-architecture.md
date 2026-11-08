# V-Track Pro v2.0 — Architecture & Design

This document covers the parts of the v2.0 upgrade that are **not** implemented
as running code in this repo, because they're genuinely separate services with
their own toolchains (Rust, Kafka, a trained ML model, a graph database,
OSRM/Valhalla). What *is* implemented in-repo — the Redis digital twin, EV
energy module, geofence hysteresis, multi-tracker sensor fusion, and the
command state machine + SMS fallback — is real, compiling NestJS code; see the
root README for where to find it. Everything below is a design you (or a
specialized team, or Claude Code working iteratively) can build from.

---

## 1. Executive Summary

v1.0 is a single NestJS monolith: TCP servers parse GPS packets in-process
and write straight to Postgres/TimescaleDB. That's fine up to a few hundred
devices. v2.0 restructures ingestion so it can scale to 10,000+ devices
without the API process being a bottleneck, adds first-class EV support,
makes geofencing and multi-device fleets production-realistic, and adds the
observability/security posture an enterprise deployment needs.

The core architectural change is **decoupling ingestion from business
logic**: a dedicated gateway (Rust, for performance and memory safety under
high connection counts) terminates device connections and normalizes
telemetry onto Kafka; the NestJS app becomes a set of Kafka consumers plus
the REST/WebSocket API, with Redis holding live per-vehicle state instead of
querying TimescaleDB on every dashboard refresh.

## 2. Assumptions

Ambiguous requirements were resolved as follows:

- **"10,000+ devices"** is read as sustained connections with position
  updates every 5-30s (not sub-second per device) — sub-second is for the
  *dashboard's* view of a moving vehicle (via WebSocket), not the device's
  actual report interval, which is a hardware/cost tradeoff most fleets set
  to 10-30s.
- **Kafka vs Redpanda**: designed Kafka-API-compatible so either works;
  Redpanda is the lower-ops-overhead choice for teams without existing Kafka
  expertise, same topic/consumer-group design applies.
- **Graph model**: treated as a read-optimization layer for relationship
  queries ("what's pulling this trailer", "what devices report to this
  vehicle"), not a replacement for Postgres as the source of truth — the
  relational schema stays authoritative; the graph is derived/synced.
  Apache AGE (Postgres extension) is recommended over standalone Neo4j to
  avoid a second database technology and keep transactional consistency
  with the rest of the schema.
- **V2G**: schema-only per the spec's explicit instruction; no discharge
  control logic implemented.
- **AI/ML "separate service"**: Python/FastAPI, because scikit-learn's
  ecosystem (feature engineering, model evaluation) is more mature there
  than TensorFlow.js/ONNX-in-Node for this kind of tabular anomaly
  detection — trading a second language for a much shorter path to a
  working model.
- **Map matching**: OSRM over Valhalla — simpler to self-host, has a mature
  Node.js client, and "match" service does exactly what's needed here
  without Valhalla's broader (unused) routing feature set.

## 3. V2.0 Architecture

```mermaid
flowchart TB
    subgraph Devices["GPS / IoT Devices"]
        GT06[GT06 Trackers]
        TK103[TK103 Trackers]
        TEL[Teltonika]
        OBD[OBD-II / CAN]
        MQTTD[MQTT JSON Devices]
    end

    subgraph Gateway["Ingestion Gateway (Rust + Tokio)"]
        TCP[TCP/UDP Listeners]
        MQTTIN[MQTT Bridge]
        WASM[WASM Protocol Parser Plugins]
        NORM[Telemetry Normalizer]
    end

    subgraph Backbone["Event Backbone (Kafka / Redpanda)"]
        TRAW[telemetry.raw]
        TNORM[telemetry.normalized]
        TPOS[telemetry.position]
        TEV[telemetry.ev]
        DEVST[device.status]
        CMDOUT[commands.outbound]
        CMDRESP[commands.responses]
    end

    subgraph App["NestJS Application (this repo)"]
        CONS[Kafka Consumers]
        TWIN[Digital Twin Service - Redis]
        FUSION[Sensor Fusion Service]
        API[REST API]
        WS[WebSocket Gateways]
        GEOF[Geofence Hysteresis Engine]
        CMD[Command State Machine]
    end

    subgraph Stores["Storage"]
        PG[(PostgreSQL + PostGIS)]
        TS[(TimescaleDB)]
        REDIS[(Redis - Digital Twin)]
        AGE[(Apache AGE - Graph)]
    end

    subgraph MLSvc["AI/ML Service (Python + FastAPI)"]
        FEAT[Feature Store]
        INFER[Real-time Inference]
        TRAIN[Batch Training]
    end

    subgraph GeoSvc["Map Matching (OSRM)"]
        MATCH[Match API]
    end

    subgraph Obs["Observability"]
        OTEL[OpenTelemetry Collector]
        PROM[Prometheus]
        GRAF[Grafana]
        LOKI[Loki]
    end

    GT06 & TK103 & TEL --> TCP
    OBD --> TCP
    MQTTD --> MQTTIN
    TCP --> WASM --> NORM
    MQTTIN --> NORM
    NORM --> TRAW
    NORM --> TNORM
    TNORM --> TPOS
    TNORM --> TEV

    TPOS & TEV & DEVST --> CONS
    CONS --> TWIN
    CONS --> FUSION
    FUSION --> TWIN
    TWIN --> REDIS
    TWIN --> WS
    CONS --> PG
    CONS --> TS
    CONS --> GEOF
    GEOF --> PG

    API --> CMD
    CMD --> CMDOUT
    CMDOUT --> Gateway
    Gateway --> CMDRESP
    CMDRESP --> CONS

    CONS --> FEAT --> TRAIN
    FEAT --> INFER
    API --> MATCH

    App --> AGE
    App --> OTEL --> PROM --> GRAF
    OTEL --> LOKI
```

## 4. Ingestion Layer

**A real, tested, running implementation exists in this repo** —
`vtrack-pro/ingestion-gateway/`. This environment has no docker and only an
old (apt-packaged, Cargo 1.75) Rust toolchain — modern crates.io metadata
now requires a Cargo new enough to support the `edition2024` feature, which
1.75 doesn't have, so the `tokio`/`redis`/`rdkafka` version shown as the
target design below couldn't actually be fetched and built here. Rather
than leave this as an unverified sketch, the actual gateway in this repo is
a **dependency-free, `std`-only Rust binary**: blocking TCP with one thread
per connection, a hand-rolled RESP client for Redis (just enough to issue
`XADD`), and the same GT06 CRC16/frame-parsing algorithm as
`backend/src/modules/devices/processors/gt06.processor.ts`, ported to Rust.

Verified end-to-end: 4/4 unit tests pass (CRC validation, ACK construction,
a login frame, and an exact-timestamp location frame test), and running the
compiled binary against a real TCP client sending a real GT06 frame produces
a correct ACK and a correctly-parsed telemetry record published to a live
Redis Stream (`XADD telemetry.normalized`) — confirmed by reading it back
with `redis-cli XRANGE`.

On a real deployment with a current Rust toolchain (via `rustup`, not the
OS package manager), swap the hand-rolled RESP client for the `redis` crate
(or the `rdkafka` producer, for real Kafka) — the parsing and connection-
handling logic doesn't need to change, only the publish call.

### Target architecture (for a current Rust toolchain)

```
GPS/IoT Devices -> TCP/UDP/MQTT -> Rust Ingestion Gateway
  -> WASM protocol parsers -> normalize to ParsedTelemetry
  -> Kafka producer -> telemetry.raw / telemetry.normalized
```

### Gateway skeleton (Rust + Tokio + rdkafka)

```toml
# Cargo.toml
[package]
name = "vtrack-ingestion-gateway"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1", features = ["full"] }
rdkafka = { version = "0.36", features = ["cmake-build"] }
wasmtime = "24"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
uuid = { version = "1", features = ["v4"] }
tracing = "0.1"
tracing-subscriber = "0.3"
opentelemetry = "0.24"
```

```rust
// src/main.rs
use std::sync::Arc;
use tokio::net::TcpListener;
use rdkafka::producer::{FutureProducer, FutureRecord};
use rdkafka::ClientConfig;

mod parsers;
mod telemetry;
mod wasm_host;

use parsers::ParserRegistry;
use telemetry::ParsedTelemetry;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();

    let producer: FutureProducer = ClientConfig::new()
        .set("bootstrap.servers", std::env::var("KAFKA_BROKERS")?)
        .set("message.timeout.ms", "5000")
        .create()?;

    let registry = Arc::new(ParserRegistry::load_from_dir("./parsers").await?);

    // One listener per protocol port, mirroring the v1 Node.js TCP servers
    // this replaces (devices/tcp/device-tcp.service.ts) but with a
    // work-stealing async runtime instead of one event loop per process.
    let ports = [("gt06", 5023), ("tk103", 5040), ("teltonika", 5050)];

    let mut handles = vec![];
    for (protocol, port) in ports {
        let producer = producer.clone();
        let registry = registry.clone();
        handles.push(tokio::spawn(async move {
            run_listener(protocol, port, producer, registry).await
        }));
    }

    futures::future::try_join_all(handles).await?;
    Ok(())
}

async fn run_listener(
    protocol: &'static str,
    port: u16,
    producer: FutureProducer,
    registry: Arc<ParserRegistry>,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!("[{protocol}] listening on {port}");

    loop {
        let (socket, addr) = listener.accept().await?;
        let producer = producer.clone();
        let registry = registry.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_connection(protocol, socket, addr, producer, registry).await {
                tracing::warn!("[{protocol}] connection from {addr} error: {e}");
            }
        });
    }
}

async fn handle_connection(
    protocol: &str,
    mut socket: tokio::net::TcpStream,
    addr: std::net::SocketAddr,
    producer: FutureProducer,
    registry: Arc<ParserRegistry>,
) -> anyhow::Result<()> {
    use tokio::io::AsyncReadExt;
    let mut buf = vec![0u8; 4096];

    loop {
        let n = socket.read(&mut buf).await?;
        if n == 0 {
            return Ok(()); // connection closed
        }

        let parser = registry.get(protocol)?;
        match parser.parse(&buf[..n]) {
            Ok(readings) => {
                for reading in readings {
                    let telemetry = ParsedTelemetry::from_reading(reading, protocol, addr);
                    let payload = serde_json::to_string(&telemetry)?;
                    producer
                        .send(
                            FutureRecord::to("telemetry.normalized")
                                .key(&telemetry.device_id)
                                .payload(&payload),
                            std::time::Duration::from_secs(0),
                        )
                        .await
                        .map_err(|(e, _)| e)?;
                }
                if let Some(ack) = parser.build_ack(&buf[..n]) {
                    use tokio::io::AsyncWriteExt;
                    socket.write_all(&ack).await?;
                }
            }
            Err(e) => {
                tracing::warn!("[{protocol}] parse error from {addr}: {e}");
                producer
                    .send(
                        FutureRecord::to("telemetry.raw")
                            .key(&addr.to_string())
                            .payload(&buf[..n]),
                        std::time::Duration::from_secs(0),
                    )
                    .await
                    .ok();
            }
        }
    }
}
```

**Fallback for smaller deployments** (transitional, not for 10,000+ devices):
Node.js `worker_threads`, one worker per protocol, pushing into Redis
Streams instead of Kafka. This is architecturally close to what
`devices/tcp/device-tcp.service.ts` already does in this repo today — the
migration path is: extract that file's logic into a worker thread, swap the
direct `PositionsService.ingest()` call for an `XADD` to a Redis Stream, and
add a consumer group that reads from the stream instead of receiving a
direct method call. Do this before jumping straight to Kafka+Rust if your
device count doesn't yet justify the operational complexity (see section 21,
Migration Plan).

## 5. WASM Protocol Parser Plugin Design

Goal: add a new device protocol without recompiling/redeploying the gateway.

```rust
// wasm_host/src/lib.rs - the plugin contract every protocol .wasm module implements
pub trait ProtocolParser {
    fn parse(input_ptr: i32, input_len: i32) -> i32;
    fn build_ack(input_ptr: i32, input_len: i32) -> i32; // 0 = no ack needed
    fn protocol_name() -> i32;
    fn parser_version() -> i32;
}
```

```rust
// Host-side loader (wasmtime)
use wasmtime::{Engine, Module, Store, Linker};

pub struct WasmParser {
    module: Module,
    engine: Engine,
}

impl WasmParser {
    pub fn load(path: &str) -> anyhow::Result<Self> {
        let engine = Engine::default();
        let module = Module::from_file(&engine, path)?;
        Ok(Self { module, engine })
    }

    pub fn parse(&self, frame: &[u8]) -> anyhow::Result<Vec<crate::telemetry::Reading>> {
        let mut store = Store::new(&self.engine, ());
        let linker = Linker::new(&self.engine);
        let instance = linker.instantiate(&mut store, &self.module)?;

        let memory = instance.get_memory(&mut store, "memory").unwrap();
        let input_ptr = self.write_to_wasm_memory(&mut store, &memory, frame)?;

        let parse_fn = instance.get_typed_func::<(i32, i32), i32>(&mut store, "parse")?;
        let result_ptr = parse_fn.call(&mut store, (input_ptr, frame.len() as i32))?;

        self.read_readings_from_wasm_memory(&mut store, &memory, result_ptr)
    }
}
```

```rust
// Example: a GT06 parser compiled to wasm32-unknown-unknown, same decoding
// algorithm as backend/src/modules/devices/processors/gt06.processor.ts
// in this repo, reimplemented in Rust for the wasm target.
#[no_mangle]
pub extern "C" fn parse(input_ptr: *const u8, input_len: usize) -> i32 {
    let frame = unsafe { std::slice::from_raw_parts(input_ptr, input_len) };
    match gt06_decode(frame) {
        Ok(readings) => write_readings_to_shared_memory(readings),
        Err(_) => -1,
    }
}
```

Operational model: parser `.wasm` binaries live in object storage (S3/GCS),
the gateway polls a manifest (protocol name -> version -> URL) and hot-loads
new/updated parsers without a restart. A parser panic is sandboxed inside
its wasm instance and can't crash the gateway process — the key safety
property that justifies the added complexity over dynamically-loaded native
plugins.

## 6. Kafka Topic Design

| Topic | Key | Partitions | Retention | Producers | Consumers |
|---|---|---|---|---|---|
| `telemetry.raw` | connection addr | 12 | 3 days | Gateway | Debug tooling, DLQ reprocessor |
| `telemetry.normalized` | device_id | 24 | 7 days | Gateway | Position/EV/fuel consumers |
| `telemetry.position` | device_id | 24 | 7 days | Normalizer consumer | Twin updater, TimescaleDB writer, Geofence engine |
| `telemetry.ev` | device_id | 12 | 7 days | Normalizer consumer | EV state writer, Twin updater |
| `telemetry.fuel` | device_id | 12 | 7 days | Normalizer consumer | Fuel theft detector |
| `telemetry.obd` | device_id | 12 | 7 days | Normalizer consumer | Fault code writer |
| `telemetry.can` | device_id | 12 | 3 days | Normalizer consumer | CAN message archiver |
| `device.status` | device_id | 12 | 30 days | Gateway (connect/disconnect) | Twin updater, alerting |
| `device.events` | device_id | 12 | 30 days | Gateway | Audit log |
| `commands.outbound` | device_id | 12 | 1 day | NestJS API | Gateway |
| `commands.responses` | command_id | 12 | 7 days | Gateway | Command state machine |
| `alerts.generated` | organization_id | 12 | 90 days | Alert engine | Notification dispatcher |
| `alerts.acknowledged` | organization_id | 12 | 90 days | API | Audit log |
| `alerts.resolved` | organization_id | 12 | 90 days | API | Audit log, reporting |
| `geofence.events` | device_id | 12 | 90 days | Geofence engine | Alert engine, twin updater |
| `trips.events` | vehicle_id | 12 | 90 days | Trip engine | Reporting, driver scoring |
| `notifications.outbound` | user_id | 12 | 7 days | Notification service | Channel dispatchers |
| `audit.events` | organization_id | 6 | 7 years (cold storage after 90d) | All services | Audit log writer |

**Partitioning strategy**: key by `device_id` (or `vehicle_id`/`organization_id`
where device_id isn't applicable) so all events for one device/vehicle land
on the same partition — this gives per-device ordering guarantees for free,
which the trip-detection and hysteresis logic depend on.

**Idempotency**: consumers key their writes by `(device_id, timestamp)` or
`message_id` with an upsert (`ON CONFLICT DO NOTHING`/`DO UPDATE`), so
at-least-once delivery plus a consumer crash-and-replay doesn't double-count
a position or double-fire an alert.

**Consumer groups**: one group per concern (`position-writer`,
`twin-updater`, `geofence-engine`, `fuel-theft-detector`, ...) reading the
same topics independently — this is what lets you scale each concern's
consumer count separately based on its own load, and is also why
`telemetry.position`/`telemetry.ev` are split from the single normalized
firehose rather than having every consumer filter one giant topic.

## 7-8. Digital Twin & Sensor Fusion

**Implemented in this repo** — see `backend/src/modules/twin/` and
`backend/src/modules/fusion/`. The Redis schema and NestJS service described
in the original v2 spec match `DigitalTwinService` and `DigitalTwinState`
exactly. In the Kafka-based architecture above, the `TwinUpdateListener` in
this repo (which currently listens to the in-process `position.created`
EventEmitter) becomes a Kafka consumer subscribed to `telemetry.position`
and `telemetry.ev` instead — same `patch()` logic, different trigger.

## 9. Graph Model

**A real, tested implementation exists in this repo** —
`backend/src/modules/fusion/graph/fleet-graph.engine.ts`, wired to real
relational data via `fleet-graph.service.ts` and exposed at
`GET /vehicles/:id/asset-chain`. This environment has no way to install the
Apache AGE Postgres extension (no docker, no extension-build toolchain), so
rather than leave the graph model as an unverified design, this is a real
in-memory adjacency-list graph with the same query surface AGE's Cypher
queries would provide — `vehiclesForOrganization()`, `devicesForVehicle()`,
`assetChain()`, and a general breadth-first `traverse()`. 8/8 unit tests
pass, including one that specifically verifies undirected multi-hop
traversal (asset -> trailer -> vehicle -> organization -> sibling vehicle).

Honest gap: `trailers` and `assets` tables don't exist in the relational
schema yet (migrations only cover what the spec's original SQL sketch
included), so `assetChain()` against real data currently returns an empty
trailer/assets list — the graph engine and query methods are real and
tested against synthetic data, but nothing populates trailer/asset nodes
from the database yet. Add those two tables plus the corresponding
`FleetGraphService.buildForVehicle()` population code to close that gap.

For production scale (thousands of vehicles, need for persistence and
transactional consistency with the rest of the schema), migrate to Apache
AGE once you have a Postgres instance you can install extensions on:

```sql
CREATE EXTENSION IF NOT EXISTS age;
LOAD 'age';
SELECT create_graph('fleet_graph');
```

```sql
-- Nodes are created (or synced from the relational tables via a periodic
-- job / trigger):
SELECT * FROM cypher('fleet_graph', $$
  CREATE (:Vehicle {id: 'uuid-here', plate: 'DEMO-001'})
$$) AS (v agtype);

-- Relationships:
SELECT * FROM cypher('fleet_graph', $$
  MATCH (o:Organization {id: 'org-uuid'}), (v:Vehicle {id: 'vehicle-uuid'})
  CREATE (o)-[:OWNS]->(v)
$$) AS (r agtype);
```

Example queries this unlocks that are awkward in pure SQL - the same
queries `FleetGraph.assetChain()` and `.devicesForVehicle()` implement
in-memory above:

```sql
-- "What's the full asset chain behind this alert?" (vehicle -> trailer -> cargo sensor)
SELECT * FROM cypher('fleet_graph', $$
  MATCH (veh:Vehicle {id: $vehicle_id})-[:PULLS]->(t:Trailer)-[:CONTAINS]->(a:Asset)
  RETURN veh, t, a
$$) AS (vehicle agtype, trailer agtype, asset agtype);

-- "Every device that has ever reported for this vehicle, across driver/trailer reassignments"
SELECT * FROM cypher('fleet_graph', $$
  MATCH (v:Vehicle {id: $vehicle_id})<-[:HAS_DEVICE]-(d:Device)-[:REPORTS]->(t:Telemetry)
  RETURN d, count(t) AS reading_count
$$) AS (device agtype, reading_count agtype);
```

Sync strategy: write-through from the relational tables (a TypeORM
subscriber on Vehicle/Device/Driver/Trailer create/update/delete emits an
event that a small sync service applies to the graph) rather than
dual-writing from every service — keeps the graph eventually consistent
without scattering Cypher calls through business logic. The in-memory
`FleetGraphService.buildForVehicle()` in this repo already follows this
"build from relational source of truth" pattern; migrating to AGE means
changing what it builds *into*, not how it decides what belongs in the
graph.

## 10. EV Energy Module

**Implemented in this repo** — see `backend/src/modules/energy/`. Schema,
charging session lifecycle, and the smart charging scheduler
(`engines/smart-charging.scheduler.ts`) are real, working TypeScript. The
algorithm is a greedy cheapest-hours-first scheduler; the module's file
header documents exactly where it falls short of a full LP/MILP solver
(multi-vehicle circuit contention) and what to swap in if you need that.

## 11. Geospatial Engine

### Map matching

**Implemented and tested in this repo** —
`backend/src/modules/trips/engines/map-matching.engine.ts`. This environment
has no docker/OSRM available, so rather than leave map matching as a design
doc, it's a real, dependency-free nearest-segment-projection matcher with
continuity smoothing, wired into `GET /trips/:id/snapped-route` and
`POST /geospatial/map-match`. 6/6 unit tests pass, including a case that
verifies an isolated bad snap gets discarded rather than creating a
zigzag in the route.

Explicitly **not** a full Hidden Markov Model matcher — no Viterbi decoding
over a routable graph, no road-connectivity-aware transition probabilities.
It cleans up GPS jitter and improves distance calculations noticeably, but
won't correctly disambiguate parallel roads or complex interchanges. For
that level of accuracy, run OSRM as a sidecar:

```bash
docker run -d -p 5001:5000 -v "${PWD}/osrm-data:/data" \
  osrm/osrm-backend osrm-routed --algorithm mld /data/region.osrm
```

```typescript
// Swap-in replacement for MapMatchingEngine.matchTrace() once OSRM is
// available - same call site in geospatial.controller.ts, different backend.
import { Injectable } from '@nestjs/common';

interface OsrmMatchResponse {
  matchings: Array<{
    confidence: number;
    geometry: { coordinates: [number, number][] };
    legs: unknown[];
  }>;
}

@Injectable()
export class OsrmMapMatchingService {
  private readonly osrmBaseUrl = process.env.OSRM_URL ?? 'http://osrm:5000';

  async matchTrace(points: Array<{ lat: number; lon: number; timestamp: Date }>) {
    const coords = points.map((p) => `${p.lon},${p.lat}`).join(';');
    const timestamps = points.map((p) => Math.floor(p.timestamp.getTime() / 1000)).join(';');
    const url = `${this.osrmBaseUrl}/match/v1/driving/${coords}?timestamps=${timestamps}&geometries=geojson`;

    const res = await fetch(url);
    const data = (await res.json()) as OsrmMatchResponse;

    return data.matchings.map((m) => ({
      confidence: m.confidence,
      snappedPoints: m.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    }));
  }
}
```

### Geofence hysteresis

**Implemented in this repo** — see
`backend/src/modules/geofences/engines/geofence-hysteresis.engine.ts`. Pure,
unit-testable function implementing entry/exit dwell, accuracy filtering,
buffer zones, and cooldown exactly per the spec's example configuration
shape.

## 12. Command & Control

**Implemented in this repo** — see `backend/src/modules/commands/`. Full
state machine (`engines/command-state-machine.ts`), approval workflow, and
SMS wake-up fallback (`engines/sms-wakeup.service.ts`) with BullMQ-driven
timeout detection.

## 13. AI/ML Pipeline

**A real, trained, running implementation exists in this repo** —
`vtrack-pro/ml-service/`. `train.py` generates synthetic training data
shaped like the `ml_features` table's `fuel_theft` feature set (no live
Postgres in this environment to pull real historical data from) and trains
an actual scikit-learn `IsolationForest` on it — running it produced a real
saved model artifact and this real output: *"Trained on 1632 samples,
flagged 9/408 (2.2%) of held-out set as anomalies."* `main.py` is a FastAPI
service that loads that model and serves real predictions — verified live:
a normal-driving scenario (slow fuel drop, daytime, known location) scored
0.45 and was correctly classified as not anomalous; a theft-like scenario
(9.5%/min fuel drop, stationary, 2am, unfamiliar location) scored 0.73 and
was correctly flagged, with the explanation field correctly identifying
`fuel_drop_rate` as the top contributing factor.

Scoped to the fuel-theft use case only, to keep the demonstration real
rather than spreading thin across four use cases with three of them faked.
EV battery anomaly detection, predictive maintenance, and driver risk
scoring follow the identical pattern — train an `IsolationForest` (or a
model better suited to each signal shape) on the corresponding feature set,
add a `models[...]` entry and a `/predict/...` endpoint — and are left as
the next incremental step rather than built out here.

### Architecture

```
Kafka (telemetry.position, telemetry.ev, telemetry.fuel)
  -> Feature extraction consumer -> ml_features table (Postgres)
  -> Batch training job (scheduled) -> model artifact -> S3/GCS
  -> FastAPI inference service (loads latest active model per use case)
  -> anomaly_events table (Postgres) -> NestJS AlertsService.raise()
```

### Service skeleton (Python + FastAPI + scikit-learn)

```python
# ml-service/main.py
from fastapi import FastAPI
from pydantic import BaseModel
import joblib
import numpy as np

app = FastAPI(title="V-Track ML Service")
models: dict[str, object] = {}

@app.on_event("startup")
def load_models():
    models["fuel_theft"] = joblib.load("models/fuel_theft_isolation_forest.pkl")
    models["ev_battery"] = joblib.load("models/ev_battery_autoencoder.pkl")

class FuelTheftFeatures(BaseModel):
    vehicle_id: str
    fuel_drop_rate_pct_per_min: float
    speed_kmh: float
    hour_of_day: int
    is_known_location: bool

class AnomalyResponse(BaseModel):
    vehicle_id: str
    score: float
    is_anomaly: bool
    explanation: dict

@app.post("/predict/fuel-theft", response_model=AnomalyResponse)
def predict_fuel_theft(features: FuelTheftFeatures):
    X = np.array([[
        features.fuel_drop_rate_pct_per_min,
        features.speed_kmh,
        features.hour_of_day,
        int(features.is_known_location),
    ]])
    model = models["fuel_theft"]
    raw_score = -model.score_samples(X)[0]
    is_anomaly = model.predict(X)[0] == -1

    return AnomalyResponse(
        vehicle_id=features.vehicle_id,
        score=float(raw_score),
        is_anomaly=bool(is_anomaly),
        explanation={
            "top_factor": "fuel_drop_rate" if features.fuel_drop_rate_pct_per_min > 5 else "unusual_time",
            "fuel_drop_rate_pct_per_min": features.fuel_drop_rate_pct_per_min,
        },
    )
```

```python
# ml-service/train.py - batch training, run on a schedule (weekly cron / Airflow DAG)
import pandas as pd
from sklearn.ensemble import IsolationForest
import joblib
from sqlalchemy import create_engine
import os

engine = create_engine(os.environ["DATABASE_URL"])

def train_fuel_theft_model():
    df = pd.read_sql(
        """
        SELECT features->>'fuel_drop_rate' AS fuel_drop_rate,
               features->>'speed' AS speed,
               features->>'hour' AS hour,
               features->>'is_known_location' AS is_known_location
        FROM ml_features
        WHERE feature_set = 'fuel_theft'
          AND computed_at > now() - interval '90 days'
        """,
        engine,
    ).astype(float)

    model = IsolationForest(contamination=0.02, random_state=42)
    model.fit(df.values)
    joblib.dump(model, f"models/fuel_theft_isolation_forest_{pd.Timestamp.now():%Y%m%d}.pkl")
    # Then: INSERT INTO anomaly_models (...) and flip is_active on the new version.
```

### NestJS integration

The `anomaly_events`, `anomaly_models`, and `ml_features` tables already
exist in this repo's schema (migration 014). `AnalyticsService` would call
the FastAPI service over HTTP, write results to `anomaly_events`, and call
the existing `AlertsService.raise()` for anything above a configured
threshold — reusing the alert pipeline rather than building a parallel one.

### False-positive feedback loop

`POST /api/anomalies/:id/feedback` (spec section 15) writes to
`anomaly_events.is_false_positive` / `reviewed_by` / `reviewed_at` — that
labeled data becomes the next training run's ground truth, closing the loop
between human review and model quality.

## 14-16. Database, API, WebSocket changes

**Implemented in this repo.** All new tables from the spec (section 14) are
in migrations 012-016. New EV/multi-tracker/command REST endpoints (section
15) are in `energy.controller.ts`, `fusion.controller.ts`,
`commands.controller.ts`. New WebSocket events (section 16) are emitted from
`digital-twin.gateway.ts` and `commands/gateways/commands.gateway.ts` —
`digitalTwinUpdate`, `evBatteryUpdate`, `chargingSessionStarted/Ended`,
`deviceOnline/Offline`, `deviceConflictDetected`, `commandStateChanged`. Not
yet emitted: `mapMatchedPositionUpdate` (waiting on section 11's OSRM
integration), `anomalyDetected`/`driverRiskScoreUpdated` (waiting on section
13's ML service), `tripStopDetected` (waiting on the trip_stops
classification logic — schema exists, classifier doesn't yet).

## 17. Security Upgrades

Beyond what v1 already has (JWT+refresh rotation, 2FA, RBAC, rate limiting,
audit logging):

- **Device authentication**: v1 identifies devices by IMEI alone, which is
  spoofable. Add a per-device shared secret (issued at registration,
  rotated via `POST /devices/:id/rotate-key`) that GT06/Teltonika's
  protocol-level auth fields (where supported) or an application-layer HMAC
  over each frame can validate. TK103's plaintext-ASCII protocol can't
  support this without a firmware change — flag TK103 devices as
  lower-trust in the fusion trust-level table (section 8) accordingly.
- **Replay protection**: reject frames with a timestamp older than the
  last-accepted frame for that device minus a small clock-skew allowance
  (~30s) — cheap and catches naive replay without needing a nonce scheme.
- **Command approval + MFA**: approval workflow is implemented
  (`commands/commands.service.ts`); MFA-for-critical-commands would hang a
  `POST /commands/:id/approve` TOTP check off the existing
  `AuthService.verify2fa()` rather than building a second 2FA system.
- **Tenant isolation**: currently enforced by application code filtering on
  `organization_id` in every query — add Postgres Row-Level Security
  policies as defense-in-depth so a missed `WHERE organization_id = ...` in
  a new endpoint can't leak cross-tenant data.
- **GDPR data deletion / export**: not implemented. Would be a
  `DataSubjectRequestService` walking every table with a `user_id` or
  `driver_id` FK (there are ~15) and either hard-deleting or anonymizing per
  a configurable retention policy — mechanical but tedious; budget real time
  for it rather than treating it as an afterthought.

## 18. Observability

### Key metrics (Prometheus)

| Metric | Source |
|---|---|
| `device_connections_active` | Ingestion gateway (or `DeviceTcpService` in the v1 fallback) |
| `messages_received_total` / `messages_parsed_total` / `messages_failed_total` | Ingestion gateway |
| `kafka_consumer_lag` | Kafka consumer group offsets (`kafka-exporter`) |
| `position_updates_processed_total` | `PositionsService.ingest()` |
| `websocket_clients_connected` | Socket.IO adapter (per gateway namespace) |
| `command_response_time_seconds` | command created_at -> acknowledged_at delta |
| `alert_processing_latency_seconds` | position.created event -> AlertsService.raise() delta |
| `redis_state_store_hit_rate` | `redis_exporter` against the digital twin keyspace |
| `database_query_duration_seconds` | `pg_stat_statements` via `postgres_exporter` |
| `ev_charging_sessions_total` | `ChargingSession` row count, labeled by status |
| `fuel_theft_alerts_total` | `AlertType.FUEL_THEFT` count |
| `map_matching_success_rate` | OSRM `match` response confidence distribution |

### Grafana dashboards (suggested panels)

1. **Fleet Overview**: active devices, online/offline ratio, messages/sec
2. **Ingestion Health**: parse success rate by protocol, Kafka consumer lag
   by group, gateway connection count by port
3. **Digital Twin**: Redis hit rate, twin update latency, stale-twin count
4. **Commands**: state funnel (queued -> sent -> acknowledged -> executed),
   SMS wake-up trigger rate, timeout rate by command type
5. **EV Fleet**: SoC distribution, active charging sessions, average
   kWh/100km trend
6. **Alerts**: volume by severity/type, mean time to acknowledge/resolve

OpenTelemetry: instrument the gateway (Rust `opentelemetry` crate) and
NestJS app (`@opentelemetry/sdk-node` + auto-instrumentations) with a shared
`trace_id` propagated from the device connection through Kafka message
headers into the consumer — this is what makes "why was this alert 4
seconds late" answerable instead of a guessing game across three services.

## 19. Testing Plan

**Unit**: protocol parsers (feed known byte sequences, assert parsed
output), `evaluateHysteresis()` (pure function - table-test entry/exit/
buffer/cooldown combinations), `SmartChargingScheduler.plan()` (assert
cheapest hours selected, deadline edge cases), `evaluateConditions()` (rule
engine), command state machine (`assertTransition` - every valid and
invalid pair).

**Integration**: Kafka consumers against a testcontainers Kafka instance;
Redis digital twin read/write/TTL against testcontainers Redis; command
lifecycle end-to-end against a test Postgres + mocked TCP device connection;
multi-tenant isolation (assert org A's query never returns org B's rows,
run against every list endpoint).

**E2E**: the 7 flows listed in the spec are exactly the right smoke tests —
a single Jest e2e suite that boots the app against docker-compose services,
opens a raw TCP socket, sends a real GT06 frame, and asserts the WebSocket
client receives the corresponding `digitalTwinUpdate`.

**Load** (k6): ramp connection count (1k -> 5k -> 10k) while holding
position-update rate constant per device, then separately test burst
reconnect (kill 20% of connections, measure gateway recovery time) and
WebSocket fan-out (1 device update broadcast to N dashboard clients in the
same org room). Budget real infrastructure for this — 10k simulated TCP
connections needs a k6 runner with enough file descriptors and network
throughput that it usually can't run on a laptop.

## 20. Docker & Kubernetes

Extending this repo's existing `docker-compose.yml` and
`infrastructure/kubernetes/`:

```yaml
# Additions to docker-compose.yml for local v2 development
  ingestion-gateway:
    build: ./ingestion-gateway
    ports: ["5023:5023", "5040:5040", "5050:5050"]
    environment:
      KAFKA_BROKERS: redpanda:9092
    depends_on: [redpanda]

  redpanda:
    image: redpandadata/redpanda:latest
    command: redpanda start --smp 1 --memory 1G --overprovisioned --node-id 0
    ports: ["9092:9092", "9644:9644"]

  osrm:
    image: osrm/osrm-backend
    volumes: ["./osrm-data:/data"]
    command: osrm-routed --algorithm mld /data/region.osrm
    ports: ["5001:5000"]

  ml-service:
    build: ./ml-service
    ports: ["8001:8000"]
    environment:
      DATABASE_URL: postgresql://vtrack:vtrack123@postgres:5432/vtrack

  otel-collector:
    image: otel/opentelemetry-collector:latest
    volumes: ["./docker/otel-collector-config.yaml:/etc/otel/config.yaml"]
    command: ["--config=/etc/otel/config.yaml"]
```

Kubernetes additions: a separate `Deployment` for `ingestion-gateway` (own
HPA target — scales on connection count, not CPU, via a custom metric), a
`Deployment` for `ml-service`, `StatefulSet` for Redpanda (or use a managed
Kafka/Redpanda Cloud offering instead of self-hosting), and a
`PodDisruptionBudget` on every deployment so a node drain can't take down
100% of any tier at once. The device TCP ports need to stay on the
`LoadBalancer` service pattern already in `service.yaml` — that doesn't
change, it just points at the gateway deployment instead of the app
deployment.

## 21. Migration Plan (v1 -> v2, minimal downtime)

1. **Phase 0 - additive schema**: run migrations 012-016 (already written,
   all additive — no v1 table is altered destructively) against production.
   Zero downtime, nothing reads the new tables yet.
2. **Phase 1 - digital twin, dark launch**: deploy `TwinModule`. It listens
   to the same `position.created` event v1 already emits — no gateway
   changes needed yet. Dashboards keep reading from TimescaleDB; twin data
   accumulates in the background for validation.
3. **Phase 2 - switch reads to the twin**: repoint the live-map/dashboard
   API calls to `GET /twin/fleet` instead of the old `/positions/latest`
   query. Roll back by repointing the same call if twin data looks wrong —
   the old endpoint keeps working throughout.
4. **Phase 3 - EV, fusion, hysteresis, command state machine**: these are
   additive modules/features with no v1 behavior removed (the old
   `/devices/:id/command` endpoint keeps working alongside the new
   `/commands` state-machine-backed one). Roll out module by module.
5. **Phase 4 - ingestion gateway, dark launch**: deploy the Rust gateway on
   new ports, pointed at a new Kafka topic, with zero real device traffic
   yet. Validate parsing against recorded v1 traffic (`raw_device_data`
   table already has months of real frames to replay).
6. **Phase 5 - gradual device cutover**: DNS/firmware-config changes point
   device batches (start with 1%, then 10%, then 50%) at the new gateway
   ports. Both v1's TCP servers and the new gateway run simultaneously
   during this window — this is why v1's `DeviceTcpService` should NOT be
   deleted until this phase completes. Monitor `messages_parsed_total` vs
   `messages_failed_total` per protocol before advancing each cohort.
7. **Phase 6 - decommission v1 ingestion**: once 100% of devices are on the
   new gateway and error rates are stable, remove
   `devices/tcp/device-tcp.service.ts` and the old TCP port bindings from
   the NestJS app.
8. **Phase 7 - Kafka consumers replace direct calls**: swap the
   `EventEmitter2`-based `position.created` listeners (twin, geofence
   engine, fuel theft detector, trip detector, alert processor — all
   already decoupled via events in this repo, which is exactly what makes
   this phase mechanical) for Kafka consumer equivalents, one at a time,
   each behind a feature flag that can fall back to the event-emitter path.

Each phase is independently reversible; nothing requires taking the API down.

## 22. Risks and Tradeoffs

- **Operational complexity jump**: v1 is "docker-compose up and you have a
  working system." v2's full architecture is Kafka + Rust + Python + a
  graph extension + OSRM — five additional technologies to operate, patch,
  and staff for. For fleets under ~500 devices, the Node.js
  worker-threads-and-Redis-Streams fallback (section 4) gets most of the
  scalability benefit at a fraction of the operational cost — don't adopt
  the full Kafka/Rust stack until device count or reliability requirements
  actually demand it.
- **Eventual consistency**: moving live-state reads to Redis means the
  digital twin can be briefly stale relative to Postgres (or vice versa,
  during the recovery-from-snapshot path). Acceptable for a live map;
  wrong to build billing or compliance logic against twin data directly —
  always source-of-truth those from Postgres/TimescaleDB.
- **WASM plugin sandbox has a cost**: hot-loading parsers without a
  redeploy is valuable but wasmtime instantiation overhead is real —
  benchmark against your actual frame rate before committing; a
  compile-time-linked parser registry (rebuild+redeploy on new protocols)
  is a legitimate simpler alternative if hot-swapping isn't actually needed
  day one.
- **ML model quality depends on data volume**: the anomaly detection
  service is only as good as its training data. Early on, with few labeled
  false-positive/true-positive examples, expect a high false-positive rate;
  budget for a human-review-heavy period before trusting model output to
  auto-resolve or auto-escalate anything.
- **Graph model duplication risk**: Apache AGE syncing from Postgres is
  eventually consistent by design (section 9) — if the sync job breaks
  silently, graph queries return stale relationships without any obvious
  error. Needs its own health check (compare row counts / last-sync
  timestamp) wired into the observability stack in section 18, not just
  "it'll show up in logs somewhere."
- **SMS wake-up cost at scale**: the rate limit in `sms-wakeup.service.ts`
  (5/device/day) is a starting guess, not a calibrated number — a fleet
  with poor cellular coverage could hit this constantly and either give up
  on offline commands or generate a real SMS bill. Monitor
  `sms_wakeup_logs` volume from day one.
