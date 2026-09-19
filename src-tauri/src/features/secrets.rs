use crate::config::StoreWrapper;
use crate::APP;
use keyring::Entry;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const SERVICE: &str = "com.aabiber.forge";

fn entry(name: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, name).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn secret_get(name: String) -> Result<String, String> {
    match entry(&name)?.get_password() {
        Ok(value) => Ok(value),
        Err(keyring::Error::NoEntry) => Ok(String::new()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn secret_set(name: String, value: String) -> Result<(), String> {
    let item = entry(&name)?;
    if value.is_empty() {
        match item.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    } else {
        item.set_password(&value).map_err(|error| error.to_string())
    }
}

fn should_migrate_secret(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed != "fixture-only" && !trimmed.starts_with("keyring:")
}

pub fn migrate_plaintext_secrets(_app: &AppHandle) -> Result<u32, String> {
    let state = APP.get().ok_or("app handle is not ready")?.state::<StoreWrapper>();
    let store = state.0.lock().unwrap();
    let mut moved = 0u32;
    let entries: Vec<(String, Value)> = store
        .keys()
        .into_iter()
        .filter_map(|key| store.get(&key).map(|value| (key, value)))
        .collect();

    for (key, value) in entries {
        let Value::Object(mut map) = value else {
            continue;
        };
        let Some(Value::String(api_key)) = map.get("apiKey").cloned() else {
            continue;
        };
        if !should_migrate_secret(&api_key) {
            continue;
        }
        let secret_name = format!("{key}.apiKey");
        entry(&secret_name)?
            .set_password(&api_key)
            .map_err(|error| error.to_string())?;
        map.insert("apiKey".into(), json!(""));
        store.set(key, Value::Object(map));
        moved += 1;
    }

    if moved > 0 {
        store.save().map_err(|error| error.to_string())?;
    }
    Ok(moved)
}
