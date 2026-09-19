#![allow(dead_code)]

/// Autostart is owned by tauri-plugin-autostart. This module is the platform
/// seam so Phase 8 can swap in Launch Agent details without HKCU `reg.exe`.
#[cfg(windows)]
pub fn is_supported() -> bool {
    true
}

#[cfg(target_os = "macos")]
pub fn is_supported() -> bool {
    unimplemented!("macOS startup registration is Phase 8")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn is_supported() -> bool {
    true
}
