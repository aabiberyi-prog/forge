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
            id: "hotkey_input_translate".into(),
            action: "Input translate".into(),
            shortcut: configured("hotkey_input_translate", ""),
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

pub fn register_implemented() -> Vec<HotkeyStatus> {
    register_bindings(planned_bindings(), register_shortcut)
}

fn register_bindings(mut result: Vec<HotkeyStatus>, mut register: impl FnMut(&str) -> Result<(), String>) -> Vec<HotkeyStatus> {
    for index in 0..result.len() {
        if !result[index].implemented || result[index].shortcut.is_empty() {
            continue;
        }
        if let Some(error) = conflict_error(&result, &result[index]) {
            result[index].error = Some(error);
            continue;
        }
        match register(&result[index].id) {
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
    let app = APP.get();
    for index in 0..items.len() {
        if items[index].shortcut.is_empty() {
            items[index].registered = false;
            items[index].error = Some("disabled".into());
            continue;
        }
        let conflict = items.iter().enumerate().find_map(|(other_index, other)| {
            if other_index != index
                && !other.shortcut.is_empty()
                && other.shortcut.eq_ignore_ascii_case(&items[index].shortcut)
            {
                Some(format!(
                    "conflicts with {} ({})",
                    other.action, other.shortcut
                ))
            } else {
                None
            }
        });
        if let Some(error) = conflict {
            items[index].registered = false;
            items[index].error = Some(error);
            continue;
        }
        if let Some(app) = app {
            items[index].registered = app
                .global_shortcut()
                .is_registered(items[index].shortcut.as_str());
            if items[index].registered {
                items[index].error = None;
            } else if items[index].implemented {
                items[index].error = Some("not registered".into());
            }
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn startup_registration_continues_after_one_binding_fails() {
        let mut bindings = planned_bindings();
        for (index, item) in bindings.iter_mut().enumerate() { item.implemented = true; item.shortcut = format!("Alt+{}", index + 1); }
        let mut calls = 0;
        let result = register_bindings(bindings, |_| { calls += 1; if calls == 1 { Err("occupied".into()) } else { Ok(()) } });
        assert_eq!(calls, 8);
        assert!(!result[0].registered);
        assert!(result[1..].iter().all(|item| item.registered));
    }

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

    #[test]
    fn eight_configured_actions_have_status_rows() {
        let bindings = planned_bindings();
        let ids: Vec<&str> = bindings.iter().map(|item| item.id.as_str()).collect();
        for id in [
            "hotkey_selection_translate",
            "hotkey_input_translate",
            "hotkey_ocr_recognize",
            "hotkey_ocr_translate",
            "hotkey_capture_region",
            "hotkey_pin_to_screen",
            "hotkey_screen_recording",
            "hotkey_scrolling_capture",
        ] {
            assert!(ids.contains(&id), "missing {id}");
        }
        assert_eq!(ids.len(), 8);
    }
}
