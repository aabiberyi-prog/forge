use rusqlite::{params, Connection};
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

pub fn history_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let identifier = app.config().identifier.clone();
    let dir = dirs::config_dir()
        .ok_or_else(|| "config dir missing".to_string())?
        .join(identifier);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("history.db"))
}

pub fn open(app: &AppHandle) -> Result<Connection, String> {
    let path = history_db_path(app)?;
    let conn = Connection::open(path).map_err(|error| error.to_string())?;
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|error| error.to_string())?;
    Ok(conn)
}

pub fn init_schema_on(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS history(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            source TEXT NOT NULL,
            target TEXT NOT NULL,
            service TEXT NOT NULL,
            result TEXT NOT NULL,
            timestamp INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS tasks(
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            done INTEGER NOT NULL,
            order_index INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,
            archived_at TEXT,
            deleted_at TEXT
        );
        CREATE TABLE IF NOT EXISTS clips(
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            text TEXT NOT NULL,
            order_index INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS clip_images(
            id TEXT PRIMARY KEY,
            clip_id TEXT NOT NULL,
            file_name TEXT NOT NULL,
            mime_type TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            size_bytes INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(clip_id) REFERENCES clips(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS capture_history(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            kind TEXT NOT NULL,
            path TEXT,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS meta(
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS import_ledger(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            started_at TEXT NOT NULL,
            finished_at TEXT NOT NULL,
            source TEXT NOT NULL,
            dry_run INTEGER NOT NULL,
            report_json TEXT NOT NULL,
            snapshot_path TEXT
        );
        CREATE TABLE IF NOT EXISTS task_events(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL,
            event TEXT NOT NULL,
            at TEXT NOT NULL
        );
        "#,
    )
    .map_err(|error| error.to_string())?;
    migrate_schema(conn)
}

fn table_columns(conn: &Connection, table: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    let mut columns = Vec::new();
    for row in rows {
        columns.push(row.map_err(|error| error.to_string())?);
    }
    Ok(columns)
}

fn migrate_schema(conn: &Connection) -> Result<(), String> {
    let columns = table_columns(conn, "clip_images")?;
    if !columns.iter().any(|column| column == "order_index") {
        conn.execute(
            "ALTER TABLE clip_images ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0",
            [],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn init_schema(app: &AppHandle) -> Result<(), String> {
    let conn = open(app)?;
    init_schema_on(&conn)
}

pub fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM meta WHERE key = ?1")
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params![key])
        .map_err(|error| error.to_string())?;
    match rows.next().map_err(|error| error.to_string())? {
        Some(row) => Ok(Some(row.get(0).map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

pub fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO meta(key, value) VALUES(?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_creates_tasks_clips_and_history() {
        let conn = Connection::open_in_memory().unwrap();
        init_schema_on(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks(id, title, done, order_index, created_at, updated_at) VALUES('t1','x',0,0,'0','0')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO clips(id, title, text, order_index, created_at, updated_at) VALUES('c1','y','z',0,'0','0')",
            [],
        )
        .unwrap();
        let tasks: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        let clips: i64 = conn
            .query_row("SELECT COUNT(*) FROM clips", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tasks, 1);
        assert_eq!(clips, 1);
        conn.execute(
            "INSERT INTO import_ledger(started_at, finished_at, source, dry_run, report_json, snapshot_path) VALUES('1','1','t',0,'{}','')",
            [],
        )
        .unwrap();
        let ledger: i64 = conn
            .query_row("SELECT COUNT(*) FROM import_ledger", [], |row| row.get(0))
            .unwrap();
        assert_eq!(ledger, 1);
        conn.execute(
            "INSERT INTO task_events(task_id, event, at) VALUES('t1','restored','1')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO clip_images(id, clip_id, file_name, mime_type, relative_path, size_bytes, created_at, order_index) VALUES('i1','c1','a.png','image/png','copy-assets/a.png',1,'0',0)",
            [],
        )
        .unwrap();
        let order: i64 = conn
            .query_row(
                "SELECT order_index FROM clip_images WHERE id='i1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(order, 0);
    }
}
