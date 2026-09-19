use crate::config::{get, set};
use crate::features::capture::capture_save_dir;
use crate::features::db;
use crate::APP;
use log::{info, warn};
use rusqlite::params;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;

const FFMPEG_ZIP_URL: &str =
    "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

struct ActiveRecording {
    child: Child,
    path: PathBuf,
}

static RECORDING: Mutex<Option<ActiveRecording>> = Mutex::new(None);

pub fn ffmpeg_args(output: &Path) -> Vec<String> {
    vec![
        "-hide_banner".into(),
        "-y".into(),
        "-f".into(),
        "gdigrab".into(),
        "-framerate".into(),
        "30".into(),
        "-i".into(),
        "desktop".into(),
        "-c:v".into(),
        "libx264".into(),
        "-preset".into(),
        "ultrafast".into(),
        "-crf".into(),
        "28".into(),
        "-pix_fmt".into(),
        "yuv420p".into(),
        output.to_string_lossy().into_owned(),
    ]
}

fn sidecar_ffmpeg_path() -> Result<PathBuf, String> {
    let identifier = APP
        .get()
        .map(|app| app.config().identifier.clone())
        .unwrap_or_else(|| "com.aabiber.pot-forge".into());
    let dir = dirs::data_local_dir()
        .ok_or("local data dir missing")?
        .join(identifier)
        .join("ffmpeg");
    Ok(dir.join("ffmpeg.exe"))
}

fn path_ffmpeg() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        Command::new("where.exe")
            .arg("ffmpeg.exe")
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .map(|line| PathBuf::from(line.trim()))
            })
            .filter(|path| path.exists())
    }
    #[cfg(not(windows))]
    {
        None
    }
}

pub fn resolve_ffmpeg() -> Result<PathBuf, String> {
    let sidecar = sidecar_ffmpeg_path()?;
    if sidecar.exists() {
        return Ok(sidecar);
    }
    if let Some(path) = path_ffmpeg() {
        return Ok(path);
    }
    Err("ffmpeg is not installed yet".into())
}

fn extract_ffmpeg_exe(zip_path: &Path, dest: &Path) -> Result<(), String> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let file = File::open(zip_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut item = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = item.name().replace('\\', "/");
        if !name.ends_with("/ffmpeg.exe") && name != "ffmpeg.exe" {
            continue;
        }
        let mut out = File::create(dest).map_err(|error| error.to_string())?;
        std::io::copy(&mut item, &mut out).map_err(|error| error.to_string())?;
        return Ok(());
    }
    Err("ffmpeg.exe missing from archive".into())
}

pub fn fetch_ffmpeg() -> Result<PathBuf, String> {
    if let Ok(existing) = resolve_ffmpeg() {
        return Ok(existing);
    }
    let dest = sidecar_ffmpeg_path()?;
    let zip_path = dest.with_extension("zip");
    if let Some(parent) = zip_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    info!("Downloading ffmpeg from {FFMPEG_ZIP_URL}");
    let bytes = reqwest::blocking::get(FFMPEG_ZIP_URL)
        .map_err(|error| error.to_string())?
        .bytes()
        .map_err(|error| error.to_string())?;
    fs::write(&zip_path, &bytes).map_err(|error| error.to_string())?;
    extract_ffmpeg_exe(&zip_path, &dest)?;
    let _ = fs::remove_file(zip_path);
    if dest.exists() {
        Ok(dest)
    } else {
        Err("ffmpeg download did not produce ffmpeg.exe".into())
    }
}

fn recording_filename(now: SystemTime) -> String {
    crate::features::capture::capture_filename(now).replace(".png", ".mp4")
}

fn notify(title: &str, body: &str) {
    if let Some(app) = APP.get() {
        use tauri_plugin_notification::NotificationExt;
        let _ = app
            .notification()
            .builder()
            .title(title)
            .body(body)
            .show();
    }
}

fn start_recording() -> Result<PathBuf, String> {
    let ffmpeg = match resolve_ffmpeg() {
        Ok(path) => path,
        Err(_) => {
            notify("Forge", "Downloading ffmpeg for screen recording…");
            fetch_ffmpeg()?
        }
    };
    let dir = capture_save_dir();
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(recording_filename(SystemTime::now()));
    let args = ffmpeg_args(&path);
    let mut command = Command::new(&ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let child = command.spawn().map_err(|error| error.to_string())?;
    *RECORDING.lock().map_err(|error| error.to_string())? = Some(ActiveRecording {
        child,
        path: path.clone(),
    });
    info!("Screen recording started: {}", path.display());
    notify("Forge", "Recording screen");
    Ok(path)
}

fn stop_recording() -> Result<PathBuf, String> {
    let mut slot = RECORDING.lock().map_err(|error| error.to_string())?;
    let Some(mut active) = slot.take() else {
        return Err("no active recording".into());
    };
    if let Some(mut stdin) = active.child.stdin.take() {
        let _ = stdin.write_all(b"q\n");
        let _ = stdin.flush();
    }
    let _ = active.child.wait();
    if let Some(app) = APP.get() {
        if let Ok(conn) = db::open(app) {
            let _ = db::init_schema_on(&conn);
            let created_at = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_millis() as i64)
                .unwrap_or(0);
            let _ = conn.execute(
                "INSERT INTO capture_history(kind, path, created_at) VALUES(?1, ?2, ?3)",
                params!["recording", active.path.to_string_lossy(), created_at],
            );
        }
    }
    notify(
        "Forge",
        &format!("Saved recording {}", active.path.display()),
    );
    Ok(active.path)
}

pub fn is_recording() -> bool {
    RECORDING
        .lock()
        .ok()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

pub fn toggle_recording() {
    let result = if is_recording() {
        stop_recording()
    } else {
        start_recording()
    };
    if let Err(error) = result {
        warn!("Screen recording failed: {error}");
        notify("Forge", &format!("Recording failed: {error}"));
    }
}

#[tauri::command]
pub fn recording_status() -> bool {
    is_recording()
}

#[tauri::command]
pub fn toggle_screen_recording() -> Result<bool, String> {
    toggle_recording();
    Ok(is_recording())
}

pub fn ensure_recording_hotkey_default() {
    if get("hotkey_screen_recording")
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
        .is_empty()
    {
        set("hotkey_screen_recording", "Alt+4");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gdigrab_args_match_sharex_defaults() {
        let args = ffmpeg_args(Path::new(r"D:\ShareX\Screenshots\out.mp4"));
        let joined = args.join(" ");
        assert!(joined.contains("-f gdigrab"));
        assert!(joined.contains("-framerate 30"));
        assert!(joined.contains("-i desktop"));
        assert!(joined.contains("-c:v libx264"));
        assert!(joined.contains("-preset ultrafast"));
        assert!(joined.contains("-crf 28"));
        assert!(joined.contains("out.mp4"));
    }

    #[test]
    fn recording_name_uses_mp4() {
        let name = recording_filename(UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000));
        assert!(name.starts_with("Forge_"));
        assert!(name.ends_with(".mp4"));
    }
}
