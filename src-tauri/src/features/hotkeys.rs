use crate::config::get;
use crate::hotkey::register_shortcut;
use serde::Serialize;

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
            id: "capture_region".into(),
            action: "Capture region".into(),
            shortcut: "Alt+1".into(),
            source: "ShareX".into(),
            implemented: false,
            registered: false,
            error: Some("Phase 4".into()),
        },
        HotkeyStatus {
            id: "scrolling_capture".into(),
            action: "Scrolling capture".into(),
            shortcut: "Alt+2".into(),
            source: "ShareX".into(),
            implemented: false,
            registered: false,
            error: Some("Phase 6".into()),
        },
        HotkeyStatus {
            id: "pin_to_screen".into(),
            action: "Pin to screen".into(),
            shortcut: "Alt+3".into(),
            source: "ShareX".into(),
            implemented: false,
            registered: false,
            error: Some("Phase 4".into()),
        },
        HotkeyStatus {
            id: "screen_recording".into(),
            action: "Screen recording".into(),
            shortcut: "Alt+4".into(),
            source: "ShareX".into(),
            implemented: false,
            registered: false,
            error: Some("Phase 5".into()),
        },
        HotkeyStatus {
            id: "ocr_recognise".into(),
            action: "OCR recognise".into(),
            shortcut: "Alt+5".into(),
            source: "ShareX".into(),
            implemented: false,
            registered: false,
            error: Some("Phase 4".into()),
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
    planned_bindings()
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
        for item in bindings.iter().filter(|item| item.source == "ShareX") {
            assert!(!item.implemented);
            assert!(!item.registered);
        }
    }
}
