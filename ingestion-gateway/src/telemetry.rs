use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct Position {
    pub latitude: f64,
    pub longitude: f64,
    pub speed: Option<f64>,
    pub heading: Option<u16>,
    pub satellites: Option<u8>,
}

#[derive(Debug, Clone)]
pub struct VehicleState {
    pub ignition: bool,
    pub moving: bool,
    pub status: String,
}

#[derive(Debug, Clone)]
pub struct ParsedTelemetry {
    pub message_id: String,
    pub device_identifier: String,
    pub protocol: String,
    pub timestamp_unix: u64,
    pub received_at_unix: u64,
    pub position: Option<Position>,
    pub vehicle_state: Option<VehicleState>,
}

impl ParsedTelemetry {
    pub fn new(device_identifier: String, protocol: &str) -> Self {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        Self {
            message_id: format!("{:x}-{:x}", now, next_seq()),
            device_identifier,
            protocol: protocol.to_string(),
            timestamp_unix: now,
            received_at_unix: now,
            position: None,
            vehicle_state: None,
        }
    }

    /// Hand-rolled JSON encoding (no serde - see Cargo.toml for why). Fine
    /// for this fixed, known-shape struct; reach for serde_json in a real
    /// deployment with a current Rust toolchain.
    pub fn to_json(&self) -> String {
        let position_json = match &self.position {
            Some(p) => format!(
                r#"{{"latitude":{},"longitude":{},"speed":{},"heading":{},"satellites":{}}}"#,
                p.latitude,
                p.longitude,
                opt_num(p.speed),
                opt_num(p.heading.map(|h| h as f64)),
                opt_num(p.satellites.map(|s| s as f64)),
            ),
            None => "null".to_string(),
        };
        let vehicle_state_json = match &self.vehicle_state {
            Some(v) => format!(
                r#"{{"ignition":{},"moving":{},"status":"{}"}}"#,
                v.ignition, v.moving, v.status
            ),
            None => "null".to_string(),
        };

        format!(
            r#"{{"messageId":"{}","deviceIdentifier":"{}","protocol":"{}","timestamp":{},"receivedAt":{},"position":{},"vehicleState":{}}}"#,
            self.message_id,
            self.device_identifier,
            self.protocol,
            self.timestamp_unix,
            self.received_at_unix,
            position_json,
            vehicle_state_json,
        )
    }
}

fn opt_num(v: Option<f64>) -> String {
    match v {
        Some(n) => format!("{}", n),
        None => "null".to_string(),
    }
}

fn next_seq() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    SEQ.fetch_add(1, Ordering::Relaxed)
}
