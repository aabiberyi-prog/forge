use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::AppHandle;

use super::db;
use super::json_store::{app_data_dir, read_json, timestamp};

const TASKS_FILE: &str = "tasks.json";
#[allow(dead_code)]
const SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub done: bool,
    pub order: i32,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archived_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskPatch {
    pub id: String,
    pub title: Option<String>,
    pub done: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TasksFile {
    pub schema_version: u32,
    pub tasks: Vec<Task>,
}

fn load_json_tasks(app: &AppHandle) -> Result<Vec<Task>, String> {
    let path = app_data_dir(app)?.join(TASKS_FILE);
    Ok(read_json::<TasksFile>(&path)?
        .map(|file| file.tasks)
        .unwrap_or_default())
}

pub fn migrate_json_tasks(app: &AppHandle) -> Result<(), String> {
    let conn = db::open(app)?;
    if db::meta_get(&conn, "tasks_migrated")?.as_deref() == Some("1") {
        return Ok(());
    }
    let tasks = load_json_tasks(app)?;
    if !tasks.is_empty() {
        save_tasks(app, &tasks)?;
    }
    db::meta_set(&conn, "tasks_migrated", "1")
}

fn load_tasks(app: &AppHandle) -> Result<Vec<Task>, String> {
    migrate_json_tasks(app)?;
    let conn = db::open(app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, done, order_index, created_at, updated_at, completed_at, archived_at, deleted_at FROM tasks",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                done: row.get::<_, i64>(2)? != 0,
                order: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
                completed_at: row.get(6)?,
                archived_at: row.get(7)?,
                deleted_at: row.get(8)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut tasks = Vec::new();
    for row in rows {
        tasks.push(row.map_err(|error| error.to_string())?);
    }
    Ok(tasks)
}

fn save_tasks(app: &AppHandle, tasks: &[Task]) -> Result<(), String> {
    let mut conn = db::open(app)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute("DELETE FROM tasks", [])
        .map_err(|error| error.to_string())?;
    {
        let mut stmt = tx
            .prepare(
                "INSERT INTO tasks(id, title, done, order_index, created_at, updated_at, completed_at, archived_at, deleted_at)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            )
            .map_err(|error| error.to_string())?;
        for task in tasks {
            stmt.execute(params![
                task.id,
                task.title,
                if task.done { 1 } else { 0 },
                task.order,
                task.created_at,
                task.updated_at,
                task.completed_at,
                task.archived_at,
                task.deleted_at,
            ])
            .map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

fn next_id() -> String {
    format!("task-{}", timestamp())
}

fn validate_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 200 {
        return Err("title length must be 1-200".to_string());
    }
    Ok(title.to_string())
}

fn is_active_task(task: &Task) -> bool {
    task.archived_at.is_none() && task.deleted_at.is_none()
}

fn is_history_task(task: &Task) -> bool {
    task.done || task.archived_at.is_some() || task.deleted_at.is_some()
}

#[tauri::command]
pub fn list_tasks(app: AppHandle) -> Result<Vec<Task>, String> {
    let mut tasks: Vec<Task> = load_tasks(&app)?
        .into_iter()
        .filter(is_active_task)
        .collect();
    tasks.sort_by_key(|task| task.order);
    Ok(tasks)
}

#[tauri::command]
pub fn list_history_tasks(app: AppHandle) -> Result<Vec<Task>, String> {
    let mut tasks: Vec<Task> = load_tasks(&app)?
        .into_iter()
        .filter(is_history_task)
        .collect();
    tasks.sort_by_key(|task| task.order);
    Ok(tasks)
}

#[tauri::command]
pub fn create_task(app: AppHandle, title: String) -> Result<Task, String> {
    let mut tasks = load_tasks(&app)?;
    let now = timestamp();
    let order = tasks
        .iter()
        .filter(|task| is_active_task(task))
        .map(|task| task.order)
        .max()
        .unwrap_or(-1)
        + 1;
    let task = Task {
        id: next_id(),
        title: validate_title(&title)?,
        done: false,
        order,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        archived_at: None,
        deleted_at: None,
    };

    tasks.push(task.clone());
    save_tasks(&app, &tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn update_task(app: AppHandle, patch: TaskPatch) -> Result<Task, String> {
    let mut tasks = load_tasks(&app)?;
    let Some(index) = tasks
        .iter()
        .position(|task| task.id == patch.id && is_active_task(task))
    else {
        return Err(format!("task not found: {}", patch.id));
    };
    let now = timestamp();

    if let Some(title) = patch.title {
        tasks[index].title = validate_title(&title)?;
    }

    if let Some(done) = patch.done {
        tasks[index].done = done;
        if done && tasks[index].completed_at.is_none() {
            tasks[index].completed_at = Some(now.clone());
        }
        if !done {
            tasks[index].completed_at = None;
        }
    }

    tasks[index].updated_at = now;
    let task = tasks[index].clone();
    save_tasks(&app, &tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, id: String) -> Result<Task, String> {
    let mut tasks = load_tasks(&app)?;
    let Some(index) = tasks
        .iter()
        .position(|task| task.id == id && is_active_task(task))
    else {
        return Err(format!("task not found: {}", id));
    };

    let now = timestamp();
    tasks[index].deleted_at = Some(now.clone());
    tasks[index].updated_at = now;
    let task = tasks[index].clone();
    save_tasks(&app, &tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn clear_completed_tasks(app: AppHandle) -> Result<Vec<Task>, String> {
    let mut tasks = load_tasks(&app)?;
    let now = timestamp();
    let mut changed = false;

    for task in tasks
        .iter_mut()
        .filter(|task| is_active_task(task) && task.done)
    {
        task.archived_at = Some(now.clone());
        task.updated_at = now.clone();
        changed = true;
    }

    if changed {
        save_tasks(&app, &tasks)?;
    }

    let mut active_tasks: Vec<Task> = tasks.into_iter().filter(is_active_task).collect();
    active_tasks.sort_by_key(|task| task.order);
    Ok(active_tasks)
}

#[tauri::command]
pub fn reorder_tasks(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let mut tasks = load_tasks(&app)?;
    let active_ids: HashSet<String> = tasks
        .iter()
        .filter(|task| is_active_task(task))
        .map(|task| task.id.clone())
        .collect();

    if ids.len() != active_ids.len() {
        return Err("reorder ids must contain the exact current task set".to_string());
    }

    let mut seen = HashSet::new();
    for id in &ids {
        if !active_ids.contains(id) {
            return Err(format!("unknown task id: {}", id));
        }
        if !seen.insert(id.as_str()) {
            return Err(format!("duplicate task id: {}", id));
        }
    }

    for (order, id) in ids.iter().enumerate() {
        if let Some(task) = tasks.iter_mut().find(|task| task.id == *id) {
            task.order = order as i32;
        }
    }

    save_tasks(&app, &tasks)
}
