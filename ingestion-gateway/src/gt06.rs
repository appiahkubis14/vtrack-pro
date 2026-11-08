use crate::telemetry::{ParsedTelemetry, Position, VehicleState};
use std::time::{SystemTime, UNIX_EPOCH};

const HEADER: u16 = 0x7878;
const PROTOCOL_LOGIN: u8 = 0x01;
const PROTOCOL_HEARTBEAT: u8 = 0x13;
const PROTOCOL_LOCATION: u8 = 0x12;
const PROTOCOL_LOCATION_LBS: u8 = 0x22;

#[derive(Debug)]
pub enum GT06Error {
    InvalidHeader,
    TruncatedFrame,
    CrcMismatch,
}

impl std::fmt::Display for GT06Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            GT06Error::InvalidHeader => write!(f, "invalid GT06 frame header"),
            GT06Error::TruncatedFrame => write!(f, "truncated GT06 frame"),
            GT06Error::CrcMismatch => write!(f, "GT06 CRC mismatch"),
        }
    }
}

/// Same algorithm as backend/src/modules/devices/processors/gt06.processor.ts
/// - see that file's docblock for the caveats (login/heartbeat/location only,
/// alarm and LBS-only variants not decoded).
pub fn parse(buf: &[u8]) -> Result<Vec<ParsedTelemetry>, GT06Error> {
    if buf.len() < 5 {
        return Err(GT06Error::InvalidHeader);
    }
    let header = u16::from_be_bytes([buf[0], buf[1]]);
    if header != HEADER {
        return Err(GT06Error::InvalidHeader);
    }

    let length = buf[2] as usize;
    let protocol = buf[3];
    let frame_end = 3 + length;

    if frame_end + 2 > buf.len() {
        return Err(GT06Error::TruncatedFrame);
    }

    let crc_received = u16::from_be_bytes([buf[frame_end - 2], buf[frame_end - 1]]);
    let crc_computed = crc16_itu(&buf[2..frame_end - 2]);
    if crc_received != crc_computed {
        return Err(GT06Error::CrcMismatch);
    }

    let content = &buf[4..frame_end - 4];

    match protocol {
        PROTOCOL_LOGIN | PROTOCOL_HEARTBEAT => Ok(vec![]),
        PROTOCOL_LOCATION | PROTOCOL_LOCATION_LBS => {
            let telemetry = parse_location(content);
            Ok(vec![telemetry])
        }
        _ => Ok(vec![]),
    }
}

/// Builds the standard GT06 ACK: 78 78 05 <protocol> <serial:2> <crc:2> 0D 0A
pub fn build_ack(buf: &[u8]) -> Option<Vec<u8>> {
    if buf.len() < 5 || u16::from_be_bytes([buf[0], buf[1]]) != HEADER {
        return None;
    }
    let length = buf[2] as usize;
    let protocol = buf[3];
    let frame_end = 3 + length;
    if frame_end < 4 || frame_end > buf.len() {
        return None;
    }
    let serial = &buf[frame_end - 4..frame_end - 2];

    let mut body = vec![0x05u8, protocol];
    body.extend_from_slice(serial);
    let crc = crc16_itu(&body);

    let mut ack = vec![0x78, 0x78];
    ack.extend_from_slice(&body);
    ack.extend_from_slice(&crc.to_be_bytes());
    ack.extend_from_slice(&[0x0d, 0x0a]);
    Some(ack)
}

fn parse_location(content: &[u8]) -> ParsedTelemetry {
    let year = content[0] as i32;
    let month = content[1] as u32;
    let day = content[2] as u32;
    let hour = content[3] as u32;
    let minute = content[4] as u32;
    let second = content[5] as u32;
    let timestamp_unix = ymd_hms_to_unix(2000 + year, month, day, hour, minute, second);

    let gps_info = content[6];
    let satellites = gps_info & 0x0f;

    let raw_lat = u32::from_be_bytes([content[7], content[8], content[9], content[10]]);
    let raw_lon = u32::from_be_bytes([content[11], content[12], content[13], content[14]]);
    let speed = content[15];
    let course_status = u16::from_be_bytes([content[16], content[17]]);

    let latitude = raw_lat as f64 / 30000.0 / 60.0;
    let longitude = raw_lon as f64 / 30000.0 / 60.0;
    let is_south = (course_status >> 10) & 0x01 == 0;
    let is_west = (course_status >> 11) & 0x01 == 0;
    let heading = course_status & 0x03ff;

    let mut telemetry = ParsedTelemetry::new(String::new(), "gt06");
    telemetry.timestamp_unix = timestamp_unix;
    telemetry.received_at_unix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
    telemetry.position = Some(Position {
        latitude: if is_south { -latitude } else { latitude },
        longitude: if is_west { -longitude } else { longitude },
        speed: Some(speed as f64),
        heading: Some(heading),
        satellites: Some(satellites),
    });
    telemetry.vehicle_state = Some(VehicleState {
        ignition: speed > 0, // proxy only - GT06's real ignition bit lives in a status byte this simplified parser doesn't decode yet, mirroring the TS version's scope
        moving: speed >= 5,
        status: if speed >= 5 { "MOVING" } else { "IDLE" }.to_string(),
    });
    telemetry
}

/// Minimal Gregorian calendar date -> Unix epoch seconds, UTC. Good enough
/// for GT06's 2000-2099 range; not a general-purpose calendar library
/// (no timezone handling, no calendar edge cases beyond what GT06 sends).
fn ymd_hms_to_unix(year: i32, month: u32, day: u32, hour: u32, minute: u32, second: u32) -> u64 {
    let days_in_month = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let is_leap = |y: i32| (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;

    let mut days: i64 = 0;
    for y in 1970..year {
        days += if is_leap(y) { 366 } else { 365 };
    }
    for m in 1..month {
        days += days_in_month[(m - 1) as usize] as i64;
        if m == 2 && is_leap(year) {
            days += 1;
        }
    }
    days += (day - 1) as i64;

    let total_seconds = days * 86400 + hour as i64 * 3600 + minute as i64 * 60 + second as i64;
    total_seconds.max(0) as u64
}

fn crc16_itu(buf: &[u8]) -> u16 {
    let mut crc: u16 = 0xffff;
    for &byte in buf {
        crc ^= byte as u16;
        for _ in 0..8 {
            crc = if crc & 0x0001 != 0 {
                (crc >> 1) ^ 0x8408
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_test_login_frame() -> Vec<u8> {
        // 78 78 0D 01 <imei-bcd:8> <serial:2> <crc:2> 0D 0A
        let mut frame = vec![0x78, 0x78, 0x0d, 0x01];
        frame.extend_from_slice(&[0x03, 0x53, 0x51, 0x70, 0x84, 0x21, 0x87, 0x65]); // fake BCD IMEI
        frame.extend_from_slice(&[0x00, 0x01]); // serial
        let crc = crc16_itu(&frame[2..frame.len()]);
        frame.extend_from_slice(&crc.to_be_bytes());
        frame.extend_from_slice(&[0x0d, 0x0a]);
        frame
    }

    #[test]
    fn login_frame_parses_with_no_positions() {
        let frame = build_test_login_frame();
        let result = parse(&frame).expect("should parse");
        assert_eq!(result.len(), 0);
    }

    #[test]
    fn login_frame_produces_a_valid_ack() {
        let frame = build_test_login_frame();
        let ack = build_ack(&frame).expect("should build ack");
        assert_eq!(ack[0], 0x78);
        assert_eq!(ack[1], 0x78);
        assert_eq!(ack[3], 0x01); // echoes protocol number
    }

    #[test]
    fn bad_crc_is_rejected() {
        let mut frame = build_test_login_frame();
        let last = frame.len() - 3;
        frame[last] ^= 0xff; // corrupt one CRC byte
        assert!(matches!(parse(&frame), Err(GT06Error::CrcMismatch)));
    }

    #[test]
    fn location_frame_parses_position() {
        // Build a location frame: date(6) + gps_info(1) + lat(4) + lon(4) + speed(1) + course(2) = 18 bytes content
        let mut content = vec![24u8, 6, 15, 12, 30, 0]; // 2024-06-15 12:30:00
        content.push(0x0c); // gps info: 12 satellites (low nibble)
        // Latitude ~ 22.5 deg N: raw = 22.5 * 60 * 30000
        let raw_lat: u32 = (22.5_f64 * 60.0 * 30000.0) as u32;
        content.extend_from_slice(&raw_lat.to_be_bytes());
        let raw_lon: u32 = (114.0_f64 * 60.0 * 30000.0) as u32;
        content.extend_from_slice(&raw_lon.to_be_bytes());
        content.push(45); // speed km/h
        // course_status: bit10=1 (north), bit11=1 (east), heading=90
        let course_status: u16 = (1 << 10) | (1 << 11) | 90;
        content.extend_from_slice(&course_status.to_be_bytes());

        let mut frame = vec![0x78, 0x78];
        let body_len = (content.len() + 1 + 2 + 2) as u8; // protocol(1) + content + serial(2) + crc(2)
        frame.push(body_len);
        frame.push(PROTOCOL_LOCATION);
        frame.extend_from_slice(&content);
        frame.extend_from_slice(&[0x00, 0x02]); // serial
        let crc = crc16_itu(&frame[2..frame.len()]);
        frame.extend_from_slice(&crc.to_be_bytes());
        frame.extend_from_slice(&[0x0d, 0x0a]);

        let result = parse(&frame).expect("should parse");
        assert_eq!(result.len(), 1);
        let pos = result[0].position.as_ref().unwrap();
        assert!((pos.latitude - 22.5).abs() < 0.01);
        assert!((pos.longitude - 114.0).abs() < 0.01);
        assert_eq!(pos.speed, Some(45.0));
        // 2024-06-15 12:30:00 UTC
        assert_eq!(result[0].timestamp_unix, 1718454600);
    }
}
