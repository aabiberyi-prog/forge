use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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

    let temp_path = path.with_extension("tmp");
    let raw = serde_json::to_string_pretty(value).map_err(|error| error.to_string())?;
    fs::write(&temp_path, raw).map_err(|error| error.to_string())?;

    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }

    fs::rename(temp_path, path).map_err(|error| error.to_string())
}

pub fn timestamp() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
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
}
