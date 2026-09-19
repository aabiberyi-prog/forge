#![allow(dead_code)]

#[cfg(windows)]
pub fn capture_region() -> Result<(), String> {
    Err("region capture annotation is Phase 4".to_string())
}

#[cfg(target_os = "macos")]
pub fn capture_region() -> Result<(), String> {
    unimplemented!("macOS capture is Phase 8")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn capture_region() -> Result<(), String> {
    unimplemented!("Linux capture is not in Windows 1.0")
}
