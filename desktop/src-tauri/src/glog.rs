// glog.rs — Decoder + JSON writer for the Gnosis Log binary format.
//
// The addon writes encounter tables as .glog binary files (see
// Gnosis/libs/glog.lua for the format spec — they must stay in sync). This
// module is the consumer: read the .glog, decode to a serde_json::Value,
// pretty-write the matching .json file, and delete the .glog when done.
//
// Wire format v1: see libs/glog.lua. Type tags:
//   0x00 nil   0x01 false  0x02 true   0x03 int32  0x04 double
//   0x05 string (u32 LE len + bytes)
//   0x06 array  (u32 LE count + N values)
//   0x07 map    (u32 LE count + N (bare-string key, value) pairs)

use std::fs;
use std::path::Path;

#[derive(Debug)]
pub enum DecodeError {
    Io(std::io::Error),
    BadMagic,
    BadVersion(u8),
    Truncated,
    BadTag(u8),
    BadUtf8,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DecodeError::Io(e) => write!(f, "io error: {}", e),
            DecodeError::BadMagic => write!(f, "not a glog file (missing magic)"),
            DecodeError::BadVersion(v) => write!(f, "unsupported glog version: {}", v),
            DecodeError::Truncated => write!(f, "truncated glog file"),
            DecodeError::BadTag(t) => write!(f, "unknown type tag: 0x{:02x}", t),
            DecodeError::BadUtf8 => write!(f, "invalid utf-8 string"),
        }
    }
}

impl From<std::io::Error> for DecodeError {
    fn from(e: std::io::Error) -> Self { DecodeError::Io(e) }
}

struct Reader<'a> {
    buf: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    fn new(buf: &'a [u8]) -> Self { Self { buf, pos: 0 } }

    fn read_bytes(&mut self, n: usize) -> Result<&'a [u8], DecodeError> {
        if self.pos + n > self.buf.len() { return Err(DecodeError::Truncated); }
        let s = &self.buf[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }

    fn read_u8(&mut self) -> Result<u8, DecodeError> {
        Ok(self.read_bytes(1)?[0])
    }

    fn read_u32_le(&mut self) -> Result<u32, DecodeError> {
        let b = self.read_bytes(4)?;
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_i32_le(&mut self) -> Result<i32, DecodeError> {
        let b = self.read_bytes(4)?;
        Ok(i32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    fn read_f64_le(&mut self) -> Result<f64, DecodeError> {
        let b = self.read_bytes(8)?;
        Ok(f64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]]))
    }

    fn read_string(&mut self) -> Result<String, DecodeError> {
        let len = self.read_u32_le()? as usize;
        let bytes = self.read_bytes(len)?;
        std::str::from_utf8(bytes).map(|s| s.to_owned()).map_err(|_| DecodeError::BadUtf8)
    }
}

const MAX_DEPTH: usize = 64;

fn decode_value(r: &mut Reader, depth: usize) -> Result<serde_json::Value, DecodeError> {
    if depth > MAX_DEPTH { return Err(DecodeError::Truncated); }
    let tag = r.read_u8()?;
    match tag {
        0x00 => Ok(serde_json::Value::Null),
        0x01 => Ok(serde_json::Value::Bool(false)),
        0x02 => Ok(serde_json::Value::Bool(true)),
        0x03 => Ok(serde_json::Value::from(r.read_i32_le()?)),
        0x04 => {
            let n = r.read_f64_le()?;
            // serde_json rejects NaN / inf; coerce to null to match JSON semantics.
            Ok(serde_json::Number::from_f64(n)
                .map(serde_json::Value::Number)
                .unwrap_or(serde_json::Value::Null))
        }
        0x05 => Ok(serde_json::Value::String(r.read_string()?)),
        0x06 => {
            let n = r.read_u32_le()? as usize;
            let mut arr = Vec::with_capacity(n);
            for _ in 0..n {
                arr.push(decode_value(r, depth + 1)?);
            }
            Ok(serde_json::Value::Array(arr))
        }
        0x07 => {
            let n = r.read_u32_le()? as usize;
            let mut obj = serde_json::Map::with_capacity(n);
            for _ in 0..n {
                let k = r.read_string()?;
                let v = decode_value(r, depth + 1)?;
                obj.insert(k, v);
            }
            Ok(serde_json::Value::Object(obj))
        }
        t => Err(DecodeError::BadTag(t)),
    }
}

pub fn decode(buf: &[u8]) -> Result<serde_json::Value, DecodeError> {
    if buf.len() < 5 || &buf[..4] != b"glog" { return Err(DecodeError::BadMagic); }
    let version = buf[4];
    if version != 1 { return Err(DecodeError::BadVersion(version)); }
    let mut r = Reader::new(&buf[5..]);
    decode_value(&mut r, 0)
}

// Read a .glog file, decode, write the equivalent .json next to it, delete
// the .glog on success. The .json path is derived by replacing the .glog
// suffix; if the input doesn't end in .glog, append .json instead.
pub fn process_file(glog_path: &Path) -> Result<String, String> {
    let bytes = fs::read(glog_path).map_err(|e| format!("read {}: {}", glog_path.display(), e))?;
    let value = decode(&bytes).map_err(|e| format!("decode {}: {}", glog_path.display(), e))?;
    let json_path = if glog_path.extension().and_then(|s| s.to_str()) == Some("glog") {
        glog_path.with_extension("json")
    } else {
        let mut p = glog_path.as_os_str().to_owned();
        p.push(".json");
        p.into()
    };
    let text = serde_json::to_string(&value)
        .map_err(|e| format!("encode json: {}", e))?;
    fs::write(&json_path, text).map_err(|e| format!("write {}: {}", json_path.display(), e))?;
    // Best-effort delete of the .glog; if it fails the next refresh's scan
    // will pick it up and re-process (output overwrites).
    let _ = fs::remove_file(glog_path);
    Ok(json_path.to_string_lossy().into_owned())
}
