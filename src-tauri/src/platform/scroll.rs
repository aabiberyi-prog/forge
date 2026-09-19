#![allow(dead_code)]

#[cfg(windows)]
pub fn scrolling_capture() -> Result<(), String> {
    crate::features::scroll::start_scrolling_capture();
    Ok(())
}

#[cfg(target_os = "macos")]
pub fn scrolling_capture() -> Result<(), String> {
    unimplemented!("macOS scrolling capture is blocked by TCC; hide this action in the UI")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn scrolling_capture() -> Result<(), String> {
    unimplemented!("Linux scrolling capture is not in Windows 1.0")
}
