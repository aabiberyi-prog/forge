use image::{Rgba, RgbaImage};
use log::info;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

const STRIP: u32 = 48;
const MAX_FRAMES: usize = 40;
const SAMPLE_X: u32 = 4;

static SCROLL_CANCEL: AtomicBool = AtomicBool::new(false);

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScrollCaptureResult {
    pub cut_path: Option<String>,
    pub frames: u32,
    pub stopped: String,
    pub error: Option<String>,
}

#[tauri::command]
pub fn cancel_scrolling_capture() {
    SCROLL_CANCEL.store(true, Ordering::SeqCst);
}

pub fn crop_offset(region: i32, monitor: i32) -> Option<u32> {
    let offset = region - monitor;
    if offset < 0 {
        None
    } else {
        Some(offset as u32)
    }
}

pub fn frames_nearly_equal(a: &RgbaImage, b: &RgbaImage) -> bool {
    if a.width() != b.width() || a.height() != b.height() {
        return false;
    }
    let mut sad = 0i64;
    let mut count = 0i64;
    let step = SAMPLE_X.max(1);
    for y in (0..a.height()).step_by(2) {
        for x in (0..a.width()).step_by(step as usize) {
            let pa = a.get_pixel(x, y).0;
            let pb = b.get_pixel(x, y).0;
            sad += (pa[0] as i64 - pb[0] as i64).abs()
                + (pa[1] as i64 - pb[1] as i64).abs()
                + (pa[2] as i64 - pb[2] as i64).abs();
            count += 1;
        }
    }
    count > 0 && sad / count < 6
}

/// Find how many top rows of `next` overlap the bottom of `prev`.
/// Uses a 1D phase-correlation-style peak on row signatures (SAD).
pub fn overlap_rows(prev: &RgbaImage, next: &RgbaImage) -> u32 {
    if prev.width() != next.width() || prev.height() < 4 || next.height() < 4 {
        return 0;
    }
    let height = prev.height().min(next.height());
    let max_overlap = height.saturating_sub(2);
    let min_overlap = STRIP.min(height / 3).max(4);
    let mut best_overlap = 0u32;
    let mut best_score = i64::MAX;
    let mut overlap = min_overlap;
    while overlap <= max_overlap {
        let score = strip_sad(prev, next, overlap);
        if score < best_score {
            best_score = score;
            best_overlap = overlap;
        }
        overlap += 1;
    }
    let sampled_width = (prev.width() / SAMPLE_X.max(1)).max(1);
    let pixel_count = (best_overlap * sampled_width).max(1) as i64;
    if best_score / pixel_count > 18 {
        0
    } else {
        best_overlap
    }
}

fn strip_sad(prev: &RgbaImage, next: &RgbaImage, overlap: u32) -> i64 {
    let mut sad = 0i64;
    let width = prev.width();
    let prev_top = prev.height() - overlap;
    let step = SAMPLE_X.max(1);
    for y in 0..overlap {
        for x in (0..width).step_by(step as usize) {
            let a = prev.get_pixel(x, prev_top + y).0;
            let b = next.get_pixel(x, y).0;
            sad += (a[0] as i64 - b[0] as i64).abs()
                + (a[1] as i64 - b[1] as i64).abs()
                + (a[2] as i64 - b[2] as i64).abs();
        }
    }
    sad
}

pub fn stitch_frames(frames: &[RgbaImage]) -> Result<RgbaImage, String> {
    let Some(first) = frames.first() else {
        return Err("no frames".into());
    };
    let mut canvas = first.clone();
    for next in frames.iter().skip(1) {
        let overlap = overlap_rows(&canvas, next);
        if overlap == 0 || overlap >= next.height() {
            break;
        }
        let extra = next.height() - overlap;
        let mut grown = RgbaImage::new(canvas.width(), canvas.height() + extra);
        image::imageops::replace(&mut grown, &canvas, 0, 0);
        let addition = image::imageops::crop_imm(next, 0, overlap, next.width(), extra).to_image();
        image::imageops::replace(&mut grown, &addition, 0, canvas.height() as i64);
        canvas = grown;
    }
    Ok(canvas)
}

fn unique_row_image(width: u32, height: u32, start_row: u32) -> RgbaImage {
    let mut image = RgbaImage::new(width, height);
    for y in 0..height {
        let tone = ((start_row + y) % 256) as u8;
        for x in 0..width {
            image.put_pixel(x, y, Rgba([tone, 255 - tone, x as u8, 255]));
        }
    }
    image
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::features::capture::cache_cut_path;
    use crate::APP;
    use std::fs;
    use std::io::Cursor;
    use std::thread;
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_WHEEL, MOUSEINPUT,
    };
    use windows::Win32::UI::WindowsAndMessaging::SetCursorPos;

    const WHEEL_DELTA: i32 = 120;

    fn send_mouse(flags: windows::Win32::UI::Input::KeyboardAndMouse::MOUSE_EVENT_FLAGS, data: i32) {
        let input = INPUT {
            r#type: INPUT_MOUSE,
            Anonymous: INPUT_0 {
                mi: MOUSEINPUT {
                    dx: 0,
                    dy: 0,
                    mouseData: data as u32,
                    dwFlags: flags,
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        unsafe {
            let _ = SendInput(&[input], std::mem::size_of::<INPUT>() as i32);
        }
    }

    fn escape_pressed() -> bool {
        unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(0x1B) as u16 & 0x8000 != 0 }
    }

    fn wait_interruptible(total_ms: u64) -> bool {
        let mut waited = 0u64;
        while waited < total_ms {
            if SCROLL_CANCEL.load(Ordering::SeqCst) || escape_pressed() {
                SCROLL_CANCEL.store(true, Ordering::SeqCst);
                return true;
            }
            thread::sleep(Duration::from_millis(50));
            waited += 50;
        }
        false
    }

    fn focus_and_scroll(x: i32, y: i32) {
        unsafe {
            let _ = SetCursorPos(x, y);
        }
        if wait_interruptible(40) {
            return;
        }
        send_mouse(MOUSEEVENTF_WHEEL, -WHEEL_DELTA * 3);
    }

    fn grab_region(left: i32, top: i32, width: u32, height: u32) -> Result<RgbaImage, String> {
        let monitors = xcap::Monitor::all().map_err(|error| error.to_string())?;
        for monitor in monitors {
            let mx = monitor.x().map_err(|error| error.to_string())?;
            let my = monitor.y().map_err(|error| error.to_string())?;
            let mw = monitor.width().map_err(|error| error.to_string())? as i32;
            let mh = monitor.height().map_err(|error| error.to_string())? as i32;
            let right = left + width as i32;
            let bottom = top + height as i32;
            if left >= mx && top >= my && right <= mx + mw && bottom <= my + mh {
                let Some(crop_x) = crop_offset(left, mx) else {
                    continue;
                };
                let Some(crop_y) = crop_offset(top, my) else {
                    continue;
                };
                let full = monitor
                    .capture_image()
                    .map_err(|error| error.to_string())?;
                let cropped = image::imageops::crop_imm(&full, crop_x, crop_y, width, height);
                return Ok(cropped.to_image());
            }
        }
        Err("region is not inside a single monitor".into())
    }

    pub fn run(left: i32, top: i32, width: u32, height: u32) -> Result<ScrollCaptureResult, String> {
        SCROLL_CANCEL.store(false, Ordering::SeqCst);
        if width < 16 || height < 16 {
            return Err("scroll region is too small".into());
        }
        let mut frames = Vec::new();
        frames.push(grab_region(left, top, width, height)?);
        let cx = left + (width / 2) as i32;
        let cy = top + (height / 2) as i32;
        let mut stopped = "max_frames".to_string();
        for _ in 0..MAX_FRAMES {
            if SCROLL_CANCEL.load(Ordering::SeqCst) || escape_pressed() {
                stopped = "cancel".into();
                break;
            }
            focus_and_scroll(cx, cy);
            if wait_interruptible(200) {
                stopped = "cancel".into();
                break;
            }
            let next = grab_region(left, top, width, height)?;
            if frames_nearly_equal(frames.last().unwrap(), &next) {
                stopped = "no_change".into();
                break;
            }
            if frames.len() > 1 && frames.iter().any(|prev| frames_nearly_equal(prev, &next)) {
                stopped = "repeat".into();
                break;
            }
            let overlap = overlap_rows(frames.last().unwrap(), &next);
            if overlap == 0 {
                stopped = "low_confidence".into();
                break;
            }
            if overlap >= next.height().saturating_sub(2) {
                stopped = "end".into();
                break;
            }
            frames.push(next);
            stopped = "end".into();
        }
        info!(
            "Scrolling capture gathered {} frames ({stopped})",
            frames.len()
        );
        let stitched = stitch_frames(&frames)?;
        let mut encoded = Cursor::new(Vec::new());
        stitched
            .write_to(&mut encoded, image::ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        let bytes = encoded.into_inner();
        let app = APP.get().ok_or("app handle is not ready")?;
        let cut_path = cache_cut_path(app)?;
        fs::write(&cut_path, &bytes).map_err(|error| error.to_string())?;
        Ok(ScrollCaptureResult {
            cut_path: Some(cut_path.to_string_lossy().to_string()),
            frames: frames.len() as u32,
            stopped,
            error: None,
        })
    }
}

#[tauri::command]
pub async fn scrolling_capture(
    left: i32,
    top: i32,
    width: u32,
    height: u32,
) -> Result<ScrollCaptureResult, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || win::run(left, top, width, height))
            .await
            .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (left, top, width, height);
        Err("Scrolling capture is Windows-only".into())
    }
}

#[tauri::command]
pub fn scroll_capture_available() -> bool {
    cfg!(windows)
}

pub fn start_scrolling_capture() {
    #[cfg(windows)]
    {
        crate::features::capture::set_capture_mode("scroll");
        crate::window::open_screenshot_window();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn overlap_detects_known_vertical_shift() {
        let first = unique_row_image(12, 40, 0);
        let second = unique_row_image(12, 40, 16);
        let overlap = overlap_rows(&first, &second);
        assert!(
            (24..=28).contains(&overlap),
            "expected ~24 overlapping rows, got {overlap}"
        );
    }

    #[test]
    fn stitch_grows_by_new_rows_only() {
        let first = unique_row_image(8, 20, 0);
        let second = unique_row_image(8, 20, 8);
        let stitched = stitch_frames(&[first, second]).unwrap();
        assert_eq!(stitched.width(), 8);
        assert!(stitched.height() > 20);
        assert!(stitched.height() <= 40);
    }

    #[test]
    fn signed_monitor_offset_maps_left_of_primary() {
        assert_eq!(crop_offset(-100, -1920), Some(1820));
        assert_eq!(crop_offset(10, 0), Some(10));
        assert_eq!(crop_offset(-10, 0), None);
    }

    #[test]
    fn identical_frames_are_end_of_content() {
        let frame = unique_row_image(10, 20, 3);
        assert!(frames_nearly_equal(&frame, &frame));
        let other = unique_row_image(10, 20, 80);
        assert!(!frames_nearly_equal(&frame, &other));
    }

    #[test]
    fn cancel_flag_is_readable() {
        SCROLL_CANCEL.store(true, Ordering::SeqCst);
        assert!(SCROLL_CANCEL.load(Ordering::SeqCst));
        SCROLL_CANCEL.store(false, Ordering::SeqCst);
        assert!(!SCROLL_CANCEL.load(Ordering::SeqCst));
    }
}
