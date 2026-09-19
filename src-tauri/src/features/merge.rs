use super::clips::{CopyImage, CopyItem};
use super::tasks::Task;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[cfg(test)]
use std::cell::Cell;

#[cfg(test)]
thread_local! {
    static REMAINING_COPIES: Cell<Option<u32>> = Cell::new(None);
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub id: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MergeReport {
    pub tasks_added: u32,
    pub tasks_skipped: u32,
    pub task_conflicts: Vec<Conflict>,
    pub clips_added: u32,
    pub clips_skipped: u32,
    pub clip_conflicts: Vec<Conflict>,
    pub images_copied: u32,
    pub destination_only_tasks: u32,
    pub dry_run: bool,
    pub snapshot_path: Option<String>,
}

fn task_fingerprint(task: &Task) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}",
        task.title,
        task.done,
        task.order,
        task.created_at,
        task.updated_at,
        task.completed_at.clone().unwrap_or_default(),
        task.archived_at.clone().unwrap_or_default(),
        task.deleted_at.clone().unwrap_or_default()
    )
}

fn clip_fingerprint(item: &CopyItem) -> String {
    let images: Vec<String> = item
        .images
        .iter()
        .map(|image| format!("{}:{}", image.id, image.relative_path))
        .collect();
    format!(
        "{}|{}|{}|{}|{}|{}",
        item.title,
        item.text,
        item.order,
        item.created_at,
        item.updated_at,
        images.join(",")
    )
}

fn load_existing_tasks(conn: &Connection) -> Result<HashMap<String, Task>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, done, order_index, created_at, updated_at, completed_at, archived_at, deleted_at FROM tasks")
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
    let mut map = HashMap::new();
    for row in rows {
        let task = row.map_err(|error| error.to_string())?;
        map.insert(task.id.clone(), task);
    }
    Ok(map)
}

fn load_existing_clips(conn: &Connection) -> Result<HashMap<String, CopyItem>, String> {
    let mut stmt = conn
        .prepare("SELECT id, title, text, order_index, created_at, updated_at FROM clips")
        .map_err(|error| error.to_string())?;
    let clip_rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let mut map = HashMap::new();
    for (id, title, text, order, created_at, updated_at) in clip_rows {
        let mut img_stmt = conn
            .prepare("SELECT id, file_name, mime_type, relative_path, size_bytes, created_at FROM clip_images WHERE clip_id = ?1 ORDER BY id")
            .map_err(|error| error.to_string())?;
        let images = img_stmt
            .query_map(params![id], |image| {
                Ok(CopyImage {
                    id: image.get(0)?,
                    file_name: image.get(1)?,
                    mime_type: image.get(2)?,
                    relative_path: image.get(3)?,
                    size_bytes: image.get(4)?,
                    created_at: image.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        map.insert(
            id.clone(),
            CopyItem {
                id,
                title,
                text,
                images,
                order,
                created_at,
                updated_at,
            },
        );
    }
    Ok(map)
}

fn insert_task(conn: &Connection, task: &Task) -> Result<(), String> {
    conn.execute(
        "INSERT INTO tasks(id, title, done, order_index, created_at, updated_at, completed_at, archived_at, deleted_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
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

fn insert_clip(conn: &Connection, item: &CopyItem) -> Result<(), String> {
    conn.execute(
        "INSERT INTO clips(id, title, text, order_index, created_at, updated_at) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            item.id,
            item.title,
            item.text,
            item.order,
            item.created_at,
            item.updated_at,
        ],
    )
    .map_err(|error| error.to_string())?;
    for image in &item.images {
        conn.execute(
            "INSERT INTO clip_images(id, clip_id, file_name, mime_type, relative_path, size_bytes, created_at) VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                image.id,
                item.id,
                image.file_name,
                image.mime_type,
                image.relative_path,
                image.size_bytes,
                image.created_at,
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn snapshot_dir(dest_db: &Path, dest_assets: &Path) -> Result<PathBuf, String> {
    let stamp = super::json_store::timestamp();
    let dir = dest_db
        .parent()
        .unwrap_or(Path::new("."))
        .join(format!("import-snapshot-{stamp}"));
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    if dest_db.exists() {
        fs::copy(dest_db, dir.join("history.db")).map_err(|error| error.to_string())?;
    }
    if dest_assets.exists() {
        copy_dir_all(dest_assets, &dir.join("copy-assets"))?;
    }
    Ok(dir)
}

pub fn restore_snapshot(snapshot: &Path, dest_db: &Path, dest_assets: &Path) -> Result<(), String> {
    let snap_db = snapshot.join("history.db");
    if snap_db.exists() {
        fs::copy(snap_db, dest_db).map_err(|error| error.to_string())?;
    }
    let snap_assets = snapshot.join("copy-assets");
    if dest_assets.exists() {
        let _ = fs::remove_dir_all(dest_assets);
    }
    if snap_assets.exists() {
        copy_dir_all(&snap_assets, dest_assets)?;
    }
    Ok(())
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(src).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let dest = dst.join(entry.file_name());
        if entry.file_type().map_err(|error| error.to_string())?.is_dir() {
            copy_dir_all(&entry.path(), &dest)?;
        } else {
            fs::copy(entry.path(), dest).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn importing_path(dest: &Path) -> PathBuf {
    let mut name = dest.as_os_str().to_os_string();
    name.push(".importing");
    PathBuf::from(name)
}

fn copy_asset(source_root: &Path, dest_root: &Path, relative: &str) -> Result<bool, String> {
    #[cfg(test)]
    {
        let fail = REMAINING_COPIES.with(|cell| match cell.get() {
            Some(0) => true,
            Some(n) => {
                cell.set(Some(n.saturating_sub(1)));
                false
            }
            None => false,
        });
        if fail {
            return Err("simulated copy interrupt".into());
        }
    }
    let source = source_root.join(relative);
    if !source.exists() {
        return Ok(false);
    }
    let dest = dest_root.join(relative);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let tmp = importing_path(&dest);
    let copy_result: Result<(), String> = (|| {
        fs::copy(&source, &tmp).map_err(|error| error.to_string())?;
        let source_bytes = fs::read(&source).map_err(|error| error.to_string())?;
        let tmp_bytes = fs::read(&tmp).map_err(|error| error.to_string())?;
        if source_bytes != tmp_bytes {
            return Err("asset hash mismatch".into());
        }
        if dest.exists() {
            fs::remove_file(&dest).map_err(|error| error.to_string())?;
        }
        fs::rename(&tmp, &dest).map_err(|error| error.to_string())?;
        Ok(())
    })();
    if copy_result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    copy_result?;
    Ok(true)
}

fn merge_body(
    conn: &Connection,
    tasks: &[Task],
    clips: &[CopyItem],
    source_root: &Path,
    dest_root: &Path,
    dry_run: bool,
) -> Result<MergeReport, String> {
    let existing_tasks = load_existing_tasks(conn)?;
    let existing_clips = load_existing_clips(conn)?;
    let mut report = MergeReport {
        destination_only_tasks: existing_tasks
            .keys()
            .filter(|id| !tasks.iter().any(|task| task.id == **id))
            .count() as u32,
        dry_run,
        ..MergeReport::default()
    };

    for task in tasks {
        match existing_tasks.get(&task.id) {
            None => {
                report.tasks_added += 1;
                if !dry_run {
                    insert_task(conn, task)?;
                }
            }
            Some(existing) if task_fingerprint(existing) == task_fingerprint(task) => {
                report.tasks_skipped += 1;
            }
            Some(_) => report.task_conflicts.push(Conflict {
                id: task.id.clone(),
                kind: "task".into(),
            }),
        }
    }

    for item in clips {
        match existing_clips.get(&item.id) {
            None => {
                report.clips_added += 1;
                if !dry_run {
                    insert_clip(conn, item)?;
                    for image in &item.images {
                        if copy_asset(source_root, dest_root, &image.relative_path)? {
                            report.images_copied += 1;
                        }
                    }
                } else {
                    report.images_copied += item
                        .images
                        .iter()
                        .filter(|image| source_root.join(&image.relative_path).exists())
                        .count() as u32;
                }
            }
            Some(existing) if clip_fingerprint(existing) == clip_fingerprint(item) => {
                report.clips_skipped += 1;
            }
            Some(_) => report.clip_conflicts.push(Conflict {
                id: item.id.clone(),
                kind: "clip".into(),
            }),
        }
    }

    Ok(report)
}

pub fn merge_into(
    conn: &mut Connection,
    tasks: &[Task],
    clips: &[CopyItem],
    source_root: &Path,
    dest_root: &Path,
    dry_run: bool,
) -> Result<MergeReport, String> {
    if dry_run {
        return merge_body(conn, tasks, clips, source_root, dest_root, true);
    }
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    match merge_body(&tx, tasks, clips, source_root, dest_root, false) {
        Ok(report) => {
            tx.commit().map_err(|error| error.to_string())?;
            Ok(report)
        }
        Err(error) => Err(error),
    }
}

pub fn record_ledger(conn: &Connection, report: &MergeReport, source: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO import_ledger(started_at, finished_at, source, dry_run, report_json, snapshot_path) VALUES(?1,?2,?3,?4,?5,?6)",
        params![
            super::json_store::timestamp(),
            super::json_store::timestamp(),
            source,
            if report.dry_run { 1 } else { 0 },
            serde_json::to_string(report).unwrap_or_else(|_| "{}".into()),
            report.snapshot_path.clone().unwrap_or_default(),
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::db::init_schema_on;

    fn sample_task(id: &str, title: &str) -> Task {
        Task {
            id: id.into(),
            title: title.into(),
            done: false,
            order: 0,
            created_at: "1".into(),
            updated_at: "1".into(),
            completed_at: None,
            archived_at: None,
            deleted_at: None,
        }
    }

    #[test]
    fn merge_keeps_destination_only_and_skips_duplicates() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on(&conn).unwrap();
        insert_task(&conn, &sample_task("keep-me", "local")).unwrap();
        insert_task(&conn, &sample_task("shared", "same")).unwrap();
        let incoming = vec![
            sample_task("shared", "same"),
            sample_task("new-one", "incoming"),
            sample_task("shared-conflict", "theirs"),
        ];
        insert_task(&conn, &sample_task("shared-conflict", "ours")).unwrap();
        let tmp = std::env::temp_dir().join(format!(
            "merge-assets-{}",
            crate::features::json_store::unique_stamp()
        ));
        let report = merge_into(&mut conn, &incoming, &[], &tmp, &tmp, false).unwrap();
        assert_eq!(report.tasks_added, 1);
        assert_eq!(report.tasks_skipped, 1);
        assert_eq!(report.task_conflicts.len(), 1);
        assert_eq!(report.destination_only_tasks, 1);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 4);
        let title: String = conn
            .query_row(
                "SELECT title FROM tasks WHERE id='shared-conflict'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(title, "ours");
        let _ = fs::remove_dir_all(tmp);
    }

    #[test]
    fn second_merge_adds_zero_duplicates() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_schema_on(&conn).unwrap();
        let incoming = vec![sample_task("a", "A"), sample_task("b", "B")];
        let tmp = std::env::temp_dir().join(format!(
            "merge-dup-{}",
            crate::features::json_store::unique_stamp()
        ));
        let first = merge_into(&mut conn, &incoming, &[], &tmp, &tmp, false).unwrap();
        let second = merge_into(&mut conn, &incoming, &[], &tmp, &tmp, false).unwrap();
        assert_eq!(first.tasks_added, 2);
        assert_eq!(second.tasks_added, 0);
        assert_eq!(second.tasks_skipped, 2);
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 2);
        let _ = fs::remove_dir_all(tmp);
    }

    fn sample_clip(id: &str, image_rel: &[&str]) -> CopyItem {
        CopyItem {
            id: id.into(),
            title: id.into(),
            text: String::new(),
            images: image_rel
                .iter()
                .enumerate()
                .map(|(index, relative)| CopyImage {
                    id: format!("{id}-img-{index}"),
                    file_name: format!("{index}.png"),
                    mime_type: "image/png".into(),
                    relative_path: (*relative).into(),
                    size_bytes: 3,
                    created_at: "1".into(),
                })
                .collect(),
            order: 0,
            created_at: "1".into(),
            updated_at: "1".into(),
        }
    }

    #[test]
    fn interrupted_copy_rolls_back_records_and_restores_assets() {
        let _reset = RemainingCopiesReset;
        let tmp = std::env::temp_dir().join(format!(
            "merge-interrupt-{}",
            crate::features::json_store::unique_stamp()
        ));
        let source = tmp.join("src");
        let dest_root = tmp.join("dest");
        let dest_assets = dest_root.join("copy-assets");
        fs::create_dir_all(source.join("copy-assets/c1")).unwrap();
        fs::create_dir_all(&dest_assets).unwrap();
        fs::write(source.join("copy-assets/c1/a.png"), b"aaa").unwrap();
        fs::write(source.join("copy-assets/c1/b.png"), b"bbb").unwrap();
        fs::write(dest_assets.join("keep.png"), b"keep").unwrap();

        let db_path = dest_root.join("history.db");
        let conn = Connection::open(&db_path).unwrap();
        init_schema_on(&conn).unwrap();
        insert_task(&conn, &sample_task("keep-me", "local")).unwrap();
        drop(conn);

        let snap = snapshot_dir(&db_path, &dest_assets).unwrap();
        REMAINING_COPIES.with(|cell| cell.set(Some(1)));
        let mut conn = Connection::open(&db_path).unwrap();
        let incoming = vec![sample_clip(
            "new-clip",
            &["copy-assets/c1/a.png", "copy-assets/c1/b.png"],
        )];
        let err = merge_into(&mut conn, &[], &incoming, &source, &dest_root, false).unwrap_err();
        assert!(err.contains("simulated copy interrupt"), "{err}");
        drop(conn);
        restore_snapshot(&snap, &db_path, &dest_assets).unwrap();

        let conn = Connection::open(&db_path).unwrap();
        let tasks: i64 = conn
            .query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0))
            .unwrap();
        let clips: i64 = conn
            .query_row("SELECT COUNT(*) FROM clips", [], |row| row.get(0))
            .unwrap();
        assert_eq!(tasks, 1);
        assert_eq!(clips, 0);
        assert_eq!(fs::read(dest_assets.join("keep.png")).unwrap(), b"keep");
        assert!(!dest_root.join("copy-assets/c1/a.png").exists());
        assert!(!importing_path(&dest_root.join("copy-assets/c1/a.png")).exists());
        let _ = fs::remove_dir_all(tmp);
        let _ = fs::remove_dir_all(snap);
    }

    struct RemainingCopiesReset;
    impl Drop for RemainingCopiesReset {
        fn drop(&mut self) {
            REMAINING_COPIES.with(|cell| cell.set(None));
        }
    }
}
