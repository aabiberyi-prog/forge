#![allow(dead_code)]

#[cfg(windows)]
pub fn start_selection_helper() {
    crate::selection_helper::start_selection_helper();
}

#[cfg(target_os = "macos")]
pub fn start_selection_helper() {
    unimplemented!("macOS selection helper is Phase 8")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn start_selection_helper() {}
