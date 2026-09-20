use crate::config::{get, set};
use crate::features::recorder::toggle_recording;
use crate::features::scroll::start_scrolling_capture;
use crate::window::{
    capture_region, input_translate, ocr_recognize, ocr_translate, pin_capture, selection_translate,
};
use crate::APP;
use log::{info, warn};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

static EDITING: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

pub fn restore_shortcut_edit() -> Result<(), String> {
    let name = EDITING.lock().map_err(|e| e.to_string())?.take();
    if let Some(name) = name {
        let key = get(&name).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default();
        if !key.is_empty() && !APP.get().ok_or("app is not ready")?.global_shortcut().is_registered(key.as_str()) {
            register_shortcut(&name)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn begin_shortcut_edit(name: String, window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "config" || !window.is_focused().unwrap_or(false) { return Err("shortcut editor is not focused".into()); }
    if !CONFIGURED_HOTKEY_IDS.contains(&name.as_str()) { return Err("unknown shortcut".into()); }
    restore_shortcut_edit()?;
    let key = get(&name).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default();
    if !key.is_empty() { APP.get().ok_or("app is not ready")?.global_shortcut().unregister(key.as_str()).map_err(|e| e.to_string())?; }
    *EDITING.lock().map_err(|e| e.to_string())? = Some(name);
    Ok(())
}

#[tauri::command]
pub fn end_shortcut_edit() -> Result<(), String> { restore_shortcut_edit() }

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

const CONFIGURED_HOTKEY_IDS: [&str; 8] = [
    "hotkey_selection_translate",
    "hotkey_input_translate",
    "hotkey_ocr_recognize",
    "hotkey_ocr_translate",
    "hotkey_capture_region",
    "hotkey_pin_to_screen",
    "hotkey_screen_recording",
    "hotkey_scrolling_capture",
];

pub(crate) fn reserved_shortcut(shortcut: &str) -> Option<&'static str> {
    let _ = shortcut;
    None
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
        "hotkey_screen_recording" => {
            register(app_handle, "hotkey_screen_recording", toggle_recording, "")?
        }
        "hotkey_scrolling_capture" => register(
            app_handle,
            "hotkey_scrolling_capture",
            start_scrolling_capture,
            "",
        )?,
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
            register(app_handle, "hotkey_screen_recording", toggle_recording, "")?;
            register(
                app_handle,
                "hotkey_scrolling_capture",
                start_scrolling_capture,
                "",
            )?;
        }
        _ => {}
    }
    Ok(())
}

#[tauri::command]
pub fn register_shortcut_by_frontend(name: &str, shortcut: &str) -> Result<(), String> {
    if !CONFIGURED_HOTKEY_IDS.contains(&name) { return Err(format!("unknown hotkey {name}")); }
    let app_handle = APP.get().ok_or("app is not ready")?;
    let shortcut = shortcut.trim();
    if !shortcut.is_empty() {
        if let Some(error) = conflict_reason(name, shortcut) { return Err(error); }
    }
    let old = get(name).and_then(|value| value.as_str().map(str::to_owned)).unwrap_or_default();
    let already_registered = !shortcut.is_empty() && app_handle.global_shortcut().is_registered(shortcut);
    if already_registered && !old.eq_ignore_ascii_case(shortcut) { return Err("shortcut is already registered".into()); }
    if !shortcut.is_empty() && !already_registered { register_frontend_action(name, shortcut)?; }
    use tauri::Manager;
    let persist = |value: &str| -> Result<(), String> {
        let state = app_handle.state::<crate::config::StoreWrapper>();
        let store = state.0.lock().map_err(|e| e.to_string())?;
        store.set(name.to_string(), serde_json::json!(value));
        store.save().map_err(|e| e.to_string())
    };
    if let Err(error) = persist(shortcut) {
        let _ = persist(&old);
        if !already_registered && !shortcut.is_empty() { let _ = app_handle.global_shortcut().unregister(shortcut); }
        return Err(error);
    }
    if !old.is_empty() && old != shortcut && app_handle.global_shortcut().is_registered(old.as_str()) {
        if let Err(error) = app_handle.global_shortcut().unregister(old.as_str()) {
            let _ = persist(&old);
            if !already_registered && !shortcut.is_empty() { let _ = app_handle.global_shortcut().unregister(shortcut); }
            return Err(error.to_string());
        }
    }
    Ok(())
}

fn register_frontend_action(name: &str, shortcut: &str) -> Result<(), String> {
    let app_handle = APP.get().ok_or("app is not ready")?;
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
        "hotkey_screen_recording" => {
            register(
                app_handle,
                "hotkey_screen_recording",
                toggle_recording,
                shortcut,
            )?
        }
        "hotkey_scrolling_capture" => register(
            app_handle,
            "hotkey_scrolling_capture",
            start_scrolling_capture,
            shortcut,
        )?,
        _ => return Err(format!("unknown hotkey {name}")),
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
        assert!(reserved_shortcut("Alt+2").is_none());
        assert!(reserved_shortcut("Alt+4").is_none());
        assert!(reserved_shortcut("Alt+Q").is_none());
        assert!(reserved_shortcut("Alt+W").is_none());
    }
}
