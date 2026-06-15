use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

pub struct DbState(pub Mutex<Option<Db>>);

pub struct Db {
    pub path: PathBuf,
    pub conn: Connection,
}

impl Db {
    fn migrate(&self) -> rusqlite::Result<()> {
        self.conn.execute_batch(
            r#"
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = MEMORY;
            PRAGMA cache_size = -8192;

            CREATE TABLE IF NOT EXISTS meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS summaries (
                path TEXT PRIMARY KEY,
                ts   INTEGER NOT NULL,
                kind TEXT NOT NULL,
                zone TEXT,
                json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_summaries_ts   ON summaries(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_summaries_kind ON summaries(kind);
            CREATE INDEX IF NOT EXISTS idx_summaries_zone ON summaries(zone);

            CREATE TABLE IF NOT EXISTS loots (
                path TEXT PRIMARY KEY,
                ts   INTEGER NOT NULL,
                json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_loots_ts ON loots(ts DESC);
            "#,
        )
    }
}

fn open_for_dir(data_dir: &str) -> rusqlite::Result<Db> {
    let mut p = PathBuf::from(data_dir);
    let _ = std::fs::create_dir_all(&p);
    p.push("gnosis_index.db");
    let conn = Connection::open(&p)?;
    let db = Db { path: p, conn };
    db.migrate()?;
    Ok(db)
}

fn with_db<R>(state: &DbState, data_dir: &str, f: impl FnOnce(&Db) -> rusqlite::Result<R>) -> Result<R, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let needs_open = match guard.as_ref() {
        Some(db) => db.path.parent().map(|p| p.to_string_lossy().to_string())
            != Some(data_dir.trim_end_matches(|c: char| c == '/' || c == '\\').to_string()),
        None => true,
    };
    if needs_open {
        *guard = Some(open_for_dir(data_dir).map_err(|e| e.to_string())?);
    }
    let db = guard.as_ref().ok_or_else(|| "db not initialized".to_string())?;
    f(db).map_err(|e| e.to_string())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SummaryRow {
    pub path: String,
    pub ts: i64,
    pub kind: String,
    pub zone: Option<String>,
    pub json: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct LootRow {
    pub path: String,
    pub ts: i64,
    pub json: String,
}

#[tauri::command]
pub fn db_open(state: tauri::State<DbState>, dir: String) -> Result<(), String> {
    with_db(&state, &dir, |_| Ok(()))
}

#[tauri::command]
pub fn db_get_summaries(state: tauri::State<DbState>, dir: String, paths: Vec<String>) -> Result<Vec<SummaryRow>, String> {
    if paths.is_empty() { return Ok(vec![]); }
    with_db(&state, &dir, |db| {
        let mut out: Vec<SummaryRow> = Vec::with_capacity(paths.len());
        for chunk in paths.chunks(400) {
            let placeholders = std::iter::repeat("?").take(chunk.len()).collect::<Vec<_>>().join(",");
            let sql = format!("SELECT path, ts, kind, zone, json FROM summaries WHERE path IN ({})", placeholders);
            let mut stmt = db.conn.prepare(&sql)?;
            let bind: Vec<&dyn rusqlite::ToSql> = chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            let rows = stmt.query_map(bind.as_slice(), |r| Ok(SummaryRow {
                path: r.get(0)?,
                ts: r.get(1)?,
                kind: r.get(2)?,
                zone: r.get(3)?,
                json: r.get(4)?,
            }))?;
            for row in rows { out.push(row?); }
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_get_loots(state: tauri::State<DbState>, dir: String, paths: Vec<String>) -> Result<Vec<LootRow>, String> {
    if paths.is_empty() { return Ok(vec![]); }
    with_db(&state, &dir, |db| {
        let mut out: Vec<LootRow> = Vec::with_capacity(paths.len());
        for chunk in paths.chunks(400) {
            let placeholders = std::iter::repeat("?").take(chunk.len()).collect::<Vec<_>>().join(",");
            let sql = format!("SELECT path, ts, json FROM loots WHERE path IN ({})", placeholders);
            let mut stmt = db.conn.prepare(&sql)?;
            let bind: Vec<&dyn rusqlite::ToSql> = chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
            let rows = stmt.query_map(bind.as_slice(), |r| Ok(LootRow {
                path: r.get(0)?,
                ts: r.get(1)?,
                json: r.get(2)?,
            }))?;
            for row in rows { out.push(row?); }
        }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_list_known_paths(state: tauri::State<DbState>, dir: String) -> Result<Vec<String>, String> {
    with_db(&state, &dir, |db| {
        let mut stmt = db.conn.prepare("SELECT path FROM summaries")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for row in rows { out.push(row?); }
        Ok(out)
    })
}

#[tauri::command]
pub fn db_put_summary(state: tauri::State<DbState>, dir: String, row: SummaryRow) -> Result<(), String> {
    with_db(&state, &dir, |db| {
        db.conn.execute(
            "INSERT INTO summaries (path, ts, kind, zone, json) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(path) DO UPDATE SET ts=excluded.ts, kind=excluded.kind, zone=excluded.zone, json=excluded.json",
            params![row.path, row.ts, row.kind, row.zone, row.json],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_put_summaries(state: tauri::State<DbState>, dir: String, rows: Vec<SummaryRow>) -> Result<(), String> {
    if rows.is_empty() { return Ok(()); }
    with_db(&state, &dir, |db| {
        let tx = db.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO summaries (path, ts, kind, zone, json) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(path) DO UPDATE SET ts=excluded.ts, kind=excluded.kind, zone=excluded.zone, json=excluded.json",
            )?;
            for r in &rows {
                stmt.execute(params![r.path, r.ts, r.kind, r.zone, r.json])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_put_loot(state: tauri::State<DbState>, dir: String, row: LootRow) -> Result<(), String> {
    with_db(&state, &dir, |db| {
        db.conn.execute(
            "INSERT INTO loots (path, ts, json) VALUES (?1, ?2, ?3)
             ON CONFLICT(path) DO UPDATE SET ts=excluded.ts, json=excluded.json",
            params![row.path, row.ts, row.json],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_put_loots(state: tauri::State<DbState>, dir: String, rows: Vec<LootRow>) -> Result<(), String> {
    if rows.is_empty() { return Ok(()); }
    with_db(&state, &dir, |db| {
        let tx = db.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO loots (path, ts, json) VALUES (?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET ts=excluded.ts, json=excluded.json",
            )?;
            for r in &rows {
                stmt.execute(params![r.path, r.ts, r.json])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_delete_paths(state: tauri::State<DbState>, dir: String, paths: Vec<String>) -> Result<(), String> {
    if paths.is_empty() { return Ok(()); }
    with_db(&state, &dir, |db| {
        let tx = db.conn.unchecked_transaction()?;
        {
            let mut s_stmt = tx.prepare("DELETE FROM summaries WHERE path = ?1")?;
            let mut l_stmt = tx.prepare("DELETE FROM loots WHERE path = ?1")?;
            for p in &paths {
                s_stmt.execute(params![p])?;
                l_stmt.execute(params![p])?;
            }
        }
        tx.commit()?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_meta_get(state: tauri::State<DbState>, dir: String, key: String) -> Result<Option<String>, String> {
    with_db(&state, &dir, |db| {
        db.conn.query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| r.get::<_, String>(0)).optional()
    })
}

#[tauri::command]
pub fn db_meta_set(state: tauri::State<DbState>, dir: String, key: String, value: String) -> Result<(), String> {
    with_db(&state, &dir, |db| {
        db.conn.execute(
            "INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    })
}

#[tauri::command]
pub fn db_count_summaries(state: tauri::State<DbState>, dir: String) -> Result<i64, String> {
    with_db(&state, &dir, |db| {
        db.conn.query_row("SELECT COUNT(*) FROM summaries", [], |r| r.get::<_, i64>(0))
    })
}
