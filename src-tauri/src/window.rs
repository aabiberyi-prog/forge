#[cfg(target_os = "macos")]
use std::fs;

use crate::config::get;
use crate::config::set;
use crate::StringWrapper;
use crate::APP;
#[cfg(target_os = "macos")]
use dirs::cache_dir;
use log::{info, warn};
use tauri::Monitor;
use tauri::WebviewWindow;
use tauri::WebviewWindowBuilder;
use tauri::{Emitter, Listener, Manager};

// Get daemon window instance
fn get_daemon_window() -> WebviewWindow {
    let app_handle = APP.get().unwrap();
    match app_handle.get_webview_window("daemon") {
        Some(v) => v,
        None => {
            warn!("Daemon window not found, create new daemon window!");
            WebviewWindowBuilder::new(
                app_handle,
                "daemon",
                tauri::WebviewUrl::App("daemon.html".into()),
            )
            .title("Daemon")
            .use_https_scheme(true)
            .visible(false)
            .build()
            .unwrap()
        }
    }
}

// Get monitor where the mouse is currently located
fn get_current_monitor(x: i32, y: i32) -> Monitor {
    info!("Mouse position: {}, {}", x, y);
    let daemon_window = get_daemon_window();
    let monitors = daemon_window.available_monitors().unwrap();

    for m in monitors {
        let size = m.size();
        let position = m.position();

        if x >= position.x
            && x <= (position.x + size.width as i32)
            && y >= position.y
            && y <= (position.y + size.height as i32)
        {
            info!("Current Monitor: {:?}", m);
            return m;
        }
    }
    warn!("Current Monitor not found, using primary monitor");
    daemon_window.primary_monitor().unwrap().unwrap()
}

// Creating a window on the mouse monitor
fn build_window(label: &str, title: &str) -> (WebviewWindow, bool) {
    use mouse_position::mouse_position::{Mouse, Position};

    let mouse_position = match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Position { x, y },
        Mouse::Error => {
            warn!("Mouse position not found, using (0, 0) as default");
            Position { x: 0, y: 0 }
        }
    };
    let current_monitor = get_current_monitor(mouse_position.x, mouse_position.y);
    let position = current_monitor.position();

    let app_handle = APP.get().unwrap();
    match app_handle.get_webview_window(label) {
        Some(v) => {
            info!("WebviewWindow existence: {}", label);
            // Ensure existing windows reappear above Terminal/other apps briefly
            let _ = v.unminimize();
            let _ = v.show();
            let keep_top = label != "panel"
                && !label.starts_with("pin")
                && (match get("translate_always_on_top") {
                    Some(val) => val.as_bool().unwrap_or(false),
                    None => false,
                } || match get("translate_session_pinned") {
                    Some(val) => val.as_bool().unwrap_or(false),
                    None => false,
                });
            let _ = v.set_always_on_top(true);
            let _ = v.set_focus();
            // Restore unpinned unless user/config wants always-on-top
            if keep_top {
                let _ = v.set_always_on_top(true);
            } else if label != "panel" && !label.starts_with("pin") {
                let _ = v.set_always_on_top(false);
            }
            (v, true)
        }
        None => {
            info!(
                "WebviewWindow not existence, Creating new window: {}",
                label
            );
            let mut builder = tauri::WebviewWindowBuilder::new(
                app_handle,
                label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .position(position.x.into(), position.y.into())
            .use_https_scheme(true)
            .focused(true)
            .title(title)
            .visible(false);

            #[cfg(target_os = "macos")]
            {
                builder = builder
                    .title_bar_style(tauri::TitleBarStyle::Overlay)
                    .hidden_title(true);
            }
            #[cfg(not(target_os = "macos"))]
            {
                builder = builder.transparent(true).decorations(false);
            }
            let window = builder.build().unwrap();

            if label != "screenshot" {
                #[cfg(not(target_os = "linux"))]
                window.set_shadow(true).unwrap_or_default();
            }
            // Pot Forge: apply saved window opacity to new windows
            if label != "screenshot" && label != "daemon" && label != "panel" {
                let opacity = match get("window_opacity") {
                    Some(v) => v.as_f64().unwrap_or(0.92),
                    None => 0.92,
                };
                let _ = crate::cmd::apply_opacity_to_window(&window, opacity);
            }
            let _ = window.current_monitor();
            (window, false)
        }
    }
}

pub fn panel_window() {
    let (window, exists) = build_window("panel", "Tasks");
    let _ = window.set_skip_taskbar(true);
    if !exists {
        let _ = crate::features::panel::restore_panel_window(&window);
        crate::features::panel::attach_panel_lifecycle(&window);
    }
    let _ = window.show();
}

pub fn config_window() {
    let (window, _exists) = build_window("config", "Config");
    window
        .set_min_size(Some(tauri::LogicalSize::new(800, 400)))
        .unwrap();
    window.set_size(tauri::LogicalSize::new(800, 600)).unwrap();
    window.center().unwrap();
}

fn translate_window() -> WebviewWindow {
    use mouse_position::mouse_position::{Mouse, Position};
    // Mouse physical position
    let mut mouse_position = match Mouse::get_mouse_position() {
        Mouse::Position { x, y } => Position { x, y },
        Mouse::Error => {
            warn!("Mouse position not found, using (0, 0) as default");
            Position { x: 0, y: 0 }
        }
    };
    let (window, exists) = build_window("translate", "Translate");
    if exists {
        return window;
    }
    window.set_skip_taskbar(true).unwrap();
    // Get Translate WebviewWindow Size
    // Compact defaults: smaller footprint (was 350x420)
    let width = match get("translate_window_width") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            set("translate_window_width", 300);
            300
        }
    };
    let height = match get("translate_window_height") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            set("translate_window_height", 280);
            280
        }
    };

    let monitor = window.current_monitor().unwrap().unwrap();
    let dpi = monitor.scale_factor();

    window
        .set_size(tauri::PhysicalSize::new(
            (width as f64) * dpi,
            (height as f64) * dpi,
        ))
        .unwrap();

    let position_type = match get("translate_window_position") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => "mouse".to_string(),
    };

    match position_type.as_str() {
        "mouse" => {
            // Adjust window position
            let monitor_size = monitor.size();
            let monitor_size_width = monitor_size.width as f64;
            let monitor_size_height = monitor_size.height as f64;
            let monitor_position = monitor.position();
            let monitor_position_x = monitor_position.x as f64;
            let monitor_position_y = monitor_position.y as f64;

            if mouse_position.x as f64 + width as f64 * dpi
                > monitor_position_x + monitor_size_width
            {
                mouse_position.x -= (width as f64 * dpi) as i32;
                if (mouse_position.x as f64) < monitor_position_x {
                    mouse_position.x = monitor_position_x as i32;
                }
            }
            if mouse_position.y as f64 + height as f64 * dpi
                > monitor_position_y + monitor_size_height
            {
                mouse_position.y -= (height as f64 * dpi) as i32;
                if (mouse_position.y as f64) < monitor_position_y {
                    mouse_position.y = monitor_position_y as i32;
                }
            }

            window
                .set_position(tauri::PhysicalPosition::new(
                    mouse_position.x,
                    mouse_position.y,
                ))
                .unwrap();
        }
        _ => {
            let position_x = match get("translate_window_position_x") {
                Some(v) => v.as_i64().unwrap(),
                None => 0,
            };
            let position_y = match get("translate_window_position_y") {
                Some(v) => v.as_i64().unwrap(),
                None => 0,
            };
            window
                .set_position(tauri::PhysicalPosition::new(
                    (position_x as f64) * dpi,
                    (position_y as f64) * dpi,
                ))
                .unwrap();
        }
    }

    window
}

pub fn selection_translate() {
    use selection::get_text;
    // Get Selected Text
    let text = get_text();
    if !text.trim().is_empty() {
        let app_handle = APP.get().unwrap();
        // Write into State
        let state: tauri::State<StringWrapper> = app_handle.state();
        state.0.lock().unwrap().replace_range(.., &text);
    }

    let window = translate_window();
    window.emit_to(window.label(), "new_text", text).unwrap();
}

pub fn input_translate() {
    let app_handle = APP.get().unwrap();
    // Clear State
    let state: tauri::State<StringWrapper> = app_handle.state();
    state
        .0
        .lock()
        .unwrap()
        .replace_range(.., "[INPUT_TRANSLATE]");
    let window = translate_window();
    let position_type = match get("translate_window_position") {
        Some(v) => v.as_str().unwrap().to_string(),
        None => "mouse".to_string(),
    };
    if position_type == "mouse" {
        window.center().unwrap();
    }

    window
        .emit_to(window.label(), "new_text", "[INPUT_TRANSLATE]")
        .unwrap();
}

pub fn text_translate(text: String) {
    let app_handle = APP.get().unwrap();
    // Clear State
    let state: tauri::State<StringWrapper> = app_handle.state();
    state.0.lock().unwrap().replace_range(.., &text);
    let window = translate_window();
    let _ = window.unminimize();
    let _ = window.show();

    // Briefly raise above Terminal/other apps to steal focus, then honor pin/config.
    // Previously this left always-on-top permanently, so "unpin" looked broken.
    let keep_top = match get("translate_always_on_top") {
        Some(v) => v.as_bool().unwrap_or(false),
        None => false,
    } || match get("translate_session_pinned") {
        Some(v) => v.as_bool().unwrap_or(false),
        None => false,
    };

    let _ = window.set_always_on_top(true);
    let _ = window.set_focus();
    if keep_top {
        let _ = window.set_always_on_top(true);
    } else {
        let w = window.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(180));
            let _ = w.set_always_on_top(false);
        });
    }

    window.emit_to(window.label(), "new_text", text).unwrap();
}

pub fn image_translate() {
    let app_handle = APP.get().unwrap();
    let state: tauri::State<StringWrapper> = app_handle.state();
    state
        .0
        .lock()
        .unwrap()
        .replace_range(.., "[IMAGE_TRANSLATE]");
    let window = translate_window();
    window
        .emit_to(window.label(), "new_text", "[IMAGE_TRANSLATE]")
        .unwrap();
}

pub fn recognize_window() {
    let (window, exists) = build_window("recognize", "Recognize");
    if exists {
        window.emit_to(window.label(), "new_image", "").unwrap();
        return;
    }
    let width = match get("recognize_window_width") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            set("recognize_window_width", 800);
            800
        }
    };
    let height = match get("recognize_window_height") {
        Some(v) => v.as_i64().unwrap(),
        None => {
            set("recognize_window_height", 400);
            400
        }
    };
    let monitor = window.current_monitor().unwrap().unwrap();
    let dpi = monitor.scale_factor();
    window
        .set_size(tauri::PhysicalSize::new(
            (width as f64) * dpi,
            (height as f64) * dpi,
        ))
        .unwrap();
    window.center().unwrap();
    window.emit_to(window.label(), "new_image", "").unwrap();
}

#[cfg(not(target_os = "macos"))]
pub fn open_screenshot_window() {
    let _ = screenshot_window();
}

#[cfg(not(target_os = "macos"))]
fn screenshot_window() -> WebviewWindow {
    let (window, _exists) = build_window("screenshot", "Screenshot");

    window.set_skip_taskbar(true).unwrap();
    #[cfg(target_os = "macos")]
    {
        let monitor = window.current_monitor().unwrap().unwrap();
        let size = monitor.size();
        window.set_decorations(false).unwrap();
        window.set_size(*size).unwrap();
    }

    #[cfg(not(target_os = "macos"))]
    window.set_fullscreen(true).unwrap();

    window.set_always_on_top(true).unwrap();
    window
}

pub fn ocr_recognize() {
    #[cfg(target_os = "macos")]
    {
        let app_handle = APP.get().unwrap();
        let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
        app_cache_dir_path.push(&app_handle.config().identifier);
        if !app_cache_dir_path.exists() {
            // 创建目录
            fs::create_dir_all(&app_cache_dir_path).expect("Create Cache Dir Failed");
        }
        app_cache_dir_path.push("pot_screenshot_cut.png");

        let path = app_cache_dir_path.to_string_lossy().replace("\\\\?\\", "");
        println!("Screenshot path: {}", path);
        if let Ok(_output) = std::process::Command::new("/usr/sbin/screencapture")
            .arg("-i")
            .arg("-r")
            .arg(path)
            .output()
        {
            recognize_window();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        crate::features::capture::set_capture_mode("ocr");
        let window = screenshot_window();
        let window_ = window.clone();
        window.listen("success", move |event| {
            recognize_window();
            window_.unlisten(event.id())
        });
    }
}
pub fn ocr_translate() {
    #[cfg(target_os = "macos")]
    {
        let app_handle = APP.get().unwrap();
        let mut app_cache_dir_path = cache_dir().expect("Get Cache Dir Failed");
        app_cache_dir_path.push(&app_handle.config().identifier);
        if !app_cache_dir_path.exists() {
            // 创建目录
            fs::create_dir_all(&app_cache_dir_path).expect("Create Cache Dir Failed");
        }
        app_cache_dir_path.push("pot_screenshot_cut.png");

        let path = app_cache_dir_path.to_string_lossy().replace("\\\\?\\", "");
        println!("Screenshot path: {}", path);
        if let Ok(_output) = std::process::Command::new("/usr/sbin/screencapture")
            .arg("-i")
            .arg("-r")
            .arg(path)
            .output()
        {
            image_translate();
            ();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        crate::features::capture::set_capture_mode("ocr");
        let window = screenshot_window();
        let window_ = window.clone();
        window.listen("success", move |event| {
            image_translate();
            window_.unlisten(event.id())
        });
    }
}

pub fn capture_region() {
    crate::features::capture::set_capture_mode("save");
    let _ = screenshot_window();
}

pub fn pin_capture() {
    crate::features::capture::set_capture_mode("pin");
    let _ = screenshot_window();
}

pub fn pin_window() {
    if let Some(app) = crate::APP.get() {
        if crate::features::pins::pin_from_capture_cache(app).is_ok() {
            return;
        }
    }
    open_named_pin("pin-1");
}

pub fn open_named_pin(label: &str) {
    let (window, _exists) = build_window(label, "Pin");
    let _ = window.set_skip_taskbar(true);
    let _ = window.set_always_on_top(true);
    let _ = window.set_resizable(true);
    let _ = window.show();
}

pub fn open_pin_history() {
    let (window, _exists) = build_window("pin-history", "Pin from history");
    let _ = window.set_skip_taskbar(false);
    let _ = window.set_always_on_top(true);
    let _ = window.set_size(tauri::LogicalSize::new(420.0, 520.0));
    let _ = window.center();
    let _ = window.show();
}

#[tauri::command(async)]
pub fn updater_window() {
    let (window, _exists) = build_window("updater", "Updater");
    window
        .set_min_size(Some(tauri::LogicalSize::new(600, 400)))
        .unwrap();
    window.set_size(tauri::LogicalSize::new(600, 400)).unwrap();
    window.center().unwrap();
}
