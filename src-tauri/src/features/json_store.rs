use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Manager};

static UNIQUE_SEQ: AtomicU64 = AtomicU64::new(0);

pub fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&app_dir).map_err(|error| error.to_string())?;
    Ok(app_dir)
}

pub fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let raw = raw.trim_start_matches('\u{feff}');
    serde_json::from_str(raw)
        .map(Some)
        .map_err(|error| error.to_string())
}

pub fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    use std::io::Write;
    let temp_path = path.with_extension(format!("{}.tmp", unique_stamp()));
    let raw = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp_path).map_err(|e| e.to_string())?;
        file.write_all(raw.as_bytes()).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        // std::fs::rename replaces an existing file atomically on Windows and Unix.
        fs::rename(&temp_path, path).map_err(|e| e.to_string())
    })();
    if result.is_err() { let _ = fs::remove_file(temp_path); }
    result
}

pub fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

pub fn unique_stamp() -> String {
    format!("{}-{}", timestamp(), UNIQUE_SEQ.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct CopyItemsFile {
        schema_version: u32,
        items: Vec<serde_json::Value>,
    }

    #[test]
    fn read_json_accepts_utf8_bom() {
        let path = std::env::temp_dir().join(format!("copy-items-bom-{}.json", timestamp()));
        fs::write(&path, "\u{feff}{\"schemaVersion\":1,\"items\":[]}").unwrap();

        let parsed = read_json::<CopyItemsFile>(&path).unwrap().unwrap();

        let _ = fs::remove_file(path);
        assert_eq!(parsed.schema_version, 1);
        assert!(parsed.items.is_empty());
    }

    #[test]
    fn write_json_replaces_and_cleans_bak() {
        let path = std::env::temp_dir().join(format!("forge-json-{}.json", unique_stamp()));
        write_json(&path, &serde_json::json!({"n": 1})).unwrap();
        write_json(&path, &serde_json::json!({"n": 2})).unwrap();
        let raw = fs::read_to_string(&path).unwrap();
        assert!(raw.contains("\"n\": 2"));
        assert!(!path.with_extension("bak").exists());
        assert!(!path.with_extension("tmp").exists());
        let _ = fs::remove_file(path);
    }
}
