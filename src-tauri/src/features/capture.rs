use crate::config::{get, set};
use crate::features::db;
use crate::APP;
use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use rusqlite::params;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CaptureFinishResult {
    pub path: Option<String>,
    pub saved: bool,
    pub copied: bool,
    pub pinned: bool,
    pub error: Option<String>,
}

static CAPTURE_MODE: Mutex<String> = Mutex::new(String::new());

pub fn set_capture_mode(mode: &str) {
    if let Ok(mut guard) = CAPTURE_MODE.lock() {
        *guard = mode.to_string();
    }
}

#[tauri::command]
pub fn get_capture_mode() -> String {
    CAPTURE_MODE
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default()
}

pub fn default_capture_dir() -> PathBuf {
    PathBuf::from(r"D:\ShareX\Screenshots")
}

pub fn capture_save_dir() -> PathBuf {
    get("capture_save_dir")
        .and_then(|value| value.as_str().map(PathBuf::from))
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(default_capture_dir)
}

pub fn capture_filename(now: SystemTime) -> String {
    let secs = now
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = secs / 86400;
    let (year, month, day) = civil_from_days(days as i32);
    let rem = secs % 86400;
    let hour = rem / 3600;
    let minute = (rem % 3600) / 60;
    let second = rem % 60;
    let millis = now
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.subsec_millis())
        .unwrap_or(0);
    format!("Forge_{year:04}-{month:02}-{day:02}_{hour:02}{minute:02}{second:02}_{millis:03}.png")
}

pub fn unique_save_path(dir: &Path, now: SystemTime) -> PathBuf {
    let name = capture_filename(now);
    let candidate = dir.join(&name);
    if !candidate.exists() {
        return candidate;
    }
    let stem = Path::new(&name)
        .file_stem()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Forge".into());
    let mut index = 2u32;
    loop {
        let path = dir.join(format!("{stem}-{index}.png"));
        if !path.exists() {
            return path;
        }
        index += 1;
    }
}

fn civil_from_days(z: i32) -> (i32, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as u32;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i32 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

pub(crate) fn cache_cut_path(app: &AppHandle) -> Result<PathBuf, String> {
    let mut path = dirs::cache_dir().ok_or("cache dir missing")?;
    path.push(&app.config().identifier);
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    path.push("pot_screenshot_cut.png");
    Ok(path)
}

fn decode_png_base64(png_base64: &str) -> Result<Vec<u8>, String> {
    let encoded = png_base64
        .split(',')
        .last()
        .ok_or_else(|| "invalid png data".to_string())?;
    BASE64_STANDARD
        .decode(encoded.trim())
        .map_err(|error| error.to_string())
}

pub(crate) fn copy_png_bytes(bytes: &[u8]) -> Result<(), String> {
    use arboard::{Clipboard, ImageData};
    use image::ImageReader;
    use std::borrow::Cow;
    use std::io::Cursor;

    let image = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?
        .decode()
        .map_err(|error| error.to_string())?;
    let rgba = image.to_rgba8();
    let (width, height) = rgba.dimensions();
    let mut clipboard = Clipboard::new().map_err(|error| error.to_string())?;
    clipboard
        .set_image(ImageData {
            width: width as usize,
            height: height as usize,
            bytes: Cow::from(rgba.into_raw()),
        })
        .map_err(|error| error.to_string())
}

pub(crate) fn record_capture_history(app: &AppHandle, path: &Path, kind: &str) -> Result<(), String> {
    let conn = db::open(app)?;
    db::init_schema_on(&conn)?;
    let created_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO capture_history(kind, path, created_at) VALUES(?1, ?2, ?3)",
        params![kind, path.to_string_lossy(), created_at],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn finish_capture(png_base64: String, pin: bool) -> Result<CaptureFinishResult, String> {
    let app = APP.get().ok_or("app handle is not ready")?;
    let bytes = decode_png_base64(&png_base64)?;
    let cut_path = cache_cut_path(app)?;
    fs::write(&cut_path, &bytes).map_err(|error| error.to_string())?;

    let dir = capture_save_dir();
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let save_path = unique_save_path(&dir, SystemTime::now());
    if let Err(error) = fs::write(&save_path, &bytes) {
        return Ok(CaptureFinishResult {
            path: None,
            saved: false,
            copied: false,
            pinned: false,
            error: Some(format!("save: {error}")),
        });
    }
    let _ = record_capture_history(app, &save_path, "region");
    match copy_png_bytes(&bytes) {
        Ok(()) => {
            if pin {
                crate::window::pin_window();
            }
            Ok(CaptureFinishResult {
                path: Some(save_path.to_string_lossy().to_string()),
                saved: true,
                copied: true,
                pinned: pin,
                error: None,
            })
        }
        Err(error) => Ok(CaptureFinishResult {
            path: Some(save_path.to_string_lossy().to_string()),
            saved: true,
            copied: false,
            pinned: false,
            error: Some(format!("copy: {error}")),
        }),
    }
}

#[tauri::command]
pub fn retry_capture_copy(path: String, pin: bool) -> Result<CaptureFinishResult, String> {
    let bytes = fs::read(&path).map_err(|error| error.to_string())?;
    match copy_png_bytes(&bytes) {
        Ok(()) => {
            if pin {
                crate::window::pin_window();
            }
            Ok(CaptureFinishResult {
                path: Some(path),
                saved: true,
                copied: true,
                pinned: pin,
                error: None,
            })
        }
        Err(error) => Ok(CaptureFinishResult {
            path: Some(path),
            saved: true,
            copied: false,
            pinned: false,
            error: Some(format!("copy: {error}")),
        }),
    }
}

pub fn ensure_capture_hotkey_defaults() {
    if get("capture_save_dir")
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
        .is_empty()
    {
        set("capture_save_dir", default_capture_dir().to_string_lossy().to_string());
    }
    if get("hotkey_capture_region")
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
        .is_empty()
    {
        set("hotkey_capture_region", "Alt+1");
    }
    if get("hotkey_pin_to_screen")
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
        .is_empty()
    {
        set("hotkey_pin_to_screen", "Alt+3");
    }
    if get("hotkey_ocr_recognize")
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
        .is_empty()
    {
        set("hotkey_ocr_recognize", "Alt+5");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_filename_uses_forge_prefix_and_png() {
        let name = capture_filename(UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000));
        assert!(name.starts_with("Forge_"));
        assert!(name.ends_with(".png"));
        assert!(name.contains('-'));
        assert!(name.contains('_'));
    }

    #[test]
    fn default_capture_dir_is_sharex_folder() {
        assert_eq!(
            default_capture_dir(),
            PathBuf::from(r"D:\ShareX\Screenshots")
        );
    }

    #[test]
    fn twenty_rapid_saves_do_not_overwrite() {
        let dir = std::env::temp_dir().join(format!(
            "forge-rapid-save-{}",
            crate::features::json_store::unique_stamp()
        ));
        fs::create_dir_all(&dir).unwrap();
        let now = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        let mut paths = std::collections::HashSet::new();
        for index in 0..20 {
            let path = unique_save_path(&dir, now);
            assert!(paths.insert(path.clone()), "duplicate path {path:?}");
            fs::write(&path, [index as u8]).unwrap();
        }
        assert_eq!(paths.len(), 20);
        for path in &paths {
            assert!(path.exists());
        }
        let _ = fs::remove_dir_all(dir);
    }
}
