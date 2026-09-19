//! Starts/stops the headless Pot selection helper (Alt+Q + Terminal shift-select).
//! No separate tray icon — lifecycle is tied to Pot Forge.

use log::{info, warn};
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(target_os = "windows")]
fn helper_dir() -> PathBuf {
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        return PathBuf::from(local).join("PotTerminalHelper");
    }
    PathBuf::from(r"C:\Users\Public\PotTerminalHelper")
}

#[cfg(target_os = "windows")]
fn powershell_path() -> PathBuf {
    if let Ok(windir) = std::env::var("WINDIR") {
        let p = PathBuf::from(windir)
            .join("System32")
            .join("WindowsPowerShell")
            .join("v1.0")
            .join("powershell.exe");
        if p.exists() {
            return p;
        }
    }
    PathBuf::from("powershell.exe")
}

/// Launch headless selection helper if not already running.
#[cfg(target_os = "windows")]
pub fn start_selection_helper() {
    let dir = helper_dir();
    let script = dir.join("PotTerminalHelper.ps1");
    if !script.exists() {
        warn!(
            "Selection helper script not found at {:?}; Alt+Q helper not started",
            script
        );
        return;
    }

    // Ensure.ps1 avoids duplicate instances via mutex inside the script
    let ps = powershell_path();
    let ensure = dir.join("Ensure-Helper.ps1");
    let result = if ensure.exists() {
        Command::new(&ps)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
            ])
            .arg(&ensure)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    } else {
        Command::new(&ps)
            .args([
                "-NoLogo",
                "-NoProfile",
                "-STA",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
            ])
            .arg(&script)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
    };

    match result {
        Ok(child) => info!(
            "Selection helper launch requested (child pid optional {:?})",
            child.id()
        ),
        Err(e) => warn!("Failed to start selection helper: {}", e),
    }
}

#[cfg(not(target_os = "windows"))]
pub fn start_selection_helper() {}

/// Best-effort stop of selection helper when Pot quits.
#[cfg(target_os = "windows")]
pub fn stop_selection_helper() {
    // An isolated profile can deliberately omit the helper. Its exit must not stop
    // a helper belonging to the installed application.
    if !helper_dir().join("PotTerminalHelper.ps1").exists() {
        return;
    }
    // Kill powershell processes whose command line is the helper script
    let _ = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-WindowStyle",
            "Hidden",
            "-Command",
            r#"
Get-CimInstance Win32_Process |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine -like '*-File *PotTerminalHelper.ps1*' -and
    $_.CommandLine -notlike '*Ensure-Helper*'
  } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
"#,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    info!("Selection helper stop requested");
}

#[cfg(not(target_os = "windows"))]
pub fn stop_selection_helper() {}
