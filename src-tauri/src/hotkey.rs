use crate::config::{get, set};
use crate::window::{
    capture_region, input_translate, ocr_recognize, ocr_translate, pin_capture, selection_translate,
};
use crate::APP;
use log::{info, warn};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

fn register<F>(app_handle: &AppHandle, name: &str, handler: F, key: &str) -> Result<(), String>
where
    F: Fn() + Send + Sync + 'static,
{
    let hotkey = {
        if key.is_empty() {
            match get(name) {
                Some(v) => v.as_str().unwrap().to_string(),
                None => {
                    set(name, "");
                    String::new()
                }
            }
        } else {
            key.to_string()
        }
    };

    if !hotkey.is_empty() {
        if let Some(error) = conflict_reason(name, &hotkey) {
            warn!("Hotkey {hotkey} for {name} rejected: {error}");
            return Err(error);
        }
        match app_handle
            .global_shortcut()
            .on_shortcut(hotkey.as_str(), move |_, _, event| {
                if event.state == ShortcutState::Pressed {
                    handler();
                }
            }) {
            Ok(()) => {
                info!("Registered global shortcut: {} for {}", hotkey, name);
            }
            Err(e) => {
                warn!("Failed to register global shortcut: {} {:?}", hotkey, e);
                return Err(e.to_string());
            }
        };
    }
    Ok(())
}

const CONFIGURED_HOTKEY_IDS: [&str; 6] = [
    "hotkey_selection_translate",
    "hotkey_input_translate",
    "hotkey_ocr_recognize",
    "hotkey_ocr_translate",
    "hotkey_capture_region",
    "hotkey_pin_to_screen",
];

pub(crate) fn reserved_shortcut(shortcut: &str) -> Option<&'static str> {
    match shortcut.to_ascii_lowercase().as_str() {
        "alt+2" => Some("Scrolling capture (Phase 6)"),
        "alt+4" => Some("Screen recording (Phase 5)"),
        _ => None,
    }
}

fn conflict_reason(name: &str, shortcut: &str) -> Option<String> {
    if let Some(why) = reserved_shortcut(shortcut) {
        return Some(format!("{shortcut} is reserved for {why}"));
    }
    for id in CONFIGURED_HOTKEY_IDS {
        if id == name {
            continue;
        }
        let other = get(id)
            .and_then(|value| value.as_str().map(str::to_owned))
            .unwrap_or_default();
        if !other.is_empty() && other.eq_ignore_ascii_case(shortcut) {
            return Some(format!("conflicts with {id} ({other})"));
        }
    }
    None
}

// Register global shortcuts
pub fn register_shortcut(shortcut: &str) -> Result<(), String> {
    let app_handle = APP.get().unwrap();
    match shortcut {
        "hotkey_selection_translate" => register(
            app_handle,
            "hotkey_selection_translate",
            selection_translate,
            "",
        )?,
        "hotkey_input_translate" => {
            register(app_handle, "hotkey_input_translate", input_translate, "")?
        }
        "hotkey_ocr_recognize" => register(app_handle, "hotkey_ocr_recognize", ocr_recognize, "")?,
        "hotkey_ocr_translate" => register(app_handle, "hotkey_ocr_translate", ocr_translate, "")?,
        "hotkey_capture_region" => {
            register(app_handle, "hotkey_capture_region", capture_region, "")?
        }
        "hotkey_pin_to_screen" => register(app_handle, "hotkey_pin_to_screen", pin_capture, "")?,
        "all" => {
            register(
                app_handle,
                "hotkey_selection_translate",
                selection_translate,
                "",
            )?;
            register(app_handle, "hotkey_input_translate", input_translate, "")?;
            register(app_handle, "hotkey_ocr_recognize", ocr_recognize, "")?;
            register(app_handle, "hotkey_ocr_translate", ocr_translate, "")?;
            register(app_handle, "hotkey_capture_region", capture_region, "")?;
            register(app_handle, "hotkey_pin_to_screen", pin_capture, "")?;
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn register_shortcut_by_frontend(name: &str, shortcut: &str) -> Result<(), String> {
    let app_handle = APP.get().unwrap();
    match name {
        "hotkey_selection_translate" => register(
            app_handle,
            "hotkey_selection_translate",
            selection_translate,
            shortcut,
        )?,
        "hotkey_input_translate" => register(
            app_handle,
            "hotkey_input_translate",
            input_translate,
            shortcut,
        )?,
        "hotkey_ocr_recognize" => {
            register(app_handle, "hotkey_ocr_recognize", ocr_recognize, shortcut)?
        }
        "hotkey_ocr_translate" => {
            register(app_handle, "hotkey_ocr_translate", ocr_translate, shortcut)?
        }
        "hotkey_capture_region" => {
            register(app_handle, "hotkey_capture_region", capture_region, shortcut)?
        }
        "hotkey_pin_to_screen" => {
            register(app_handle, "hotkey_pin_to_screen", pin_capture, shortcut)?
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sharex_defaults_are_reserved() {
        assert!(reserved_shortcut("Alt+1").is_none());
        assert!(reserved_shortcut("Alt+3").is_none());
        assert!(reserved_shortcut("Alt+5").is_none());
        assert!(reserved_shortcut("alt+2").unwrap().contains("Phase 6"));
        assert!(reserved_shortcut("Alt+4").unwrap().contains("Phase 5"));
        assert!(reserved_shortcut("Alt+Q").is_none());
        assert!(reserved_shortcut("Alt+W").is_none());
    }
}
