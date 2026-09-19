// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backup;
mod clipboard;
mod cmd;
mod config;
mod error;
mod features;
mod hotkey;
mod lang_detect;
mod platform;
mod screenshot;
mod selection_helper;
mod server;
mod system_ocr;
mod tray;
mod updater;
mod window;

use backup::*;
use clipboard::*;
use cmd::*;
use config::*;
use features::capture::*;
use features::clips::*;
use features::recorder::*;
use features::scroll::*;
use features::hotkeys::*;
use features::import_todo::*;
use features::panel::*;
use features::pins::*;
use features::secrets::*;
use features::tasks::*;
use hotkey::*;
use lang_detect::*;
use log::info;
use once_cell::sync::OnceCell;
use screenshot::screenshot;
use server::*;
use std::sync::Mutex;
use system_ocr::*;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_notification::NotificationExt;
use tray::*;
use updater::check_update;
use window::config_window;
use window::updater_window;

// Global AppHandle
pub static APP: OnceCell<tauri::AppHandle> = OnceCell::new();

// Text to be translated
pub struct StringWrapper(pub Mutex<String>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_single_instance::init(|app, _, cwd| {
            app.notification()
                .builder()
                .title("The program is already running. Please do not start it again!")
                .body(cwd)
                .icon("pot")
                .show()
                .unwrap_or_else(|error| log::warn!("Single-instance notification failed: {error}"));
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .targets([
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Stdout),
                ])
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .setup(|app| {
            info!("============== Start App ==============");
            #[cfg(target_os = "macos")]
            {
                app.set_activation_policy(tauri::ActivationPolicy::Accessory);
                let trusted =
                    macos_accessibility_client::accessibility::application_is_trusted_with_prompt();
                info!("MacOS Accessibility Trusted: {}", trusted);
            }
            // Global AppHandle
            APP.get_or_init(|| app.handle().clone());
            // Init Config
            info!("Init Config Store");
            init_config(app);
            if let Err(error) = crate::features::db::init_schema(app.handle()) {
                log::warn!("Forge database init failed: {error}");
            }
            if let Err(error) = crate::features::tasks::migrate_json_tasks(app.handle()) {
                log::warn!("Task JSON migration failed: {error}");
            }
            if let Err(error) = crate::features::clips::migrate_json_clips(app.handle()) {
                log::warn!("Clip JSON migration failed: {error}");
            }
            match crate::features::secrets::migrate_plaintext_secrets(app.handle()) {
                Ok(count) if count > 0 => info!("Moved {count} API keys into the OS keychain"),
                Ok(_) => {}
                Err(error) => log::warn!("Secret migration failed: {error}"),
            }
            // Check First Run
            if is_first_run() {
                // Open Config Window
                info!("First Run, opening config window");
                config_window();
            }
            app.manage(StringWrapper(Mutex::new("".to_string())));
            // Update Tray Menu
            init_tray(app)?;
            update_tray(app.handle().clone(), "".to_string(), "".to_string());
            // Start http server
            start_server();
            // Register Global Shortcut
            crate::features::capture::ensure_capture_hotkey_defaults();
            crate::features::recorder::ensure_recording_hotkey_default();
            if crate::config::get("hotkey_scrolling_capture")
                .and_then(|value| value.as_str().map(str::to_owned))
                .unwrap_or_default()
                .is_empty()
            {
                crate::config::set("hotkey_scrolling_capture", "Alt+2");
            }
            match register_shortcut("all") {
                Ok(()) => {}
                Err(e) => app
                    .notification()
                    .builder()
                    .title("Failed to register global shortcut")
                    .body(&e)
                    .icon("pot")
                    .show()
                    .unwrap_or_else(|error| log::warn!("Shortcut notification failed: {error}")),
            }
            match get("proxy_enable") {
                Some(v) => {
                    if v.as_bool().unwrap()
                        && get("proxy_host")
                            .map_or(false, |host| !host.as_str().unwrap().is_empty())
                    {
                        let _ = set_proxy();
                    }
                }
                None => {}
            }
            // Check Update
            check_update(app.handle().clone());
            if let Some(engine) = get("translate_detect_engine") {
                if engine.as_str().unwrap() == "local" {
                    init_lang_detect();
                }
            }
            let clipboard_monitor = match get("clipboard_monitor") {
                Some(v) => v.as_bool().unwrap(),
                None => {
                    set("clipboard_monitor", false);
                    false
                }
            };
            app.manage(ClipboardMonitorEnableWrapper(Mutex::new(
                clipboard_monitor.to_string(),
            )));
            start_clipboard_monitor(app.handle().clone());
            // Headless Alt+Q / Terminal shift-select helper (no extra tray icon)
            selection_helper::start_selection_helper();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            reload_store,
            get_text,
            cut_image,
            get_base64,
            copy_img,
            system_ocr,
            set_proxy,
            unset_proxy,
            run_binary,
            open_devtools,
            register_shortcut_by_frontend,
            update_tray,
            updater_window,
            screenshot,
            lang_detect,
            webdav,
            local,
            install_plugin,
            font_list,
            aliyun,
            set_window_opacity,
            get_window_opacity,
            edge_tts_synthesize,
            has_official_pot_config,
            import_official_pot_config,
            list_tasks,
            list_history_tasks,
            create_task,
            update_task,
            delete_task,
            restore_task,
            clear_completed_tasks,
            reorder_tasks,
            list_copy_items,
            get_copy_item,
            create_copy_item,
            update_copy_item,
            delete_copy_item,
            reorder_copy_items,
            get_copy_payload,
            copy_image_files_to_clipboard,
            get_panel_settings,
            set_panel_settings,
            hide_panel_window,
            get_capture_mode,
            finish_capture,
            retry_capture_copy,
            recording_status,
            toggle_screen_recording,
            scrolling_capture,
            cancel_scrolling_capture,
            scroll_capture_available,
            open_pin_from_path,
            pin_from_clipboard,
            get_pin_path,
            copy_pin_image,
            list_pin_history,
            open_pin_history_window,
            secret_get,
            secret_set,
            list_hotkey_registry,
            has_desktop_todo_data,
            preview_desktop_todo_import,
            import_desktop_todo_data
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        // 窗口关闭不退出
        .run(|_app_handle, event| match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                api.prevent_exit();
            }
            tauri::RunEvent::Exit => {
                crate::features::recorder::finalize_recording_on_quit();
                selection_helper::stop_selection_helper();
            }
            _ => {}
        });
}
