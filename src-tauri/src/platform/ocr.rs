#![allow(dead_code)]

use std::path::Path;

#[cfg(windows)]
pub fn recognize(_image_path: &Path, lang: &str) -> Result<String, String> {
    let app = crate::APP
        .get()
        .ok_or_else(|| "app handle is not ready".to_string())?;
    crate::system_ocr::system_ocr(app.clone(), lang)
}

#[cfg(target_os = "macos")]
pub fn recognize(_image_path: &Path, _lang: &str) -> Result<String, String> {
    unimplemented!("macOS OCR is Phase 8")
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn recognize(_image_path: &Path, _lang: &str) -> Result<String, String> {
    unimplemented!("Linux system OCR is not in Windows 1.0")
}
