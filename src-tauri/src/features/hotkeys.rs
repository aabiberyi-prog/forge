use crate::config::get;
use crate::hotkey::register_shortcut;
use crate::APP;
use serde::Serialize;
use tauri_plugin_global_shortcut::GlobalShortcutExt;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub id: String,
    pub action: String,
    pub shortcut: String,
    pub source: String,
    pub implemented: bool,
    pub registered: bool,
    pub error: Option<String>,
}

fn configured(name: &str, fallback: &str) -> String {
    if crate::APP.get().is_none() {
        return fallback.to_string();
    }
    get(name)
        .and_then(|value| value.as_str().map(str::to_owned))
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

pub fn planned_bindings() -> Vec<HotkeyStatus> {
    vec![
        HotkeyStatus {
            id: "hotkey_capture_region".into(),
            action: "Capture region".into(),
            shortcut: configured("hotkey_capture_region", "Alt+1"),
            source: "ShareX".into(),
            implemented: true,
            registered: false,
            error: None,
        },
        HotkeyStatus {
            id: "hotkey_scrolling_capture".into(),
            action: "Scrolling capture".into(),
            shortcut: configured("hotkey_scrolling_capture", "Alt+2"),
            source: "ShareX".into(),
            implemented: cfg!(windows),
            registered: false,
            error: if cfg!(windows) {
                None
            } else {
                Some("Windows-only".into())
            },
        },
        HotkeyStatus {
            id: "hotkey_pin_to_screen".into(),
            action: "Pin to screen".into(),
            shortcut: configured("hotkey_pin_to_screen", "Alt+3"),
            source: "ShareX".into(),
            implemented: true,
            registered: false,
            error: None,
        },
        HotkeyStatus {
            id: "hotkey_screen_recording".into(),
            action: "Screen recording".into(),
            shortcut: configured("hotkey_screen_recording", "Alt+4"),
            source: "ShareX".into(),
            implemented: true,
            registered: false,
            error: None,
        },
        HotkeyStatus {
            id: "hotkey_ocr_recognize".into(),
            action: "OCR recognise".into(),
            shortcut: configured("hotkey_ocr_recognize", "Alt+5"),
            source: "ShareX".into(),
            implemented: true,
            registered: false,
            error: None,
        },
        HotkeyStatus {
            id: "hotkey_ocr_translate".into(),
            action: "OCR translate".into(),
            shortcut: configured("hotkey_ocr_translate", "Alt+W"),
            source: "Pot".into(),
            implemented: true,
            registered: false,
            error: None,
        },
        HotkeyStatus {
            id: "hotkey_selection_translate".into(),
            action: "Selection translate".into(),
            shortcut: configured("hotkey_selection_translate", "Alt+Q"),
            source: "pot-forge".into(),
            implemented: true,
            registered: false,
            error: None,
        },
    ]
}

fn conflict_error(bindings: &[HotkeyStatus], candidate: &HotkeyStatus) -> Option<String> {
    bindings.iter().find_map(|existing| {
        if existing.id != candidate.id
            && existing.registered
            && !existing.shortcut.is_empty()
            && existing.shortcut == candidate.shortcut
        {
            Some(format!(
                "conflicts with {} ({})",
                existing.action, existing.shortcut
            ))
        } else {
            None
        }
    })
}

#[allow(dead_code)]
pub fn register_implemented() -> Vec<HotkeyStatus> {
    let mut result = planned_bindings();
    for index in 0..result.len() {
        if !result[index].implemented {
            continue;
        }
        if let Some(error) = conflict_error(&result, &result[index]) {
            result[index].error = Some(error);
            continue;
        }
        match register_shortcut(&result[index].id) {
            Ok(()) => {
                result[index].registered = true;
                result[index].error = None;
            }
            Err(error) => {
                result[index].registered = false;
                result[index].error = Some(error);
            }
        }
    }
    result
}

#[tauri::command]
pub fn list_hotkey_registry() -> Vec<HotkeyStatus> {
    let mut items = planned_bindings();
    if let Some(app) = APP.get() {
        for item in items
            .iter_mut()
            .filter(|item| item.implemented && !item.shortcut.is_empty())
        {
            item.registered = app.global_shortcut().is_registered(item.shortcut.as_str());
            if item.registered {
                item.error = None;
            }
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duplicate_shortcuts_are_conflicts() {
        let mut bindings = planned_bindings();
        bindings[5].registered = true;
        bindings[5].shortcut = "Alt+Q".into();
        let candidate = HotkeyStatus {
            id: "other".into(),
            action: "Other".into(),
            shortcut: "Alt+Q".into(),
            source: "test".into(),
            implemented: true,
            registered: false,
            error: None,
        };
        let error = conflict_error(&bindings, &candidate).unwrap();
        assert!(error.contains("Alt+Q"));
    }

    #[test]
    fn sharex_defaults_are_not_registered_yet() {
        let bindings = planned_bindings();
        let scroll = bindings
            .iter()
            .find(|item| item.id == "hotkey_scrolling_capture")
            .unwrap();
        assert_eq!(scroll.implemented, cfg!(windows));
        let capture = bindings
            .iter()
            .find(|item| item.id == "hotkey_capture_region")
            .unwrap();
        assert!(capture.implemented);
    }
}
