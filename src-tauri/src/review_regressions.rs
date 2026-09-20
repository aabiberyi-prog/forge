#[cfg(test)]
mod review_regression_probes {
    use std::fs;
    use rusqlite::Connection;
    fn temp_root(name:&str)->std::path::PathBuf {
        let p=std::env::temp_dir().join(format!("forge-review-{name}-{}",crate::features::json_store::unique_stamp()));
        fs::create_dir_all(&p).unwrap();p
    }
    #[test]
    fn review_restore_preserves_legacy_deleted_timestamp() {
        let conn=Connection::open_in_memory().unwrap();
        crate::features::db::init_schema_on(&conn).unwrap();
        conn.execute("INSERT INTO tasks(id,title,done,order_index,created_at,updated_at,deleted_at) VALUES('legacy','fixture',0,0,'100','190','190')",[]).unwrap();
        crate::features::tasks::restore_task_on(&conn,"legacy").unwrap();
        let evidence:i64=conn.query_row("SELECT COUNT(*) FROM task_events WHERE task_id='legacy' AND event='deleted' AND at='190'",[],|r|r.get(0)).unwrap();
        assert_eq!(evidence,1,"restoring an imported task must retain its old deletion timestamp");
    }
    #[test]
    fn review_missing_source_asset_does_not_commit_dangling_clip() {
        let mut conn=Connection::open_in_memory().unwrap();
        crate::features::db::init_schema_on(&conn).unwrap();
        let root=temp_root("missing-asset");
        let item=crate::features::clips::CopyItem{id:"clip-fixture".into(),title:"fixture".into(),text:String::new(),order:0,created_at:"1".into(),updated_at:"1".into(),images:vec![crate::features::clips::CopyImage{id:"image-fixture".into(),file_name:"missing.png".into(),mime_type:"image/png".into(),relative_path:"copy-assets/fixture/missing.png".into(),size_bytes:5,created_at:"1".into()}]};
        let result=crate::features::merge::merge_into(&mut conn,&[],&[item],&root.join("source"),&root.join("dest"),false);
        assert!(result.is_err(),"missing required source image must fail, but merge returned {result:?}");
    }
    #[test]
    fn review_backup_includes_committed_wal_rows() {
        let root=temp_root("wal-backup");let profile=root.join("profile");fs::create_dir_all(&profile).unwrap();
        let conn=Connection::open(profile.join("history.db")).unwrap();
        conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE probe(id INTEGER PRIMARY KEY); PRAGMA wal_checkpoint(TRUNCATE); INSERT INTO probe VALUES(1);").unwrap();
        let zip_path=root.join("backup.zip");crate::backup::archive_profile(&profile,&zip_path).unwrap();
        let extracted=root.join("extracted");
        let mut zip=zip::ZipArchive::new(fs::File::open(zip_path).unwrap()).unwrap();zip.extract(&extracted).unwrap();
        let backup=Connection::open(extracted.join("history.db")).unwrap();
        let count:i64=backup.query_row("SELECT COUNT(*) FROM probe",[],|r|r.get(0)).unwrap();
        assert_eq!(count,1,"backup must include committed WAL data while the app connection remains open");
    }
    #[test]
    fn review_database_restore_keeps_open_wal_connection_consistent() {
        let root = temp_root("wal-restore");
        let source = root.join("snapshot.db");
        let dest = root.join("live.db");
        let snapshot = Connection::open(&source).unwrap();
        snapshot.execute_batch("CREATE TABLE probe(value INTEGER); INSERT INTO probe VALUES(1);").unwrap();
        drop(snapshot);
        let live = Connection::open(&dest).unwrap();
        live.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE probe(value INTEGER); INSERT INTO probe VALUES(2);").unwrap();
        crate::features::db::copy_database(&source, &dest).unwrap();
        let value: i64 = live.query_row("SELECT value FROM probe", [], |row| row.get(0)).unwrap();
        assert_eq!(value, 1);
    }

}
