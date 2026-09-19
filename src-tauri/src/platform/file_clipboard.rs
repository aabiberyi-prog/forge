use std::path::PathBuf;

#[cfg(windows)]
const DROPFILES_HEADER_BYTES: usize = 20;

pub fn write_paths(paths: &[PathBuf]) -> Result<(), String> {
    write_file_paths_to_clipboard(paths)
}

#[cfg(windows)]
pub(crate) fn build_dropfiles_clipboard_data(paths: &[PathBuf]) -> Result<Vec<u8>, String> {
    use std::os::windows::ffi::OsStrExt;

    if paths.is_empty() {
        return Err("no image files to copy".to_string());
    }

    let mut bytes = vec![0; DROPFILES_HEADER_BYTES];
    bytes[0..4].copy_from_slice(&(DROPFILES_HEADER_BYTES as u32).to_le_bytes());
    bytes[16..20].copy_from_slice(&1u32.to_le_bytes());

    for path in paths {
        for unit in path.as_os_str().encode_wide().chain(std::iter::once(0)) {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
    }
    bytes.extend_from_slice(&0u16.to_le_bytes());

    Ok(bytes)
}

#[cfg(windows)]
pub(crate) fn preferred_drop_effect_copy_data() -> [u8; 4] {
    1u32.to_le_bytes()
}

#[cfg(windows)]
fn write_file_paths_to_clipboard(paths: &[PathBuf]) -> Result<(), String> {
    use std::ffi::c_void;
    use std::ptr;

    const CF_HDROP: u32 = 15;
    const GMEM_MOVEABLE: u32 = 0x0002;
    const PREFERRED_DROP_EFFECT: &[u16] = &[
        'P' as u16, 'r' as u16, 'e' as u16, 'f' as u16, 'e' as u16, 'r' as u16, 'r' as u16,
        'e' as u16, 'd' as u16, ' ' as u16, 'D' as u16, 'r' as u16, 'o' as u16, 'p' as u16,
        'E' as u16, 'f' as u16, 'f' as u16, 'e' as u16, 'c' as u16, 't' as u16, 0,
    ];

    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd_new_owner: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn RegisterClipboardFormatW(format: *const u16) -> u32;
        fn SetClipboardData(format: u32, data: *mut c_void) -> *mut c_void;
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalFree(memory: *mut c_void) -> *mut c_void;
        fn GlobalLock(memory: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(memory: *mut c_void) -> i32;
    }

    struct ClipboardGuard;
    impl Drop for ClipboardGuard {
        fn drop(&mut self) {
            unsafe {
                CloseClipboard();
            }
        }
    }

    unsafe fn set_clipboard_bytes(format: u32, bytes: &[u8]) -> Result<(), String> {
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len());
        if memory.is_null() {
            return Err(format!(
                "GlobalAlloc failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let locked = GlobalLock(memory);
        if locked.is_null() {
            GlobalFree(memory);
            return Err(format!(
                "GlobalLock failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        ptr::copy_nonoverlapping(bytes.as_ptr(), locked.cast::<u8>(), bytes.len());
        GlobalUnlock(memory);

        if SetClipboardData(format, memory).is_null() {
            GlobalFree(memory);
            return Err(format!(
                "SetClipboardData failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        Ok(())
    }

    let dropfiles = build_dropfiles_clipboard_data(paths)?;
    let drop_effect = preferred_drop_effect_copy_data();

    unsafe {
        if OpenClipboard(ptr::null_mut()) == 0 {
            return Err(format!(
                "OpenClipboard failed: {}",
                std::io::Error::last_os_error()
            ));
        }
        let _guard = ClipboardGuard;

        if EmptyClipboard() == 0 {
            return Err(format!(
                "EmptyClipboard failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        let drop_effect_format = RegisterClipboardFormatW(PREFERRED_DROP_EFFECT.as_ptr());
        if drop_effect_format == 0 {
            return Err(format!(
                "RegisterClipboardFormatW failed: {}",
                std::io::Error::last_os_error()
            ));
        }

        set_clipboard_bytes(CF_HDROP, &dropfiles)?;
        set_clipboard_bytes(drop_effect_format, &drop_effect)?;
    }

    Ok(())
}

#[cfg(not(windows))]
fn write_file_paths_to_clipboard(_paths: &[PathBuf]) -> Result<(), String> {
    Err("file clipboard is only supported on Windows".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn dropfiles_clipboard_data_contains_wide_file_paths() {
        let bytes = build_dropfiles_clipboard_data(&[
            PathBuf::from(r"C:\images\a.png"),
            PathBuf::from(r"D:\b.jpg"),
        ])
        .unwrap();

        assert_eq!(&bytes[0..4], &20u32.to_le_bytes());
        assert_eq!(&bytes[16..20], &1u32.to_le_bytes());

        let payload: Vec<u16> = bytes[20..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        let expected: Vec<u16> = "C:\\images\\a.png\0D:\\b.jpg\0\0".encode_utf16().collect();
        assert_eq!(payload, expected);
    }

    #[cfg(windows)]
    #[test]
    fn preferred_drop_effect_uses_copy_action() {
        assert_eq!(preferred_drop_effect_copy_data(), 1u32.to_le_bytes());
    }

    #[cfg(not(windows))]
    #[test]
    fn file_clipboard_is_windows_only() {
        let err = write_paths(&[PathBuf::from("/tmp/a.png")]).unwrap_err();
        assert!(err.contains("Windows"));
    }
}
