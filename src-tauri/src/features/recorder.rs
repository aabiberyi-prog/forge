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
        if ffmpeg_responds(&sidecar) {
            return Ok(sidecar);
        }
        return Err(format!("ffmpeg sidecar is not runnable: {}", sidecar.display()));
    }
    if let Some(path) = path_ffmpeg() {
        if ffmpeg_responds(&path) {
            return Ok(path);
        }
        return Err(format!("ffmpeg on PATH is not runnable: {}", path.display()));
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

fn unique_recording_path(dir: &Path, now: SystemTime) -> PathBuf {
    let name = recording_filename(now);
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
        let path = dir.join(format!("{stem}-{index}.mp4"));
        if !path.exists() {
            return path;
        }
        index += 1;
    }
}

pub fn recording_output_is_valid(path: &Path, success: bool) -> Result<(), String> {
    if !success {
        return Err("ffmpeg exited with an error".into());
    }
    let meta = fs::metadata(path).map_err(|_| format!("recording missing: {}", path.display()))?;
    if meta.len() < 32 {
        return Err(format!("recording too small: {}", path.display()));
    }
    Ok(())
}

fn child_is_running(child: &mut Child) -> bool {
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => false,
    }
}

fn ffmpeg_responds(path: &Path) -> bool {
    Command::new(path)
        .arg("-version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|status| status.success())
        .unwrap_or(false)
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
    let path = unique_recording_path(&dir, SystemTime::now());
    let log_path = path.with_extension("ffmpeg.log");
    let log_file = File::create(&log_path).map_err(|error| error.to_string())?;
    let args = ffmpeg_args(&path);
    let mut command = Command::new(&ffmpeg);
    command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::from(log_file));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(80));
    if !child_is_running(&mut child) {
        let log = fs::read_to_string(&log_path).unwrap_or_default();
        let _ = fs::remove_file(&path);
        return Err(format!(
            "ffmpeg exited immediately: {}",
            log.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
        ));
    }
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
    let status = active.child.wait();
    let success = status.as_ref().map(|code| code.success()).unwrap_or(false);
    if let Err(error) = recording_output_is_valid(&active.path, success) {
        let log = fs::read_to_string(active.path.with_extension("ffmpeg.log")).unwrap_or_default();
        notify("Forge", &format!("Recording failed: {error}"));
        return Err(if log.is_empty() {
            error
        } else {
            format!("{error}: {}", log.lines().rev().take(6).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join(" / "))
        });
    }
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
    let Ok(mut slot) = RECORDING.lock() else {
        return false;
    };
    let running = slot
        .as_mut()
        .map(|active| child_is_running(&mut active.child))
        .unwrap_or(false);
    if slot.is_some() && !running {
        *slot = None;
    }
    running
}

pub fn finalize_recording_on_quit() {
    if is_recording() {
        match stop_recording() {
            Ok(path) => info!("Recording finalized on quit: {}", path.display()),
            Err(error) => warn!("Recording finalize on quit failed: {error}"),
        }
    }
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

    #[test]
    fn missing_or_tiny_recording_is_not_reported_saved() {
        let path = std::env::temp_dir().join("forge-missing-recording.mp4");
        let _ = fs::remove_file(&path);
        assert!(recording_output_is_valid(&path, true).is_err());
        fs::write(&path, [0u8; 8]).unwrap();
        assert!(recording_output_is_valid(&path, true).is_err());
        fs::write(&path, [0u8; 64]).unwrap();
        assert!(recording_output_is_valid(&path, false).is_err());
        assert!(recording_output_is_valid(&path, true).is_ok());
        let _ = fs::remove_file(&path);
    }

    #[test]
    fn rapid_recordings_do_not_reuse_names() {
        let dir = std::env::temp_dir().join(format!(
            "forge-rec-{}",
            crate::features::json_store::unique_stamp()
        ));
        fs::create_dir_all(&dir).unwrap();
        let now = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        let mut paths = std::collections::HashSet::new();
        for index in 0..8 {
            let path = unique_recording_path(&dir, now);
            assert!(paths.insert(path.clone()));
            fs::write(&path, [index as u8]).unwrap();
        }
        assert_eq!(paths.len(), 8);
        let _ = fs::remove_dir_all(dir);
    }
}
