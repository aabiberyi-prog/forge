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
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use zip::ZipArchive;
use sha2::{Digest, Sha256};

const FFMPEG_ZIP_URL: &str =
    "https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-8.1.2-essentials_build.zip";
// Published by Gyan alongside the versioned package; verified 2026-09-19.
const FFMPEG_SHA256: &str = "db580001caa24ac104c8cb856cd113a87b0a443f7bdf47d8c12b1d740584a2ec";

struct ActiveRecording {
    child: Child,
    path: PathBuf,
}

static RECORDING: Mutex<Option<ActiveRecording>> = Mutex::new(None);
static RECORD_JOB: Mutex<()> = Mutex::new(());
static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

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
        .join("ffmpeg")
        .join("8.1.2");
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
        if tools_respond(&sidecar) {
            return Ok(sidecar);
        }
    }
    if let Some(path) = path_ffmpeg() {
        if tools_respond(&path) {
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
    let mut found = std::collections::HashSet::new();
    for index in 0..archive.len() {
        let mut item = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = item.name().replace('\\', "/");
        let file_name = name.rsplit('/').next().unwrap_or("");
        if !["ffmpeg.exe", "ffprobe.exe"].contains(&file_name) { continue; }
        if !found.insert(file_name.to_string()) { return Err("duplicate recorder tool in archive".into()); }
        let mut out = File::create(dest.with_file_name(file_name)).map_err(|error| error.to_string())?;
        std::io::copy(&mut item, &mut out).map_err(|error| error.to_string())?;
    }
    if found.len() == 2 { Ok(()) } else { Err("ffmpeg.exe or ffprobe.exe missing from archive".into()) }
}

fn verify_download(bytes: &[u8], expected: &str) -> Result<(), String> {
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual.eq_ignore_ascii_case(expected) { Ok(()) } else { Err("FFmpeg checksum mismatch".into()) }
}

pub fn fetch_ffmpeg() -> Result<PathBuf, String> {
    if let Ok(existing) = resolve_ffmpeg() {
        return Ok(existing);
    }
    let dest = sidecar_ffmpeg_path()?;
    let install = dest.parent().ok_or("missing tool directory")?;
    let root = install.parent().ok_or("missing tool cache")?;
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let staging = root.join(format!("staging-{}", crate::features::json_store::unique_stamp()));
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        use std::io::Read;
        let response = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(120))
            .build().map_err(|e| e.to_string())?.get(FFMPEG_ZIP_URL).send()
            .map_err(|e| e.to_string())?.error_for_status().map_err(|e| e.to_string())?;
        let limit = 200 * 1024 * 1024;
        let mut bytes = Vec::new();
        response.take(limit + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.len() as u64 > limit { return Err("FFmpeg download exceeds size limit".into()); }
        verify_download(&bytes, FFMPEG_SHA256)?;
        let zip = staging.join("download.zip");
        fs::write(&zip, bytes).map_err(|e| e.to_string())?;
        let staged = staging.join("ffmpeg.exe");
        extract_ffmpeg_exe(&zip, &staged)?;
        fs::remove_file(zip).map_err(|e| e.to_string())?;
        if !tools_respond(&staged) { return Err("Downloaded recorder tools failed their version check".into()); }
        let previous = root.join(format!("previous-{}", crate::features::json_store::unique_stamp()));
        let had_previous = install.exists();
        if had_previous { fs::rename(install, &previous).map_err(|e| e.to_string())?; }
        if let Err(error) = fs::rename(&staging, install) {
            if had_previous { let _ = fs::rename(&previous, install); }
            return Err(error.to_string());
        }
        if had_previous { let _ = fs::remove_dir_all(previous); }
        Ok(dest.clone())
    })();
    let _ = fs::remove_dir_all(staging);
    result
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

fn probe_has_frame(bytes: &[u8]) -> bool {
    serde_json::from_slice::<serde_json::Value>(bytes).ok()
        .and_then(|value| value.get("frames").and_then(|frames| frames.as_array()).cloned())
        .is_some_and(|frames| frames.iter().any(|frame| frame["media_type"] == "video"
            && frame["width"].as_u64().unwrap_or(0) > 0 && frame["height"].as_u64().unwrap_or(0) > 0))
}

pub fn recording_output_is_valid(path: &Path, success: bool) -> Result<(), String> {
    if !success { return Err("ffmpeg exited with an error".into()); }
    let meta = fs::metadata(path).map_err(|_| format!("recording missing: {}", path.display()))?;
    if meta.len() < 32 { return Err("recording too small".into()); }
    let probe = resolve_ffmpeg()?.with_file_name("ffprobe.exe");
    let mut command = hidden_command(&probe);
    command.args(["-v", "error", "-select_streams", "v:0", "-read_intervals", "%+#5", "-show_frames", "-show_entries", "frame=media_type,width,height", "-of", "json"]).arg(path);
    let output = checked_output(&mut command, std::time::Duration::from_secs(15))?;
    if output.status.success() && probe_has_frame(&output.stdout) { Ok(()) }
    else { Err("recording contains no decodable video frame".into()) }
}

fn hidden_command(path: &Path) -> Command {
    let mut command = Command::new(path);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    command
}

fn checked_output(command: &mut Command, timeout: std::time::Duration) -> Result<std::process::Output, String> {
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + timeout;
    while child.try_wait().map_err(|e| e.to_string())?.is_none() {
        if std::time::Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            return Err("recorder tool timed out".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    child.wait_with_output().map_err(|e| e.to_string())
}

fn tools_respond(ffmpeg: &Path) -> bool {
    ffmpeg_responds(ffmpeg) && ffmpeg_responds(&ffmpeg.with_file_name("ffprobe.exe"))
}

fn child_is_running(child: &mut Child) -> bool {
    match child.try_wait() {
        Ok(None) => true,
        Ok(Some(_)) | Err(_) => false,
    }
}

fn ffmpeg_responds(path: &Path) -> bool {
    checked_output(hidden_command(path).arg("-version"), std::time::Duration::from_secs(5))
        .map(|output| output.status.success()).unwrap_or(false)
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
    let mut slot = RECORDING.lock().map_err(|error| error.to_string())?;
    if SHUTTING_DOWN.load(Ordering::SeqCst) { return Err("recording cancelled during shutdown".into()); }
    let child = command.spawn().map_err(|error| error.to_string())?;
    *slot = Some(ActiveRecording { child, path: path.clone() });
    drop(slot);
    std::thread::sleep(std::time::Duration::from_millis(80));
    let mut slot = RECORDING.lock().map_err(|error| error.to_string())?;
    let running = slot.as_mut().map(|active| child_is_running(&mut active.child)).unwrap_or(false);
    if !running {
        *slot = None;
        let log = fs::read_to_string(&log_path).unwrap_or_default();
        let _ = fs::remove_file(&path);
        return Err(format!(
            "ffmpeg exited immediately: {}",
            log.lines().rev().take(8).collect::<Vec<_>>().into_iter().rev().collect::<Vec<_>>().join("\n")
        ));
    }
    drop(slot);
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
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while active.child.try_wait().map_err(|e| e.to_string())?.is_none() {
        if std::time::Instant::now() >= deadline {
            let _ = active.child.kill(); let _ = active.child.wait();
            return Err("recording did not stop within 10 seconds".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    let status = active.child.wait();
    drop(slot);
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
    SHUTTING_DOWN.store(true, Ordering::SeqCst);
    if is_recording() {
        match stop_recording() {
            Ok(path) => info!("Recording finalized on quit: {}", path.display()),
            Err(error) => warn!("Recording finalize on quit failed: {error}"),
        }
    }
}

fn toggle_recording_now() -> Result<bool, String> {
    let _job = RECORD_JOB.try_lock().map_err(|_| "recording is starting or stopping".to_string())?;
    if SHUTTING_DOWN.load(Ordering::SeqCst) { return Err("application is shutting down".into()); }
    let result = if is_recording() {
        stop_recording()
    } else {
        start_recording()
    };
    result.map(|_| is_recording())
}

pub fn toggle_recording() {
    std::thread::spawn(|| {
        if let Err(error) = toggle_recording_now() {
            warn!("Screen recording failed: {error}");
            notify("Forge", &format!("Recording failed: {error}"));
        }
    });
}

#[tauri::command]
pub fn recording_status() -> bool {
    is_recording()
}

#[tauri::command]
pub async fn toggle_screen_recording() -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(toggle_recording_now).await.map_err(|e| e.to_string())?
}

pub fn ensure_recording_hotkey_default() {
    if get("hotkey_screen_recording").is_none()
    {
        set("hotkey_screen_recording", "Alt+4");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorder_requires_decoded_frame_and_verified_download() {
        assert!(!probe_has_frame(br#"{"frames":[]}"#));
        assert!(!probe_has_frame(br#"{"streams":[{"width":16,"height":16}]}"#));
        assert!(probe_has_frame(br#"{"frames":[{"media_type":"video","width":16,"height":16}]}"#));
        assert!(verify_download(b"abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").is_ok());
        assert!(verify_download(b"modified", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad").is_err());
    }

    #[test]
    #[ignore = "requires installed ffmpeg/ffprobe; creates synthetic video only"]
    fn synthetic_recording_decodes_with_real_tools() {
        let tool = resolve_ffmpeg().unwrap();
        let dir = std::env::temp_dir().join(format!("forge-video-fixture-{}", crate::features::json_store::unique_stamp()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("fixture.mp4");
        let output = checked_output(hidden_command(&tool)
            .args(["-hide_banner", "-y", "-f", "lavfi", "-i", "color=c=black:s=16x16:r=10", "-t", "0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p"]).arg(&path), std::time::Duration::from_secs(15)).unwrap();
        assert!(output.status.success());
        recording_output_is_valid(&path, true).unwrap();
        let _ = fs::remove_dir_all(dir);
    }

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
        assert!(recording_output_is_valid(&path, true).is_err());
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
