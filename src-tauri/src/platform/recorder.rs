#![allow(dead_code)]

#[cfg(windows)]
pub fn start_recording() -> Result<(), String> {
    crate::features::recorder::toggle_recording();
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn start_recording() -> Result<(), String> {
    unimplemented!("macOS recording is Phase 8")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn start_recording() -> Result<(), String> {
    unimplemented!("Linux recording is not in Windows 1.0")
}
