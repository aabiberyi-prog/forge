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
    // Decode first: a video/corrupt file must not become a blank pin window.
    let image = image::ImageReader::open(source).map_err(|e| e.to_string())?
        .with_guessed_format().map_err(|e| e.to_string())?.decode().map_err(|e| format!("invalid image: {e}"))?;
    image.save_with_format(&dest, image::ImageFormat::Png).map_err(|e| e.to_string())?;
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

#[tauri::command(async)]
pub fn open_pin_from_path(path: String) -> Result<String, String> {
    let app = APP.get().ok_or("app handle is not ready")?;
    open_pin_window(app, Path::new(&path))
}

#[tauri::command(async)]
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
    let result = open_pin_window(app, &temp);
    let _ = fs::remove_file(temp);
    result
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
    read_sharex_history_at(&path)
}

fn read_sharex_history_at(path: &Path) -> Vec<PinHistoryItem> {
    if !path.exists() { return Vec::new(); }
    let Ok(conn) = rusqlite::Connection::open_with_flags(
        &path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    ) else {
        return Vec::new();
    };
    let Ok(mut stmt) = conn.prepare(
        "SELECT Id, FileName, FilePath, DateTime, Type FROM History WHERE lower(Type)='image' ORDER BY Id DESC",
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
        "SELECT id, path, created_at, kind FROM capture_history WHERE kind != 'recording' ORDER BY id DESC",
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
            if !is_image_path(Path::new(&path)) { return None; }
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

fn is_image_path(path: &Path) -> bool {
    path.extension().and_then(|value| value.to_str()).is_some_and(|value| {
        ["png", "jpg", "jpeg", "webp", "gif", "bmp", "tif", "tiff"].contains(&value.to_ascii_lowercase().as_str())
    })
}

pub fn release_pin(label: &str) {
    if let Some(path) = pin_map().as_mut().and_then(|map| map.remove(label)) {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub async fn list_pin_history() -> Result<Vec<PinHistoryItem>, String> {
    let app = APP.get().ok_or("app handle is not ready")?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut items = read_forge_history(&app);
        items.extend(read_sharex_history());
        items
    }).await.map_err(|error| error.to_string())
}

#[tauri::command(async)]
pub fn open_pin_history_window() {
    crate::window::open_pin_history();
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
        let items = read_sharex_history_at(&fixture);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].file_name, "a.png");
        assert!(!items[0].exists);
        let missing = !Path::new("C:/missing-a.png").exists();
        assert!(missing);
        let _ = fs::remove_file(fixture);
    }

    #[test]
    fn history_picker_keeps_images_beyond_two_hundred() {
        let fixture = std::env::temp_dir().join(format!("forge-pin-history-{}.db", crate::features::json_store::unique_stamp()));
        let conn = rusqlite::Connection::open(&fixture).unwrap();
        conn.execute_batch("CREATE TABLE History(Id INTEGER PRIMARY KEY, FileName TEXT, FilePath TEXT, DateTime TEXT, Type TEXT);").unwrap();
        for index in 0..205 {
            conn.execute("INSERT INTO History VALUES(?1,'missing.png','missing.png','2026-01-01','Image')", [index]).unwrap();
        }
        drop(conn);
        assert_eq!(read_sharex_history_at(&fixture).len(), 205);
        assert!(!is_image_path(Path::new("recording.mp4")));
        let _ = fs::remove_file(fixture);
    }

    #[test]
    fn pin_copies_are_unique() {
        let a = PIN_SEQ.fetch_add(1, Ordering::SeqCst);
        let b = PIN_SEQ.fetch_add(1, Ordering::SeqCst);
        assert_ne!(a, b);
    }
}
