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

#[derive(Debug, Clone, Serialize)]
pub struct TaskEvent {
    pub event: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HistoryTask {
    #[serde(flatten)]
    pub task: Task,
    pub events: Vec<TaskEvent>,
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
    db::init_schema_on(&conn)?;
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
    db::init_schema_on(&conn)?;
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

fn task_from_row(row: &rusqlite::Row) -> rusqlite::Result<Task> {
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
}

fn get_task(conn: &rusqlite::Connection, id: &str) -> Result<Option<Task>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, done, order_index, created_at, updated_at, completed_at, archived_at, deleted_at FROM tasks WHERE id = ?1",
        )
        .map_err(|error| error.to_string())?;
    let mut rows = stmt
        .query(params![id])
        .map_err(|error| error.to_string())?;
    match rows.next().map_err(|error| error.to_string())? {
        Some(row) => Ok(Some(task_from_row(row).map_err(|error| error.to_string())?)),
        None => Ok(None),
    }
}

fn upsert_task(conn: &rusqlite::Connection, task: &Task) -> Result<(), String> {
    conn.execute(
        "INSERT INTO tasks(id, title, done, order_index, created_at, updated_at, completed_at, archived_at, deleted_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
         ON CONFLICT(id) DO UPDATE SET
            title=excluded.title,
            done=excluded.done,
            order_index=excluded.order_index,
            created_at=excluded.created_at,
            updated_at=excluded.updated_at,
            completed_at=excluded.completed_at,
            archived_at=excluded.archived_at,
            deleted_at=excluded.deleted_at",
        params![
            task.id,
            task.title,
            if task.done { 1 } else { 0 },
            task.order,
            task.created_at,
            task.updated_at,
            task.completed_at,
            task.archived_at,
            task.deleted_at,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn insert_event(conn: &rusqlite::Connection, task_id: &str, event: &str, at: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO task_events(task_id, event, at) SELECT ?1,?2,?3
         WHERE NOT EXISTS(SELECT 1 FROM task_events WHERE task_id=?1 AND event=?2 AND at=?3)",
        params![task_id, event, at],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn preserve_task_events(conn: &rusqlite::Connection, task: &Task) -> Result<(), String> {
    for (event, at) in [("completed", &task.completed_at), ("archived", &task.archived_at), ("deleted", &task.deleted_at)] {
        if let Some(at) = at { insert_event(conn, &task.id, event, at)?; }
    }
    Ok(())
}

pub(crate) fn history_tasks_on(conn: &rusqlite::Connection) -> Result<Vec<HistoryTask>, String> {
    let mut stmt = conn.prepare(
        "SELECT id,title,done,order_index,created_at,updated_at,completed_at,archived_at,deleted_at FROM tasks t
         WHERE done=1 OR archived_at IS NOT NULL OR deleted_at IS NOT NULL
         OR EXISTS(SELECT 1 FROM task_events e WHERE e.task_id=t.id)"
    ).map_err(|e| e.to_string())?;
    let tasks = stmt.query_map([], task_from_row).map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
    let mut history = Vec::new();
    for task in tasks {
        let mut stmt = conn.prepare("SELECT event,at FROM task_events WHERE task_id=?1 ORDER BY CAST(at AS INTEGER) DESC,id DESC").map_err(|e| e.to_string())?;
        let events = stmt.query_map([&task.id], |row| Ok(TaskEvent { event: row.get(0)?, at: row.get(1)? }))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        history.push(HistoryTask { task, events });
    }
    Ok(history)
}

fn max_active_order(conn: &rusqlite::Connection) -> Result<i32, String> {
    let order: Option<i32> = conn
        .query_row(
            "SELECT MAX(order_index) FROM tasks WHERE archived_at IS NULL AND deleted_at IS NULL",
            [],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    Ok(order.unwrap_or(-1))
}

pub fn title_matches(title: &str, query: &str) -> bool {
    let query = query.trim();
    if query.is_empty() {
        return true;
    }
    title.to_lowercase().contains(&query.to_lowercase())
}

pub fn restore_task_on(conn: &rusqlite::Connection, id: &str) -> Result<Task, String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut task = get_task(&tx, id)?.ok_or_else(|| format!("task not found: {id}"))?;
    if is_active_task(&task) && !task.done {
        return Ok(task);
    }
    let now = timestamp();
    preserve_task_events(&tx, &task)?;
    insert_event(&tx, &task.id, "restored", &now)?;
    if !is_active_task(&task) {
        task.order = max_active_order(&tx)? + 1;
    }
    task.done = false;
    task.completed_at = None;
    task.archived_at = None;
    task.deleted_at = None;
    task.updated_at = now;
    upsert_task(&tx, &task)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(task)
}

fn next_id() -> String {
    format!("task-{}", super::json_store::unique_stamp())
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
pub fn list_history_tasks(app: AppHandle) -> Result<Vec<HistoryTask>, String> {
    migrate_json_tasks(&app)?;
    let conn = db::open(&app)?;
    db::init_schema_on(&conn)?;
    history_tasks_on(&conn)
}

#[tauri::command]
pub fn create_task(app: AppHandle, title: String) -> Result<Task, String> {
    let _guard = db::lock_data()?;
    migrate_json_tasks(&app)?;
    let conn = db::open(&app)?;
    db::init_schema_on(&conn)?;
    let now = timestamp();
    let task = Task {
        id: next_id(),
        title: validate_title(&title)?,
        done: false,
        order: max_active_order(&conn)? + 1,
        created_at: now.clone(),
        updated_at: now,
        completed_at: None,
        archived_at: None,
        deleted_at: None,
    };
    upsert_task(&conn, &task)?;
    Ok(task)
}

#[tauri::command]
pub fn update_task(app: AppHandle, patch: TaskPatch) -> Result<Task, String> {
    let _guard = db::lock_data()?;
    migrate_json_tasks(&app)?;
    let conn = db::open(&app)?;
    db::init_schema_on(&conn)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut task = get_task(&tx, &patch.id)?
        .filter(is_active_task)
        .ok_or_else(|| format!("task not found: {}", patch.id))?;
    let now = timestamp();

    preserve_task_events(&tx, &task)?;

    if let Some(title) = patch.title {
        task.title = validate_title(&title)?;
    }

    if let Some(done) = patch.done {
        let was_done = task.done;
        task.done = done;
        if done && !was_done {
            task.completed_at = Some(now.clone());
            insert_event(&tx, &task.id, "completed", &now)?;
        }
        if !done {
            task.completed_at = None;
            if was_done { insert_event(&tx, &task.id, "restored", &now)?; }
        }
    }

    task.updated_at = now;
    upsert_task(&tx, &task)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, id: String) -> Result<Task, String> {
    let _guard = db::lock_data()?;
    migrate_json_tasks(&app)?;
    let conn = db::open(&app)?;
    db::init_schema_on(&conn)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    let mut task = get_task(&tx, &id)?
        .filter(is_active_task)
        .ok_or_else(|| format!("task not found: {id}"))?;
    let now = timestamp();
    preserve_task_events(&tx, &task)?;
    task.deleted_at = Some(now.clone());
    task.updated_at = now.clone();
    insert_event(&tx, &task.id, "deleted", &now)?;
    upsert_task(&tx, &task)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(task)
}

#[tauri::command]
pub fn restore_task(app: AppHandle, id: String) -> Result<Task, String> {
    let _guard = db::lock_data()?;
    migrate_json_tasks(&app)?;
    let conn = db::open(&app)?;
    db::init_schema_on(&conn)?;
    restore_task_on(&conn, &id)
}

#[tauri::command]
pub fn clear_completed_tasks(app: AppHandle) -> Result<Vec<Task>, String> {
    let _guard = db::lock_data()?;
    migrate_json_tasks(&app)?;
    let conn = db::open(&app)?;
    db::init_schema_on(&conn)?;
    let now = timestamp();
    let mut tasks = load_tasks(&app)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for task in tasks.iter_mut().filter(|task| is_active_task(task) && task.done) {
        task.archived_at = Some(now.clone());
        task.updated_at = now.clone();
        preserve_task_events(&tx, task)?;
        insert_event(&tx, &task.id, "archived", &now)?;
        upsert_task(&tx, task)?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    let mut active_tasks: Vec<Task> = tasks.into_iter().filter(is_active_task).collect();
    active_tasks.sort_by_key(|task| task.order);
    Ok(active_tasks)
}

#[tauri::command]
pub fn reorder_tasks(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let _guard = db::lock_data()?;
    migrate_json_tasks(&app)?;
    let conn = db::open(&app)?;
    db::init_schema_on(&conn)?;
    let tasks = load_tasks(&app)?;
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

    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    for (order, id) in ids.iter().enumerate() {
        tx.execute(
            "UPDATE tasks SET order_index = ?1 WHERE id = ?2",
            params![order as i32, id],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn seed_task(conn: &Connection, task: &Task) {
        db::init_schema_on(conn).unwrap();
        upsert_task(conn, task).unwrap();
    }

    fn sample(id: &str) -> Task {
        Task {
            id: id.into(),
            title: "Äpfel pie".into(),
            done: true,
            order: 0,
            created_at: "100".into(),
            updated_at: "200".into(),
            completed_at: Some("150".into()),
            archived_at: Some("180".into()),
            deleted_at: Some("190".into()),
        }
    }

    #[test]
    fn restore_reuses_id_keeps_created_at_and_prior_evidence() {
        let conn = Connection::open_in_memory().unwrap();
        let original = sample("legacy-1");
        seed_task(&conn, &original);
        let restored = restore_task_on(&conn, "legacy-1").unwrap();
        assert_eq!(restored.id, "legacy-1");
        assert_eq!(restored.created_at, "100");
        assert!(restored.completed_at.is_none());
        let history = history_tasks_on(&conn).unwrap();
        assert_eq!(history.len(), 1);
        for (event, at) in [("completed", "150"), ("archived", "180"), ("deleted", "190")] {
            assert!(history[0].events.iter().any(|item| item.event == event && item.at == at));
        }
        assert!(restored.archived_at.is_none());
        assert!(restored.deleted_at.is_none());
        assert!(!restored.done);
        let events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_events WHERE task_id='legacy-1' AND event='restored'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(events, 1);
        let again = restore_task_on(&conn, "legacy-1").unwrap();
        assert_eq!(again.id, "legacy-1");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks WHERE id='legacy-1'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);
        let events_again: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM task_events WHERE task_id='legacy-1' AND event='restored'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(events_again, 1);
    }

    #[test]
    fn unicode_search_is_case_insensitive() {
        assert!(title_matches("Äpfel pie", "äpfel"));
        assert!(title_matches("任务记录", "任务"));
        assert!(!title_matches("Äpfel pie", "banana"));
    }
}
