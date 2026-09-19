#![allow(dead_code)]

#[cfg(windows)]
pub fn ensure_capture_permissions() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn ensure_capture_permissions() -> Result<(), String> {
    unimplemented!("macOS Screen Recording / Accessibility / Input Monitoring is Phase 8")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn ensure_capture_permissions() -> Result<(), String> {
    Ok(())
}
