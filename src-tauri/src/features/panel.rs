use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri::WindowEvent;

use super::json_store::{app_data_dir, read_json, write_json};

const PANEL_SETTINGS_FILE: &str = "panel.json";
const SCHEMA_VERSION: u32 = 1;
const MIN_WINDOW_WIDTH: u32 = 260;
const MIN_WINDOW_HEIGHT: u32 = 320;
const MINIMIZED_WINDOW_POSITION_SENTINEL: i32 = -30000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSettings {
    pub opacity: f64,
    pub always_on_top: bool,
    pub locked: bool,
    pub hover_boost: bool,
    pub window: WindowState,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelSettingsPatch {
    pub opacity: Option<f64>,
    pub always_on_top: Option<bool>,
    pub locked: Option<bool>,
    pub hover_boost: Option<bool>,
    pub window: Option<WindowState>,
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(PANEL_SETTINGS_FILE))
}

fn default_settings() -> PanelSettings {
    PanelSettings {
        opacity: 0.25,
        always_on_top: false,
        locked: false,
        hover_boost: true,
        window: WindowState {
            x: 0,
            y: 0,
            width: 320,
            height: 480,
        },
        schema_version: SCHEMA_VERSION,
    }
}

fn load_settings(app: &AppHandle) -> Result<PanelSettings, String> {
    let path = settings_path(app)?;
    Ok(read_json::<PanelSettings>(&path)?.unwrap_or_else(default_settings))
}

fn save_settings(app: &AppHandle, settings: &PanelSettings) -> Result<(), String> {
    let path = settings_path(app)?;
    write_json(&path, settings)
}

fn validate_window_state(window: WindowState) -> Result<WindowState, String> {
    if window.width < MIN_WINDOW_WIDTH || window.height < MIN_WINDOW_HEIGHT {
        return Err("window size is below minimum".to_string());
    }
    Ok(window)
}

pub(crate) fn apply_settings_to_window(window: &WebviewWindow, settings: &PanelSettings) -> Result<(), String> {
    window
        .set_always_on_top(settings.always_on_top)
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(!settings.locked)
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn is_top_left_minimum_window_snapshot(state: &WindowState) -> bool {
    state.x == 0
        && state.y == 0
        && state.width <= MIN_WINDOW_WIDTH
        && state.height <= MIN_WINDOW_HEIGHT
}

fn is_invalid_window_snapshot(state: &WindowState) -> bool {
    state.x <= MINIMIZED_WINDOW_POSITION_SENTINEL
        || state.y <= MINIMIZED_WINDOW_POSITION_SENTINEL
        || state.width < MIN_WINDOW_WIDTH
        || state.height < MIN_WINDOW_HEIGHT
}

pub(crate) fn should_save_window_snapshot(
    current: &WindowState,
    next: &WindowState,
    is_visible: bool,
    is_minimized: bool,
) -> bool {
    if !is_visible || is_minimized {
        return false;
    }

    if is_invalid_window_snapshot(next) {
        return false;
    }

    if is_top_left_minimum_window_snapshot(next) && !is_top_left_minimum_window_snapshot(current) {
        return false;
    }

    true
}

fn save_window_snapshot(app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
    let size = window.outer_size().map_err(|error| error.to_string())?;
    let position = window.outer_position().map_err(|error| error.to_string())?;
    let mut settings = load_settings(app)?;
    let next_window = WindowState {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let is_visible = window.is_visible().unwrap_or(true);
    let is_minimized = window.is_minimized().unwrap_or(false);

    if !should_save_window_snapshot(&settings.window, &next_window, is_visible, is_minimized) {
        return Ok(());
    }

    settings.window = next_window;
    save_settings(app, &settings)
}

pub(crate) fn clamp_to_monitor(
    state: WindowState,
    monitor_x: i32,
    monitor_y: i32,
    monitor_width: u32,
    monitor_height: u32,
) -> WindowState {
    let titlebar_visible_width = 120;
    let titlebar_visible_height = 34;
    let max_x = monitor_x + monitor_width as i32 - titlebar_visible_width;
    let max_y = monitor_y + monitor_height as i32 - titlebar_visible_height;
    WindowState {
        x: state.x.clamp(monitor_x, max_x.max(monitor_x)),
        y: state.y.clamp(monitor_y, max_y.max(monitor_y)),
        width: state.width.max(MIN_WINDOW_WIDTH),
        height: state.height.max(MIN_WINDOW_HEIGHT),
    }
}

pub fn restore_panel_window(window: &WebviewWindow) -> Result<PanelSettings, String> {
    let app = window.app_handle();
    let settings = load_settings(app)?;
    apply_settings_to_window(window, &settings)?;
    let mut state = settings.window.clone();
    if let Some(monitor) = window
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| window.primary_monitor().ok().flatten())
        .or_else(|| {
            window
                .available_monitors()
                .ok()
                .and_then(|mut monitors| monitors.pop())
        })
    {
        let position = monitor.position();
        let size = monitor.size();
        state = clamp_to_monitor(state, position.x, position.y, size.width, size.height);
    }
    if !is_invalid_window_snapshot(&state) && !is_top_left_minimum_window_snapshot(&state) {
        let _ = window.set_position(tauri::PhysicalPosition::new(state.x, state.y));
        let _ = window.set_size(tauri::PhysicalSize::new(state.width, state.height));
    } else {
        let _ = window.set_size(tauri::LogicalSize::new(320.0, 480.0));
    }
    let _ = window.set_min_size(Some(tauri::LogicalSize::new(
        MIN_WINDOW_WIDTH as f64,
        MIN_WINDOW_HEIGHT as f64,
    )));
    Ok(settings)
}

pub fn attach_panel_lifecycle(window: &WebviewWindow) {
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    window.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Some(panel) = app.get_webview_window(&label) {
                let _ = hide_panel_window(app.clone(), panel);
            }
        }
        WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
            if let Some(panel) = app.get_webview_window(&label) {
                let _ = save_window_snapshot(&app, &panel);
            }
        }
        _ => {}
    });
}

#[tauri::command]
pub fn get_panel_settings(app: AppHandle) -> Result<PanelSettings, String> {
    load_settings(&app)
}

#[tauri::command]
pub fn set_panel_settings(
    app: AppHandle,
    window: WebviewWindow,
    patch: PanelSettingsPatch,
) -> Result<PanelSettings, String> {
    let old_settings = load_settings(&app)?;
    let mut next_settings = old_settings.clone();

    if let Some(opacity) = patch.opacity {
        if !(0.05..=0.85).contains(&opacity) {
            return Err("opacity must be between 0.05 and 0.85".to_string());
        }
        next_settings.opacity = opacity;
    }
    if let Some(always_on_top) = patch.always_on_top {
        next_settings.always_on_top = always_on_top;
    }
    if let Some(locked) = patch.locked {
        next_settings.locked = locked;
    }
    if let Some(hover_boost) = patch.hover_boost {
        next_settings.hover_boost = hover_boost;
    }
    if let Some(window_state) = patch.window {
        next_settings.window = validate_window_state(window_state)?;
    }

    apply_settings_to_window(&window, &next_settings)?;
    if let Err(error) = save_settings(&app, &next_settings) {
        let _ = apply_settings_to_window(&window, &old_settings);
        return Err(error);
    }

    Ok(next_settings)
}

#[tauri::command]
pub fn hide_panel_window(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    save_window_snapshot(&app, &window)?;
    window.hide().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn window_snapshot_rejects_hidden_or_minimized_windows() {
        let current = WindowState {
            x: 1200,
            y: 80,
            width: 360,
            height: 640,
        };
        let next = WindowState {
            x: 1210,
            y: 90,
            width: 370,
            height: 650,
        };

        assert!(!should_save_window_snapshot(&current, &next, false, false));
        assert!(!should_save_window_snapshot(&current, &next, true, true));
    }

    #[test]
    fn window_snapshot_rejects_top_left_minimum_overwrite() {
        let current = WindowState {
            x: 1200,
            y: 80,
            width: 360,
            height: 640,
        };
        let next = WindowState {
            x: 0,
            y: 0,
            width: 260,
            height: 320,
        };

        assert!(!should_save_window_snapshot(&current, &next, true, false));
    }

    #[test]
    fn window_snapshot_rejects_minimized_sentinel_snapshot() {
        let current = WindowState {
            x: 1200,
            y: 80,
            width: 360,
            height: 640,
        };
        let next = WindowState {
            x: -32000,
            y: -32000,
            width: 160,
            height: 28,
        };

        assert!(!should_save_window_snapshot(&current, &next, true, false));
    }

    #[test]
    fn clamp_keeps_titlebar_on_disconnected_monitor_coordinates() {
        let state = WindowState {
            x: -8000,
            y: -4000,
            width: 200,
            height: 200,
        };
        let clamped = clamp_to_monitor(state, 0, 0, 1920, 1080);
        assert_eq!(clamped.x, 0);
        assert_eq!(clamped.y, 0);
        assert!(clamped.width >= MIN_WINDOW_WIDTH);
        assert!(clamped.height >= MIN_WINDOW_HEIGHT);
    }
}
