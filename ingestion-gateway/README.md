# V-Track Ingestion Gateway

A real, tested, `std`-only Rust TCP gateway that parses GT06 frames and
publishes them to a Redis Stream. See `docs/v2-architecture.md` section 4 in
the repo root for the full design context and why this is dependency-free
rather than using the `tokio`/`redis`/`rdkafka` stack the target
architecture calls for.

## Build & test

```bash
cargo test              # runs the 4 unit tests (CRC, ACK, login frame, location frame)
cargo build --release
```

## Run

Needs a Redis instance reachable at `REDIS_ADDR` (default `127.0.0.1:6379`):

```bash
REDIS_ADDR=127.0.0.1:6379 GT06_PORT=5023 ./target/release/vtrack-gateway
```

Verify it's working by publishing a real GT06 frame and reading it back:

```bash
redis-cli XRANGE telemetry.normalized - +
```

## Why no external crates

This was built and tested in a sandbox with only an apt-packaged Rust
toolchain (Cargo 1.75). Current crates.io index metadata — even for
several-years-old versions of `redis`/`url`/`idna` — now requires a Cargo
new enough to support the `edition2024` feature (stabilized in Rust 1.85),
so `cargo build` couldn't resolve dependencies at all, regardless of which
versions were pinned in `Cargo.toml`.

**This is a toolchain limitation of that sandbox, not a limitation of the
approach.** On a real machine with a current Rust toolchain (install via
[rustup](https://rustup.rs), not your OS package manager), add back:

```toml
[dependencies]
tokio = { version = "1", features = ["full"] }
redis = { version = "0.25", features = ["tokio-comp"] }
rdkafka = { version = "0.36", features = ["cmake-build"] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

and swap `resp_client.rs`'s hand-rolled RESP client for the `redis` crate
(or an `rdkafka` producer, to go to real Kafka instead of Redis Streams) —
the TCP handling and GT06 parsing logic in `gt06.rs` doesn't need to change,
only the publish call in `main.rs`.

## What's next

- Port TK103 and Teltonika parsers from the NestJS backend's TypeScript
  versions the same way GT06 was ported here.
- Add the WASM plugin loader described in `docs/v2-architecture.md` section
  5, once a current toolchain with `wasmtime` and the `wasm32-unknown-unknown`
  target is available.
- Add OpenTelemetry tracing so a `trace_id` can be threaded from the device
  connection through to the NestJS consumer that eventually processes this
  telemetry.
