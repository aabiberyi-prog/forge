use crate::error::Error;
use log::info;
use reqwest_dav::{Auth, ClientBuilder, Depth};
use std::io::Write;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;
use zip::read::ZipArchive;
use zip::write::SimpleFileOptions;

const PROFILE_ITEMS: [&str; 5] = [
    "config.json",
    "history.db",
    "panel.json",
    "plugins",
    "copy-assets",
];

fn forge_profile_dir() -> PathBuf {
    if let Ok(path) = std::env::var("FORGE_BACKUP_PROFILE_DIR") {
        return PathBuf::from(path);
    }
    dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("com.aabiber.pot-forge")
}

fn copy_item(src: &Path, dst: &Path) -> Result<(), Error> {
    if src.is_file() {
        if let Some(parent) = dst.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(src, dst)?;
        return Ok(());
    }
    std::fs::create_dir_all(dst)?;
    for entry in WalkDir::new(src) {
        let entry = entry?;
        if !entry.path().is_file() {
            continue;
        }
        let rel = entry.path().strip_prefix(src)?;
        let dest = dst.join(rel);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(entry.path(), dest)?;
    }
    Ok(())
}

fn snapshot_profile_items(dir: &Path) -> Result<PathBuf, Error> {
    let snap = std::env::temp_dir().join(format!(
        "forge-restore-snap-{}",
        crate::features::json_store::unique_stamp()
    ));
    std::fs::create_dir_all(&snap)?;
    for rel in PROFILE_ITEMS {
        let src = dir.join(rel);
        if src.exists() {
            copy_item(&src, &snap.join(rel))?;
        }
    }
    Ok(snap)
}

fn restore_profile_items(dir: &Path, snap: &Path) -> Result<(), Error> {
    for rel in PROFILE_ITEMS {
        let dest = dir.join(rel);
        if dest.exists() {
            if dest.is_dir() {
                let _ = std::fs::remove_dir_all(&dest);
            } else {
                let _ = std::fs::remove_file(&dest);
            }
        }
        let src = snap.join(rel);
        if src.exists() {
            copy_item(&src, &dest)?;
        }
    }
    Ok(())
}

pub(crate) fn archive_profile(config_dir_path: &Path, zip_path: &Path) -> Result<(), Error> {
    if let Some(parent) = zip_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let zip_file = std::fs::File::create(zip_path)?;
    let mut zip = zip::ZipWriter::new(zip_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for rel in PROFILE_ITEMS {
        add_path_to_zip(&mut zip, options, config_dir_path, rel)?;
    }
    zip.finish()?;
    Ok(())
}

pub(crate) fn restore_profile(config_dir_path: &Path, zip_path: &Path) -> Result<(), Error> {
    std::fs::create_dir_all(config_dir_path)?;
    let snap = snapshot_profile_items(config_dir_path)?;
    let extracted = (|| {
        let mut zip_file = std::fs::File::open(zip_path)?;
        let mut zip = ZipArchive::new(&mut zip_file)?;
        zip.extract(config_dir_path)?;
        Ok::<(), Error>(())
    })();
    match extracted {
        Ok(()) => {
            let _ = std::fs::remove_dir_all(&snap);
            Ok(())
        }
        Err(error) => {
            let _ = restore_profile_items(config_dir_path, &snap);
            let _ = std::fs::remove_dir_all(&snap);
            Err(error)
        }
    }
}

fn add_path_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    options: SimpleFileOptions,
    config_dir_path: &Path,
    relative: &str,
) -> Result<(), Error> {
    let full = config_dir_path.join(relative);
    if !full.exists() {
        return Ok(());
    }
    if full.is_file() {
        zip.start_file(relative.replace('\\', "/"), options)?;
        zip.write(&std::fs::read(&full)?)?;
        return Ok(());
    }
    for entry in WalkDir::new(&full) {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.strip_prefix(config_dir_path)?.to_str() {
            Some(v) => v.replace('\\', "/"),
            None => return Err(Error::Error("Strip Prefix Error".into())),
        };
        info!("adding file {path:?} as {file_name:?} ...");
        zip.start_file(file_name, options)?;
        zip.write(&std::fs::read(path)?)?;
    }
    Ok(())
}

#[tauri::command(async)]
pub async fn webdav(
    operate: &str,
    url: String,
    username: String,
    password: String,
    name: Option<String>,
) -> Result<String, Error> {
    // build a client
    let client = ClientBuilder::new()
        .set_host(url.clone())
        .set_auth(Auth::Basic(username.clone(), password.clone()))
        .build()?;
    client.mkcol("/pot-app").await.unwrap_or_default();
    let client = ClientBuilder::new()
        .set_host(format!("{}/pot-app", url.trim_end_matches("/")))
        .set_auth(Auth::Basic(username, password))
        .build()?;
    match operate {
        "list" => {
            let res = client.list("/", Depth::Number(1)).await?;
            let result = serde_json::to_string(&res)?;
            Ok(result)
        }
        "get" => {
            let res = client.get(&format!("/{}", name.unwrap())).await?;
            let data = res.bytes().await?;
            let config_dir_path = forge_profile_dir();
            let zip_path = config_dir_path.join("archive.zip");

            let mut zip_file = std::fs::File::create(&zip_path)?;
            zip_file.write_all(&data)?;
            restore_profile(&config_dir_path, &zip_path)?;
            Ok("".to_string())
        }
        "put" => {
            let config_dir_path = forge_profile_dir();
            let zip_path = config_dir_path.join("archive.zip");
            archive_profile(&config_dir_path, &zip_path)?;
            match client
                .put(&format!("/{}", name.unwrap()), std::fs::read(&zip_path)?)
                .await
            {
                Ok(()) => return Ok("".to_string()),
                Err(e) => {
                    return Err(Error::Error(format!("WebDav Put Error: {}", e).into()));
                }
            }
        }

        "delete" => match client.delete(&format!("/{}", name.unwrap())).await {
            Ok(()) => return Ok("".to_string()),
            Err(e) => {
                return Err(Error::Error(format!("WebDav Delete Error: {}", e).into()));
            }
        },
        _ => {
            return Err(Error::Error(
                format!("WebDav Operate Error: {}", operate).into(),
            ));
        }
    }
}

#[tauri::command(async)]
pub async fn local(operate: &str, path: String) -> Result<String, Error> {
    match operate {
        "put" => {
            archive_profile(&forge_profile_dir(), Path::new(&path))?;
            Ok("".to_string())
        }
        "get" => {
            restore_profile(&forge_profile_dir(), Path::new(&path))?;
            Ok("".to_string())
        }
        _ => {
            return Err(Error::Error(
                format!("Local Operate Error: {}", operate).into(),
            ));
        }
    }
}

#[tauri::command(async)]
pub async fn aliyun(operate: &str, path: String, url: String) -> Result<String, Error> {
    match operate {
        "put" => {
            let _ = reqwest::Client::new()
                .put(&url)
                .body(std::fs::read(&path)?)
                .send()
                .await?;
            Ok("".to_string())
        }
        "get" => {
            let res = reqwest::Client::new().get(&url).send().await?;
            let data = res.bytes().await?;
            let config_dir_path = forge_profile_dir();
            let zip_path = config_dir_path.join("archive.zip");

            let mut zip_file = std::fs::File::create(&zip_path)?;
            zip_file.write_all(&data)?;
            restore_profile(&config_dir_path, &zip_path)?;
            Ok("".to_string())
        }
        _ => {
            return Err(Error::Error(
                format!("Local Operate Error: {}", operate).into(),
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use zip::read::ZipArchive;

    fn fixture_profile() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "forge-backup-profile-{}",
            crate::features::json_store::unique_stamp()
        ));
        fs::create_dir_all(dir.join("copy-assets/copy-1")).unwrap();
        fs::create_dir_all(dir.join("plugins/sample")).unwrap();
        fs::write(dir.join("config.json"), "{\"ok\":true}").unwrap();
        fs::write(dir.join("history.db"), b"sqlite-bytes").unwrap();
        fs::write(dir.join("panel.json"), "{\"x\":1}").unwrap();
        fs::write(dir.join("copy-assets/copy-1/a.png"), b"img").unwrap();
        fs::write(dir.join("plugins/sample/index.js"), "export default {}").unwrap();
        dir
    }

    #[test]
    fn local_backup_roundtrip_preserves_db_and_assets() {
        let profile = fixture_profile();
        let zip_path = std::env::temp_dir().join(format!(
            "forge-backup-{}.zip",
            crate::features::json_store::unique_stamp()
        ));
        archive_profile(&profile, &zip_path).unwrap();
        let names = {
            let mut zip_file = fs::File::open(&zip_path).unwrap();
            let mut zip = ZipArchive::new(&mut zip_file).unwrap();
            (0..zip.len())
                .map(|i| zip.by_index(i).unwrap().name().replace('\\', "/"))
                .collect::<Vec<_>>()
        };
        assert!(names.iter().any(|name| name == "history.db"), "{names:?}");
        assert!(names.iter().any(|name| name == "config.json"), "{names:?}");
        assert!(
            names.iter().any(|name| name.ends_with("copy-assets/copy-1/a.png")),
            "{names:?}"
        );

        fs::remove_dir_all(&profile).unwrap();
        fs::create_dir_all(&profile).unwrap();
        restore_profile(&profile, &zip_path).unwrap();
        assert_eq!(fs::read_to_string(profile.join("config.json")).unwrap(), "{\"ok\":true}");
        assert_eq!(fs::read(profile.join("history.db")).unwrap(), b"sqlite-bytes");
        assert_eq!(fs::read(profile.join("copy-assets/copy-1/a.png")).unwrap(), b"img");
        assert!(profile.join("plugins/sample/index.js").exists());
        let _ = fs::remove_dir_all(profile);
        let _ = fs::remove_file(zip_path);
    }

    #[test]
    fn failed_restore_keeps_previous_profile() {
        let profile = fixture_profile();
        let zip_path = std::env::temp_dir().join(format!(
            "forge-bad-backup-{}.zip",
            crate::features::json_store::unique_stamp()
        ));
        fs::write(&zip_path, b"not-a-zip").unwrap();
        let err = restore_profile(&profile, &zip_path).unwrap_err();
        let _ = err;
        assert_eq!(fs::read_to_string(profile.join("config.json")).unwrap(), "{\"ok\":true}");
        assert_eq!(fs::read(profile.join("history.db")).unwrap(), b"sqlite-bytes");
        assert_eq!(fs::read(profile.join("copy-assets/copy-1/a.png")).unwrap(), b"img");
        let _ = fs::remove_dir_all(profile);
        let _ = fs::remove_file(zip_path);
    }
}
