use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

use super::json_store::{app_data_dir, read_json, timestamp, write_json};
use crate::platform::file_clipboard;

const COPY_ITEMS_FILE: &str = "copy-items.json";
const COPY_ASSETS_DIR: &str = "copy-assets";
const COPY_FILE_CLIPBOARD_DIR: &str = "copy-file-clipboard";
const SCHEMA_VERSION: u32 = 1;
const MAX_COPY_IMAGES: usize = 20;
const MAX_COPY_IMAGE_BYTES: usize = 10 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyImage {
    pub id: String,
    pub file_name: String,
    pub mime_type: String,
    pub relative_path: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItem {
    pub id: String,
    pub title: String,
    pub text: String,
    pub images: Vec<CopyImage>,
    pub order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItemSummary {
    pub id: String,
    pub title: String,
    pub text: String,
    pub images: Vec<CopyImage>,
    pub order: i32,
    pub created_at: String,
    pub updated_at: String,
}

impl From<CopyItem> for CopyItemSummary {
    fn from(item: CopyItem) -> Self {
        Self {
            id: item.id,
            title: item.title,
            text: item.text,
            images: item.images,
            order: item.order,
            created_at: item.created_at,
            updated_at: item.updated_at,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyImageInput {
    pub id: Option<String>,
    pub file_name: String,
    pub mime_type: String,
    pub data_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyItemInput {
    pub title: String,
    pub text: String,
    pub images: Vec<CopyImageInput>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CopyItemsFile {
    schema_version: u32,
    items: Vec<CopyItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyPayload {
    pub html: String,
    pub text: String,
    pub image_data_urls: Vec<String>,
}

fn copy_items_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(COPY_ITEMS_FILE))
}

fn copy_assets_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(COPY_ASSETS_DIR))
}

fn copy_file_clipboard_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(COPY_FILE_CLIPBOARD_DIR))
}

fn load_copy_items(app: &AppHandle) -> Result<Vec<CopyItem>, String> {
    let path = copy_items_path(app)?;
    if let Some(file) = read_json::<CopyItemsFile>(&path)? {
        if !file.items.is_empty() {
            return Ok(file.items);
        }
    }

    let items = default_copy_items();
    save_copy_items(app, &items)?;
    Ok(items)
}

fn save_copy_items(app: &AppHandle, items: &[CopyItem]) -> Result<(), String> {
    let path = copy_items_path(app)?;
    write_json(
        &path,
        &CopyItemsFile {
            schema_version: SCHEMA_VERSION,
            items: items.to_vec(),
        },
    )
}

fn default_copy_items() -> Vec<CopyItem> {
    let now = "0".to_string();
    vec![CopyItem {
        id: "copy-template-1".to_string(),
        title: "试用模板".to_string(),
        text: "增加需求：\n每个产品一一张图册，随时能够点击复制".to_string(),
        images: Vec::new(),
        order: 0,
        created_at: now.clone(),
        updated_at: now,
    }]
}

fn next_copy_item_id() -> String {
    format!("copy-{}", timestamp())
}

fn next_copy_image_id(index: usize) -> String {
    format!("image-{}-{}", timestamp(), index)
}

fn validate_copy_title(title: &str) -> Result<String, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err("copy title length must be 1-120".to_string());
    }
    Ok(title.to_string())
}

fn validate_copy_image_count(count: usize) -> Result<(), String> {
    if count > MAX_COPY_IMAGES {
        return Err(format!(
            "copy item can contain at most {} images",
            MAX_COPY_IMAGES
        ));
    }
    Ok(())
}

fn image_extension(mime_type: &str) -> Option<&'static str> {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" | "image/jpg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

fn sanitize_file_name(file_name: &str) -> String {
    let base_name = Path::new(file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image");
    let sanitized: String = base_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .take(80)
        .collect();

    if sanitized.is_empty() {
        "image".to_string()
    } else {
        sanitized
    }
}

fn png_export_file_name(file_name: &str, index: usize) -> String {
    let stem = Path::new(file_name)
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("image");
    let stem = sanitize_file_name(stem);

    if index == 0 {
        format!("{}.png", stem)
    } else {
        format!("{}-{}.png", stem, index + 1)
    }
}

fn decode_image_data_url(data_url: &str, mime_type: &str) -> Result<Vec<u8>, String> {
    let Some((header, encoded)) = data_url.split_once(',') else {
        return Err("image dataUrl is invalid".to_string());
    };
    let expected_header = format!("data:{};base64", mime_type);
    if !header.eq_ignore_ascii_case(&expected_header) {
        return Err("image dataUrl mime type does not match".to_string());
    }

    let decoded = BASE64_STANDARD
        .decode(encoded)
        .map_err(|error| error.to_string())?;
    if decoded.len() > MAX_COPY_IMAGE_BYTES {
        return Err("image exceeds 10MB".to_string());
    }
    Ok(decoded)
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn text_to_html(value: &str) -> String {
    escape_html(value).replace("\r\n", "\n").replace('\n', "<br>")
}

fn copy_image_relative_path(item_id: &str, image_id: &str, mime_type: &str) -> Result<String, String> {
    let extension = image_extension(mime_type).ok_or_else(|| "unsupported image type".to_string())?;
    Ok(format!(
        "{}/{}/{}.{}",
        COPY_ASSETS_DIR, item_id, image_id, extension
    ))
}

fn copy_asset_path(app: &AppHandle, relative_path: &str) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(relative_path))
}

fn create_or_update_copy_image(
    app: &AppHandle,
    item_id: &str,
    image_input: &CopyImageInput,
    existing_item: Option<&CopyItem>,
    index: usize,
) -> Result<CopyImage, String> {
    let mime_type = image_input.mime_type.to_ascii_lowercase();
    image_extension(&mime_type).ok_or_else(|| "unsupported image type".to_string())?;

    if let Some(id) = &image_input.id {
        if image_input.data_url.is_none() {
            let image = existing_item
                .and_then(|item| item.images.iter().find(|image| image.id == *id))
                .ok_or_else(|| format!("copy image not found: {}", id))?;
            return Ok(image.clone());
        }
    }

    let data_url = image_input
        .data_url
        .as_ref()
        .ok_or_else(|| "new copy image requires dataUrl".to_string())?;
    let bytes = decode_image_data_url(data_url, &mime_type)?;
    let image_id = image_input
        .id
        .clone()
        .unwrap_or_else(|| next_copy_image_id(index));
    let relative_path = copy_image_relative_path(item_id, &image_id, &mime_type)?;
    let asset_path = copy_asset_path(app, &relative_path)?;

    if let Some(parent) = asset_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::write(&asset_path, &bytes).map_err(|error| error.to_string())?;

    Ok(CopyImage {
        id: image_id,
        file_name: sanitize_file_name(&image_input.file_name),
        mime_type,
        relative_path,
        size_bytes: bytes.len() as u64,
        created_at: timestamp(),
    })
}

fn remove_unused_copy_images(app: &AppHandle, old_item: &CopyItem, next_images: &[CopyImage]) {
    let next_ids: HashSet<&str> = next_images.iter().map(|image| image.id.as_str()).collect();
    for image in old_item
        .images
        .iter()
        .filter(|image| !next_ids.contains(image.id.as_str()))
    {
        if let Ok(path) = copy_asset_path(app, &image.relative_path) {
            let _ = fs::remove_file(path);
        }
    }
}

fn remove_copy_item_assets(app: &AppHandle, item_id: &str) {
    if let Ok(dir) = copy_assets_dir(app).map(|base| base.join(item_id)) {
        let _ = fs::remove_dir_all(dir);
    }
}

fn encode_image_as_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let image = image::load_from_memory(bytes).map_err(|error| error.to_string())?;
    let mut output = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut output, image::ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
}

fn export_copy_images_as_png(app: &AppHandle, item: &CopyItem) -> Result<Vec<PathBuf>, String> {
    if item.images.is_empty() {
        return Err("copy item has no images".to_string());
    }

    let export_dir = copy_file_clipboard_dir(app)?.join(&item.id);
    if export_dir.exists() {
        fs::remove_dir_all(&export_dir).map_err(|error| error.to_string())?;
    }
    fs::create_dir_all(&export_dir).map_err(|error| error.to_string())?;

    let mut paths = Vec::with_capacity(item.images.len());
    for (index, image) in item.images.iter().enumerate() {
        let source_path = copy_asset_path(app, &image.relative_path)?;
        let bytes = fs::read(&source_path).map_err(|error| error.to_string())?;
        let png_bytes = encode_image_as_png(&bytes)?;
        let export_path = export_dir.join(png_export_file_name(&image.file_name, index));
        fs::write(&export_path, png_bytes).map_err(|error| error.to_string())?;
        paths.push(export_path);
    }

    Ok(paths)
}

fn build_copy_payload(item: &CopyItem, image_data_urls: &[String]) -> CopyPayload {
    let mut html = String::from("<div>");
    if !item.text.trim().is_empty() {
        html.push_str("<div>");
        html.push_str(&text_to_html(&item.text));
        html.push_str("</div>");
    }
    for (image, data_url) in item.images.iter().zip(image_data_urls.iter()) {
        html.push_str("<div><img src=\"");
        html.push_str(&escape_html(data_url));
        html.push_str("\" alt=\"");
        html.push_str(&escape_html(&image.file_name));
        html.push_str("\" style=\"max-width:100%;height:auto;\"></div>");
    }
    html.push_str("</div>");

    CopyPayload {
        html,
        text: item.text.trim().to_string(),
        image_data_urls: image_data_urls.to_vec(),
    }
}

#[tauri::command]
pub fn list_copy_items(app: AppHandle) -> Result<Vec<CopyItemSummary>, String> {
    let mut items = load_copy_items(&app)?;
    items.sort_by_key(|item| item.order);
    Ok(items.into_iter().map(CopyItemSummary::from).collect())
}

#[tauri::command]
pub fn get_copy_item(app: AppHandle, id: String) -> Result<CopyItem, String> {
    load_copy_items(&app)?
        .into_iter()
        .find(|item| item.id == id)
        .ok_or_else(|| format!("copy item not found: {}", id))
}

#[tauri::command]
pub fn create_copy_item(app: AppHandle, input: CopyItemInput) -> Result<CopyItem, String> {
    validate_copy_image_count(input.images.len())?;

    let mut items = load_copy_items(&app)?;
    let now = timestamp();
    let item_id = next_copy_item_id();
    let order = items.iter().map(|item| item.order).max().unwrap_or(-1) + 1;

    let mut images = Vec::with_capacity(input.images.len());
    for (index, image_input) in input.images.iter().enumerate() {
        images.push(create_or_update_copy_image(
            &app, &item_id, image_input, None, index,
        )?);
    }

    let item = CopyItem {
        id: item_id,
        title: validate_copy_title(&input.title)?,
        text: input.text.trim().to_string(),
        images,
        order,
        created_at: now.clone(),
        updated_at: now,
    };

    items.push(item.clone());
    save_copy_items(&app, &items)?;
    Ok(item)
}

#[tauri::command]
pub fn update_copy_item(
    app: AppHandle,
    id: String,
    input: CopyItemInput,
) -> Result<CopyItem, String> {
    validate_copy_image_count(input.images.len())?;

    let mut items = load_copy_items(&app)?;
    let Some(index) = items.iter().position(|item| item.id == id) else {
        return Err(format!("copy item not found: {}", id));
    };

    let old_item = items[index].clone();
    let mut images = Vec::with_capacity(input.images.len());
    for (image_index, image_input) in input.images.iter().enumerate() {
        images.push(create_or_update_copy_image(
            &app,
            &old_item.id,
            image_input,
            Some(&old_item),
            image_index,
        )?);
    }
    remove_unused_copy_images(&app, &old_item, &images);

    items[index].title = validate_copy_title(&input.title)?;
    items[index].text = input.text.trim().to_string();
    items[index].images = images;
    items[index].updated_at = timestamp();

    let item = items[index].clone();
    save_copy_items(&app, &items)?;
    Ok(item)
}

#[tauri::command]
pub fn delete_copy_item(app: AppHandle, id: String) -> Result<(), String> {
    let mut items = load_copy_items(&app)?;
    let original_len = items.len();
    items.retain(|item| item.id != id);

    if items.len() == original_len {
        return Err(format!("copy item not found: {}", id));
    }

    remove_copy_item_assets(&app, &id);
    save_copy_items(&app, &items)
}

#[tauri::command]
pub fn reorder_copy_items(app: AppHandle, ids: Vec<String>) -> Result<(), String> {
    let mut items = load_copy_items(&app)?;
    if ids.len() != items.len() {
        return Err("reorder ids must contain the exact current copy item set".to_string());
    }

    let item_ids: HashSet<&str> = items.iter().map(|item| item.id.as_str()).collect();
    let mut seen = HashSet::new();
    for id in &ids {
        if !item_ids.contains(id.as_str()) {
            return Err(format!("unknown copy item id: {}", id));
        }
        if !seen.insert(id.as_str()) {
            return Err(format!("duplicate copy item id: {}", id));
        }
    }

    for (order, id) in ids.iter().enumerate() {
        if let Some(item) = items.iter_mut().find(|item| item.id == *id) {
            item.order = order as i32;
        }
    }

    save_copy_items(&app, &items)
}

#[tauri::command]
pub fn get_copy_payload(app: AppHandle, id: String) -> Result<CopyPayload, String> {
    let item = get_copy_item(app.clone(), id)?;
    let mut image_data_urls = Vec::with_capacity(item.images.len());

    for image in &item.images {
        let path = copy_asset_path(&app, &image.relative_path)?;
        let bytes = fs::read(path).map_err(|error| error.to_string())?;
        let encoded = BASE64_STANDARD.encode(bytes);
        image_data_urls.push(format!("data:{};base64,{}", image.mime_type, encoded));
    }

    Ok(build_copy_payload(&item, &image_data_urls))
}

#[tauri::command]
pub fn copy_image_files_to_clipboard(app: AppHandle, id: String) -> Result<(), String> {
    let item = get_copy_item(app.clone(), id)?;
    let paths = export_copy_images_as_png(&app, &item)?;
    file_clipboard::write_paths(&paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn copy_item_for_test() -> CopyItem {
        CopyItem {
            id: "copy-1".to_string(),
            title: "Quote <A>".to_string(),
            text: "Line 1\nLine 2 & note".to_string(),
            images: vec![CopyImage {
                id: "image-1".to_string(),
                file_name: "a.png".to_string(),
                mime_type: "image/png".to_string(),
                relative_path: "copy-assets/copy-1/image-1.png".to_string(),
                size_bytes: 4,
                created_at: "now".to_string(),
            }],
            order: 0,
            created_at: "now".to_string(),
            updated_at: "now".to_string(),
        }
    }

    #[test]
    fn copy_payload_escapes_body_html_and_keeps_plain_text_fallback() {
        let payload =
            build_copy_payload(&copy_item_for_test(), &["data:image/png;base64,AAAA".to_string()]);

        assert!(!payload.html.contains("Quote"));
        assert!(payload.html.contains("Line 2 &amp; note"));
        assert!(payload.html.contains("data:image/png;base64,AAAA"));
        assert_eq!(payload.text, "Line 1\nLine 2 & note");
    }

    #[test]
    fn copy_payload_exposes_image_data_urls_for_native_clipboard_writes() {
        let payload =
            build_copy_payload(&copy_item_for_test(), &["data:image/png;base64,AAAA".to_string()]);
        let serialized = serde_json::to_value(&payload).unwrap();

        assert_eq!(
            serialized["imageDataUrls"],
            serde_json::json!(["data:image/png;base64,AAAA"])
        );
    }

    #[test]
    fn png_export_file_names_always_use_png_extension() {
        assert_eq!(png_export_file_name("photo.jpg", 0), "photo.png");
        assert_eq!(png_export_file_name("photo.webp", 1), "photo-2.png");
        assert_eq!(png_export_file_name("产品 图.gif", 0), "____.png");
    }

    #[test]
    fn copy_payload_excludes_title_from_copied_content() {
        let mut item = copy_item_for_test();
        item.title = "Internal title".to_string();
        item.text = "Body text".to_string();

        let payload = build_copy_payload(&item, &["data:image/png;base64,AAAA".to_string()]);

        assert!(!payload.html.contains("Internal title"));
        assert!(payload.html.contains("Body text"));
        assert!(payload.html.contains("data:image/png;base64,AAAA"));
        assert_eq!(payload.text, "Body text");
    }

    #[test]
    fn unsupported_copy_image_type_is_rejected() {
        assert!(image_extension("image/png").is_some());
        assert!(image_extension("image/bmp").is_none());
    }
}
