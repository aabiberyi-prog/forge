use super::clips::CopyItemsFile;
use super::db;
use super::json_store::read_json;
use super::merge::{self, MergeReport};
use super::tasks::TasksFile;
use rusqlite::Connection;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

fn desktop_todo_dir() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("FORGE_TODO_SOURCE_DIR") {
        return Some(PathBuf::from(path));
    }
    dirs::config_dir().map(|dir| dir.join("com.local.desktop-todo"))
}

#[tauri::command]
pub fn has_desktop_todo_data() -> bool {
    desktop_todo_dir()
        .map(|dir| dir.join("tasks.json").exists() || dir.join("copy-items.json").exists())
        .unwrap_or(false)
}

fn load_source(dir: &Path) -> Result<(Vec<crate::features::tasks::Task>, Vec<crate::features::clips::CopyItem>), String> {
    let tasks = read_json::<TasksFile>(&dir.join("tasks.json"))?
        .map(|file| file.tasks)
        .unwrap_or_default();
    let clips = read_json::<CopyItemsFile>(&dir.join("copy-items.json"))?
        .map(|file| file.items)
        .unwrap_or_default();
    Ok((tasks, clips))
}

fn run_merge(app: &AppHandle, dry_run: bool) -> Result<MergeReport, String> {
    let dir = desktop_todo_dir().ok_or("cannot resolve Desktop ToDo config dir")?;
    if !dir.exists() {
        return Err(format!("Desktop ToDo data not found: {}", dir.display()));
    }
    let (tasks, clips) = load_source(&dir)?;
    let db_path = db::history_db_path(app)?;
    let dest_root = super::json_store::app_data_dir(app)?;
    let dest_assets = dest_root.join("copy-assets");
    db::init_schema(app)?;
    let snapshot = if dry_run {
        None
    } else {
        Some(merge::snapshot_dir(&db_path, &dest_assets)?)
    };
    let outcome: Result<MergeReport, String> = (|| {
        let mut conn = Connection::open(&db_path).map_err(|error| error.to_string())?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|error| error.to_string())?;
        db::init_schema_on(&conn)?;
        let mut report = merge::merge_into(&mut conn, &tasks, &clips, &dir, &dest_root, dry_run)?;
        if let Some(path) = &snapshot {
            report.snapshot_path = Some(path.to_string_lossy().to_string());
        }
        if !dry_run {
            merge::record_ledger(&conn, &report, &dir.to_string_lossy())?;
        }
        Ok(report)
    })();
    match outcome {
        Ok(report) => Ok(report),
        Err(error) => {
            if let Some(path) = snapshot {
                let _ = merge::restore_snapshot(&path, &db_path, &dest_assets);
            }
            Err(error)
        }
    }
}

#[tauri::command]
pub fn preview_desktop_todo_import(app: AppHandle) -> Result<MergeReport, String> {
    run_merge(&app, true)
}

#[tauri::command]
pub fn import_desktop_todo_data(app: AppHandle, dry_run: Option<bool>) -> Result<serde_json::Value, String> {
    let dry_run = dry_run.unwrap_or(false);
    let report = run_merge(&app, dry_run)?;
    if !dry_run {
        let _ = app.emit("desktop-todo-imported", &report);
    }
    Ok(json!(report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::db::init_schema_on;
    use crate::features::merge::{self, merge_into};
    use crate::features::tasks::restore_task_on;
    use rusqlite::Connection;

    #[test]
    fn isolated_legacy_merge_preserves_all_ids_and_is_idempotent() {
        let Some(dir) = desktop_todo_dir() else {
            panic!("Desktop ToDo source dir missing");
        };
        let (tasks, clips) = load_source(&dir).expect("legacy JSON");
        assert_eq!(tasks.len(), 86, "baseline task count");
        let history = tasks
            .iter()
            .filter(|task| task.done || task.archived_at.is_some() || task.deleted_at.is_some())
            .count();
        assert_eq!(history, 69, "baseline history count");
        assert_eq!(clips.len(), 9, "baseline clip count");
        let images: usize = clips.iter().map(|item| item.images.len()).sum();
        assert_eq!(images, 8, "baseline clip image count");

        let tmp = std::env::temp_dir().join(format!(
            "forge-isolated-merge-{}",
            crate::features::json_store::unique_stamp()
        ));
        fs::create_dir_all(&tmp).unwrap();
        let db_path = tmp.join("history.db");
        let dest_root = tmp.clone();
        let mut conn = Connection::open(&db_path).unwrap();
        init_schema_on(&conn).unwrap();
        let extra = crate::features::tasks::Task {
            id: "destination-only".into(),
            title: "keep".into(),
            done: false,
            order: 99,
            created_at: "0".into(),
            updated_at: "0".into(),
            completed_at: None,
            archived_at: None,
            deleted_at: None,
        };
        conn.execute(
            "INSERT INTO tasks(id, title, done, order_index, created_at, updated_at) VALUES(?1,?2,0,99,'0','0')",
            rusqlite::params![extra.id, extra.title],
        )
        .unwrap();

        let first = merge_into(&mut conn, &tasks, &clips, &dir, &dest_root, false).unwrap();
        assert_eq!(first.tasks_added, 86);
        assert_eq!(first.clips_added, 9);
        assert_eq!(first.images_copied, 8);
        assert_eq!(first.destination_only_tasks, 1);
        let second = merge_into(&mut conn, &tasks, &clips, &dir, &dest_root, false).unwrap();
        assert_eq!(second.tasks_added, 0);
        assert_eq!(second.clips_added, 0);
        assert_eq!(second.tasks_skipped, 86);
        let task_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(task_n, 87);
        let clip_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM clips", [], |row| row.get(0))
            .unwrap();
        assert_eq!(clip_n, 9);
        let image_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM clip_images", [], |row| row.get(0))
            .unwrap();
        assert_eq!(image_n, 8);
        let history_n: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE done = 1 OR archived_at IS NOT NULL OR deleted_at IS NOT NULL",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(history_n, 69);
        let deleted = tasks
            .iter()
            .find(|task| task.deleted_at.is_some())
            .expect("deleted baseline task");
        let restored = restore_task_on(&conn, &deleted.id).unwrap();
        assert_eq!(restored.id, deleted.id);
        assert_eq!(restored.created_at, deleted.created_at);
        assert!(restored.deleted_at.is_none());
        restore_task_on(&conn, &deleted.id).unwrap();
        let same_id: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM tasks WHERE id = ?1",
                rusqlite::params![deleted.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(same_id, 1);
        for item in &clips {
            for image in &item.images {
                let source = dir.join(&image.relative_path);
                let dest = dest_root.join(&image.relative_path);
                assert!(dest.exists(), "missing copied asset {}", dest.display());
                assert_eq!(
                    fs::read(&source).unwrap(),
                    fs::read(&dest).unwrap(),
                    "asset hash mismatch {}",
                    image.relative_path
                );
            }
        }
        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn snapshot_rollback_restores_previous_db() {
        let tmp = std::env::temp_dir().join(format!(
            "forge-rollback-{}",
            crate::features::json_store::unique_stamp()
        ));
        fs::create_dir_all(&tmp).unwrap();
        let db_path = tmp.join("history.db");
        let assets = tmp.join("copy-assets");
        fs::create_dir_all(&assets).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        init_schema_on(&conn).unwrap();
        conn.execute(
            "INSERT INTO tasks(id, title, done, order_index, created_at, updated_at) VALUES('before','x',0,0,'0','0')",
            [],
        )
        .unwrap();
        drop(conn);
        let snap = merge::snapshot_dir(&db_path, &assets).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute("DELETE FROM tasks", []).unwrap();
        drop(conn);
        merge::restore_snapshot(&snap, &db_path, &assets).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(n, 1);
        let _ = fs::remove_dir_all(tmp);
        let _ = fs::remove_dir_all(snap);
    }

    #[test]
    #[ignore = "writes live com.aabiber.pot-forge; set FORGE_LIVE_IMPORT=1"]
    fn live_profile_merge_from_desktop_todo() {
        assert_eq!(
            std::env::var("FORGE_LIVE_IMPORT").as_deref(),
            Ok("1"),
            "refusing to touch the live profile"
        );
        let dir = desktop_todo_dir().expect("Desktop ToDo source dir");
        let dest_root = dirs::config_dir()
            .expect("config dir")
            .join("com.aabiber.pot-forge");
        let db_path = dest_root.join("history.db");
        let dest_assets = dest_root.join("copy-assets");
        let (tasks, clips) = load_source(&dir).expect("legacy JSON");
        assert_eq!(tasks.len(), 86);
        assert_eq!(clips.len(), 9);
        let snap = merge::snapshot_dir(&db_path, &dest_assets).expect("snapshot");
        eprintln!("live import snapshot {}", snap.display());
        let mut conn = Connection::open(&db_path).expect("open live history.db");
        conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
        init_schema_on(&conn).unwrap();
        let preview = merge_into(&mut conn, &tasks, &clips, &dir, &dest_root, true).unwrap();
        eprintln!(
            "preview added_tasks={} skipped_tasks={} task_conflicts={} added_clips={} images={} dest_only_tasks={}",
            preview.tasks_added,
            preview.tasks_skipped,
            preview.task_conflicts.len(),
            preview.clips_added,
            preview.images_copied,
            preview.destination_only_tasks
        );
        assert_eq!(preview.tasks_added, 86);
        assert_eq!(preview.clips_added, 9);
        assert_eq!(preview.images_copied, 8);
        assert!(preview.task_conflicts.is_empty());
        assert!(preview.clip_conflicts.is_empty());
        if std::env::var("FORGE_LIVE_IMPORT_APPLY").as_deref() != Ok("1") {
            return;
        }
        let mut report = merge_into(&mut conn, &tasks, &clips, &dir, &dest_root, false).unwrap();
        report.snapshot_path = Some(snap.to_string_lossy().to_string());
        merge::record_ledger(&conn, &report, &dir.to_string_lossy()).unwrap();
        assert_eq!(report.tasks_added, 86);
        assert_eq!(report.clips_added, 9);
        assert_eq!(report.images_copied, 8);
        let task_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        let clip_n: i64 = conn
            .query_row("SELECT COUNT(*) FROM clips", [], |row| row.get(0))
            .unwrap();
        let template: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clips WHERE id='copy-template-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(task_n, 86);
        assert_eq!(clip_n, 10);
        assert_eq!(template, 1);
        for item in &clips {
            for image in &item.images {
                let source = dir.join(&image.relative_path);
                let dest = dest_root.join(&image.relative_path);
                assert_eq!(fs::read(&source).unwrap(), fs::read(&dest).unwrap());
            }
        }
        let again = merge_into(&mut conn, &tasks, &clips, &dir, &dest_root, false).unwrap();
        assert_eq!(again.tasks_added, 0);
        assert_eq!(again.clips_added, 0);
    }
}
