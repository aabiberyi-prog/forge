#![allow(dead_code)]

#[cfg(windows)]
pub fn capture_region() -> Result<(), String> {
    crate::window::capture_region();
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn capture_region() -> Result<(), String> {
    unimplemented!("macOS capture is Phase 8")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn capture_region() -> Result<(), String> {
    unimplemented!("Linux capture is not in Windows 1.0")
}
