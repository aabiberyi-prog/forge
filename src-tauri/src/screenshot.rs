use log::info;
use tauri::Manager;

#[tauri::command]
pub fn screenshot(x: i32, y: i32) -> Result<(), String> {
    info!("Screenshot screen with position: x={}, y={}", x, y);
    let monitors = xcap::Monitor::all().map_err(|error| error.to_string())?;
    for monitor in monitors {
        if monitor.x().map_err(|error| error.to_string())? == x
            && monitor.y().map_err(|error| error.to_string())? == y
        {
            let directory = crate::APP
                .get()
                .unwrap()
                .path()
                .app_cache_dir()
                .map_err(|error| error.to_string())?;
            std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
            monitor
                .capture_image()
                .map_err(|error| error.to_string())?
                .save(directory.join("pot_screenshot.png"))
                .map_err(|error| error.to_string())?;
            return Ok(());
        }
    }
    Err(format!("No monitor found at ({x}, {y})"))
}
