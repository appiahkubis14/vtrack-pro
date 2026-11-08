use std::io::{Read, Write};
use std::net::TcpStream;

/// A deliberately minimal RESP (REdis Serialization Protocol) client.
/// Only implements what this gateway needs - encoding a command as a RESP
/// array of bulk strings, and reading back a reply. Production use should
/// switch to the `redis` crate on a current Rust toolchain (see this
/// directory's Cargo.toml for why this repo can't use it in this sandbox).
pub struct RespClient {
    stream: TcpStream,
}

impl RespClient {
    pub fn connect(addr: &str) -> std::io::Result<Self> {
        let stream = TcpStream::connect(addr)?;
        Ok(Self { stream })
    }

    pub fn command(&mut self, args: &[&str]) -> std::io::Result<String> {
        let mut encoded = format!("*{}\r\n", args.len());
        for arg in args {
            encoded.push_str(&format!("${}\r\n{}\r\n", arg.len(), arg));
        }
        self.stream.write_all(encoded.as_bytes())?;

        let mut buf = vec![0u8; 4096];
        let n = self.stream.read(&mut buf)?;
        Ok(String::from_utf8_lossy(&buf[..n]).trim_end().to_string())
    }
}
