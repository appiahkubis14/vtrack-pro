mod gt06;
mod resp_client;
mod telemetry;

use resp_client::RespClient;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread;

const STREAM_NAME: &str = "telemetry.normalized";

fn main() -> std::io::Result<()> {
    let redis_addr = std::env::var("REDIS_ADDR").unwrap_or_else(|_| "127.0.0.1:6379".into());
    let port: u16 = std::env::var("GT06_PORT")
        .unwrap_or_else(|_| "5023".into())
        .parse()
        .unwrap_or(5023);

    println!("[gateway] target Redis address: {redis_addr}");
    let listener = TcpListener::bind(("0.0.0.0", port))?;
    println!("[gateway] [gt06] listening on TCP {port}, publishing to Redis stream '{STREAM_NAME}'");

    for incoming in listener.incoming() {
        let socket = match incoming {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[gateway] accept error: {e}");
                continue;
            }
        };
        let redis_addr = redis_addr.clone();
        thread::spawn(move || {
            if let Err(e) = handle_connection(socket, &redis_addr) {
                eprintln!("[gateway] connection error: {e}");
            }
        });
    }

    Ok(())
}

fn handle_connection(mut socket: TcpStream, redis_addr: &str) -> std::io::Result<()> {
    let peer = socket.peer_addr()?;
    println!("[gateway] [gt06] connection from {peer}");

    let mut redis = RespClient::connect(redis_addr)?;
    let mut buf = vec![0u8; 4096];

    loop {
        let n = socket.read(&mut buf)?;
        if n == 0 {
            println!("[gateway] [gt06] {peer} disconnected");
            return Ok(());
        }
        let frame = &buf[..n];

        match gt06::parse(frame) {
            Ok(readings) => {
                for reading in readings {
                    let payload = reading.to_json();
                    match redis.command(&["XADD", STREAM_NAME, "*", "payload", &payload]) {
                        Ok(reply) => println!("[gateway] [gt06] published telemetry -> {reply}"),
                        Err(e) => eprintln!("[gateway] [gt06] Redis XADD failed: {e}"),
                    }
                }
                if let Some(ack) = gt06::build_ack(frame) {
                    socket.write_all(&ack)?;
                }
            }
            Err(e) => {
                eprintln!("[gateway] [gt06] parse error from {peer}: {e}");
                let hex_payload = frame.iter().map(|b| format!("{:02x}", b)).collect::<String>();
                let _ = redis.command(&["XADD", "telemetry.raw", "*", "raw_hex", &hex_payload]);
            }
        }
    }
}
