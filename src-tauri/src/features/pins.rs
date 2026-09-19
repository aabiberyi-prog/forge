use crate::features::capture::copy_png_bytes;
use crate::features::db;
use crate::APP;
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{atomic::AtomicU32, atomic::Ordering, Mutex};
use tauri::{AppHandle, Manager};

static PIN_SEQ: AtomicU32 = AtomicU32::new(1);
static PIN_PATHS: Mutex<Option<HashMap<String, PathBuf>>> = Mutex::new(None);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinHistoryItem {
    pub id: String,
    pub source: String,
    pub path: String,
    pub file_name: String,
    pub created_at: String,
    pub exists: bool,
}

fn pin_map() -> std::sync::MutexGuard<'static, Option<HashMap<String, PathBuf>>> {
    PIN_PATHS.lock().expect("pin map")
}

fn pins_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let mut dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?;
    dir.push("pins");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn copy_immutable(app: &AppHandle, source: &Path) -> Result<(String, PathBuf), String> {
    if !source.exists() {
        return Err(format!("missing image: {}", source.display()));
    }
    let id = PIN_SEQ.fetch_add(1, Ordering::SeqCst);
    let label = format!("pin-{id}");
    let dest = pins_dir(app)?.join(format!("{label}.png"));
    fs::copy(source, &dest).map_err(|error| error.to_string())?;
    let mut guard = pin_map();
    let map = guard.get_or_insert_with(HashMap::new);
    map.insert(label.clone(), dest.clone());
    Ok((label, dest))
}

pub fn open_pin_window(app: &AppHandle, source: &Path) -> Result<String, String> {
    let (label, _dest) = copy_immutable(app, source)?;
    crate::window::open_named_pin(&label);
    Ok(label)
}

#[tauri::command]
pub fn open_pin_from_path(path: String) -> Result<String, String> {
    let app = APP.get().ok_or("app handle is not ready")?;
    open_pin_window(app, Path::new(&path))
}

#[tauri::command]
pub fn pin_from_clipboard() -> Result<String, String> {
    let app = APP.get().ok_or("app handle is not ready")?;
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    let image = clipboard
        .get_image()
        .map_err(|error| error.to_string())?;
    let buffer = image::RgbaImage::from_raw(
        image.width as u32,
        image.height as u32,
        image.bytes.into_owned(),
    )
    .ok_or_else(|| "clipboard image is invalid".to_string())?;
    let dir = pins_dir(app)?;
    let temp = dir.join(format!("clip-{}.png", crate::features::json_store::unique_stamp()));
    buffer
        .save(&temp)
        .map_err(|error| error.to_string())?;
    open_pin_window(app, &temp)
}

#[tauri::command]
pub fn get_pin_path(label: String) -> Result<String, String> {
    let guard = pin_map();
    let map = guard.as_ref().ok_or("no pins")?;
    let path = map.get(&label).ok_or_else(|| format!("unknown pin {label}"))?;
    if !path.exists() {
        return Err(format!("missing image: {}", path.display()));
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn copy_pin_image(label: String) -> Result<(), String> {
    let path = get_pin_path(label)?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    copy_png_bytes(&bytes)
}

fn sharex_history_db() -> Option<PathBuf> {
    dirs::document_dir().map(|dir| dir.join("ShareX").join("History.db"))
}

fn read_sharex_history() -> Vec<PinHistoryItem> {
    let Some(path) = sharex_history_db() else {
        return Vec::new();
    };
    if !path.exists() {
        return Vec::new();
    }
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT Id, FileName, FilePath, DateTime, Type FROM History ORDER BY Id DESC LIMIT 200",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, String>(4)?,
        ))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };
    let mut items = Vec::new();
    for row in rows.flatten() {
        if !row.4.eq_ignore_ascii_case("image") {
            continue;
        }
        let exists = Path::new(&row.2).exists();
        items.push(PinHistoryItem {
            id: format!("sharex-{}", row.0),
            source: "sharex".into(),
            path: row.2,
            file_name: row.1,
            created_at: row.3,
            exists,
        });
    }
    items
}

fn read_forge_history(app: &AppHandle) -> Vec<PinHistoryItem> {
    let Ok(conn) = db::open(app) else {
        return Vec::new();
    };
    let _ = db::init_schema_on(&conn);
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, path, created_at, kind FROM capture_history ORDER BY id DESC LIMIT 200",
    ) else {
        return Vec::new();
    };
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, i64>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, i64>(2)?,
            row.get::<_, String>(3)?,
        ))
    });
    let Ok(rows) = rows else {
        return Vec::new();
    };
    rows.flatten()
        .filter_map(|(id, path, created_at, _kind)| {
            let path = path?;
            Some(PinHistoryItem {
                id: format!("forge-{id}"),
                source: "forge".into(),
                file_name: Path::new(&path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone()),
                exists: Path::new(&path).exists(),
                created_at: created_at.to_string(),
                path,
            })
        })
        .collect()
}

#[tauri::command]
pub fn list_pin_history() -> Result<Vec<PinHistoryItem>, String> {
    let app = APP.get().ok_or("app handle is not ready")?;
    let mut items = read_forge_history(app);
    items.extend(read_sharex_history());
    Ok(items)
}

#[tauri::command]
pub fn open_pin_history_window() {
    crate::window::open_pin_history();
}

pub fn pin_from_capture_cache(app: &AppHandle) -> Result<String, String> {
    let cut = crate::features::capture::cache_cut_path(app)?;
    open_pin_window(app, &cut)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sharex_fixture_rows_are_read_only_and_keep_missing() {
        let fixture = std::env::temp_dir().join(format!(
            "sharex-hist-{}.db",
            crate::features::json_store::unique_stamp()
        ));
        let conn = rusqlite::Connection::open(&fixture).unwrap();
        conn.execute_batch(
            "CREATE TABLE History(Id INTEGER PRIMARY KEY, FileName TEXT, FilePath TEXT, DateTime TEXT, Type TEXT);
             INSERT INTO History(FileName, FilePath, DateTime, Type) VALUES('a.png','C:/missing-a.png','2026-01-01','Image');
             INSERT INTO History(FileName, FilePath, DateTime, Type) VALUES('b.mp4','C:/clip.mp4','2026-01-02','Video');",
        )
        .unwrap();
        drop(conn);
        let conn = rusqlite::Connection::open_with_flags(
            &fixture,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM History", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let missing = !Path::new("C:/missing-a.png").exists();
        assert!(missing);
        let _ = fs::remove_file(fixture);
    }

    #[test]
    fn pin_copies_are_unique() {
        let a = PIN_SEQ.fetch_add(1, Ordering::SeqCst);
        let b = PIN_SEQ.fetch_add(1, Ordering::SeqCst);
        assert_ne!(a, b);
    }
}
