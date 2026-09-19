use serde_json::json;
use std::fs;
use std::path::PathBuf;
use tauri::AppHandle;

use super::clips::{self, CopyItemsFile};
use super::json_store::read_json;
use super::tasks::{self, TasksFile};

fn desktop_todo_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|dir| dir.join("com.local.desktop-todo"))
}

#[tauri::command]
pub fn has_desktop_todo_data() -> bool {
    desktop_todo_dir()
        .map(|dir| dir.join("tasks.json").exists() || dir.join("copy-items.json").exists())
        .unwrap_or(false)
}

#[tauri::command]
pub fn import_desktop_todo_data(app: AppHandle) -> Result<serde_json::Value, String> {
    let dir = desktop_todo_dir().ok_or("cannot resolve Desktop ToDo config dir")?;
    if !dir.exists() {
        return Err(format!("Desktop ToDo data not found: {}", dir.display()));
    }

    let mut tasks_imported = 0u32;
    if let Some(file) = read_json::<TasksFile>(&dir.join("tasks.json"))? {
        tasks::import_task_list(&app, file.tasks.clone())?;
        tasks_imported = file.tasks.len() as u32;
    }

    let mut clips_imported = 0u32;
    if let Some(file) = read_json::<CopyItemsFile>(&dir.join("copy-items.json"))? {
        clips::import_clip_list(&app, file.items.clone())?;
        clips_imported = file.items.len() as u32;
        let source_assets = dir.join("copy-assets");
        let dest_assets = super::json_store::app_data_dir(&app)?.join("copy-assets");
        if source_assets.exists() {
            copy_dir_all(&source_assets, &dest_assets)?;
        }
    }

    Ok(json!({
        "path": dir.to_string_lossy(),
        "tasks": tasks_imported,
        "clips": clips_imported,
    }))
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(src).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let ty = entry.file_type().map_err(|error| error.to_string())?;
        let dest = dst.join(entry.file_name());
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}
