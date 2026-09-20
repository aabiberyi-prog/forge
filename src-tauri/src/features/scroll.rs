use image::{Rgba, RgbaImage};
use log::info;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

const STRIP: u32 = 48;
const MAX_FRAMES: usize = 40;
const SAMPLE_X: u32 = 4;
const MAX_PIXELS: u64 = 64_000_000;
static SCROLL_RUNNING: AtomicBool = AtomicBool::new(false);
static SCROLL_FRAMES: AtomicU32 = AtomicU32::new(0);

pub fn progress() -> Option<u32> {
    SCROLL_RUNNING.load(Ordering::SeqCst).then(|| SCROLL_FRAMES.load(Ordering::SeqCst))
}

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
    let mut changed = 0i64;
    let step = SAMPLE_X.max(1);
    for y in (0..a.height()).step_by(2) {
        for x in (0..a.width()).step_by(step as usize) {
            let pa = a.get_pixel(x, y).0;
            let pb = b.get_pixel(x, y).0;
            sad += (pa[0] as i64 - pb[0] as i64).abs()
                + (pa[1] as i64 - pb[1] as i64).abs()
                + (pa[2] as i64 - pb[2] as i64).abs();
            if pa[..3].iter().zip(&pb[..3]).any(|(a, b)| (*a as i16 - *b as i16).abs() > 4) { changed += 1; }
            count += 1;
        }
    }
    count > 0 && sad < count && changed * 2000 <= count
}

/// Match a bounded set of samples at each overlap; cancellation is checked during search.
pub fn overlap_rows(prev: &RgbaImage, next: &RgbaImage) -> u32 {
    find_overlap(prev, next, || false).unwrap_or(0)
}

fn find_overlap(prev: &RgbaImage, next: &RgbaImage, mut cancelled: impl FnMut() -> bool) -> Result<u32, String> {
    if prev.width() != next.width() || prev.height() < 4 || next.height() < 4 { return Ok(0); }
    let height = prev.height().min(next.height());
    let min_overlap = STRIP.min(height / 3).max(4);
    let mut best = (0, f64::INFINITY);
    let mut runner_up = f64::INFINITY;
    let columns = prev.width().min(32);
    for overlap in min_overlap..=height.saturating_sub(2) {
        if cancelled() { return Err("cancelled".into()); }
        let rows = overlap.min(48);
        let mut sad = 0u64;
        for row in 0..rows {
            let y = row * (overlap - 1) / (rows - 1).max(1);
            for column in 0..columns {
                let x = column * prev.width().saturating_sub(1) / columns.saturating_sub(1).max(1);
                let a = prev.get_pixel(x, prev.height() - overlap + y).0;
                let b = next.get_pixel(x, y).0;
                sad += a[..3].iter().zip(&b[..3]).map(|(a, b)| (*a as i32 - *b as i32).unsigned_abs() as u64).sum::<u64>();
            }
        }
        let score = sad as f64 / (rows * columns).max(1) as f64;
        if score < best.1 { runner_up = best.1; best = (overlap, score); }
        else { runner_up = runner_up.min(score); }
    }
    if best.1 > 18.0 || runner_up - best.1 < 0.15 { Ok(0) } else { Ok(best.0) }
}

pub fn stitch_frames(frames: &[RgbaImage]) -> Result<RgbaImage, String> {
    let overlaps = frames.windows(2).map(|pair| overlap_rows(&pair[0], &pair[1])).collect::<Vec<_>>();
    stitch_with_overlaps(frames, &overlaps, || false)
}

fn stitch_with_overlaps(frames: &[RgbaImage], overlaps: &[u32], mut cancelled: impl FnMut() -> bool) -> Result<RgbaImage, String> {
    let first = frames.first().ok_or("no frames")?;
    if frames.iter().any(|frame| frame.dimensions() != first.dimensions()) { return Err("scroll frame dimensions differ".into()); }
    let count = overlaps.iter().take_while(|overlap| **overlap > 0 && **overlap < first.height()).count();
    let height = first.height() + overlaps.iter().take(count).map(|overlap| first.height() - overlap).sum::<u32>();
    if first.width() as u64 * height as u64 > MAX_PIXELS { return Err("scroll image exceeds memory limit".into()); }
    let mut output = RgbaImage::new(first.width(), height);
    let mut dest_y = 0;
    for (index, frame) in frames.iter().take(count + 1).enumerate() {
        let start = if index == 0 { 0 } else { overlaps[index - 1] };
        for y in start..frame.height() {
            if cancelled() { return Err("cancelled".into()); }
            let row_bytes = first.width() as usize * 4;
            let source = y as usize * row_bytes;
            let dest = dest_y as usize * row_bytes;
            output.as_mut()[dest..dest + row_bytes].copy_from_slice(&frame.as_raw()[source..source + row_bytes]);
            dest_y += 1;
        }
    }
    Ok(output)
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
    use tauri::Emitter;
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

    struct EscapeWatcher {
        stop: std::sync::Arc<AtomicBool>,
        worker: Option<std::thread::JoinHandle<()>>,
    }

    impl EscapeWatcher {
        fn start() -> Self {
            let stop = std::sync::Arc::new(AtomicBool::new(false));
            let signal = stop.clone();
            let worker = thread::spawn(move || {
                while !signal.load(Ordering::SeqCst) {
                    if escape_pressed() { SCROLL_CANCEL.store(true, Ordering::SeqCst); }
                    thread::sleep(Duration::from_millis(25));
                }
            });
            Self { stop, worker: Some(worker) }
        }
    }

    impl Drop for EscapeWatcher {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            if let Some(worker) = self.worker.take() { let _ = worker.join(); }
        }
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
        let _escape_watcher = EscapeWatcher::start();
        if width < 16 || height < 16 {
            return Err("scroll region is too small".into());
        }
        if width as u64 * height as u64 > MAX_PIXELS { return Err("scroll region exceeds memory limit".into()); }
        let mut frames = vec![grab_region(left, top, width, height)?];
        let mut overlaps = Vec::new();
        let cancelled = || SCROLL_CANCEL.load(Ordering::SeqCst) || escape_pressed();
        let publish = |count: u32| {
            SCROLL_FRAMES.store(count, Ordering::SeqCst);
            if let Some(app) = APP.get() {
                let _ = app.emit("scroll-capture-progress", count);
                crate::tray::update_tray(app.clone(), String::new(), String::new());
            }
        };
        publish(1);
        let cx = left + (width / 2) as i32;
        let cy = top + (height / 2) as i32;
        let mut stopped = "max_frames".to_string();
        for _ in 1..MAX_FRAMES {
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
            let overlap = match find_overlap(frames.last().unwrap(), &next, cancelled) {
                Ok(value) => value,
                Err(_) => { stopped = "cancel".into(); break; }
            };
            if overlap == 0 {
                stopped = "low_confidence".into();
                break;
            }
            if overlap >= next.height().saturating_sub(2) {
                stopped = "end".into();
                break;
            }
            if (frames.len() as u64 + 1) * width as u64 * height as u64 > MAX_PIXELS {
                stopped = "memory_limit".into(); break;
            }
            overlaps.push(overlap);
            frames.push(next);
            publish(frames.len() as u32);
        }
        info!(
            "Scrolling capture gathered {} frames ({stopped})",
            frames.len()
        );
        if stopped == "cancel" || cancelled() {
            return Ok(ScrollCaptureResult { cut_path: None, frames: frames.len() as u32, stopped: "cancel".into(), error: None });
        }
        let stitched = match stitch_with_overlaps(&frames, &overlaps, cancelled) {
            Ok(image) => image,
            Err(_) if cancelled() => return Ok(ScrollCaptureResult { cut_path: None, frames: frames.len() as u32, stopped: "cancel".into(), error: None }),
            Err(error) => return Err(error),
        };
        let mut encoded = Cursor::new(Vec::new());
        stitched
            .write_to(&mut encoded, image::ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        let bytes = encoded.into_inner();
        if cancelled() {
            return Ok(ScrollCaptureResult { cut_path: None, frames: frames.len() as u32, stopped: "cancel".into(), error: None });
        }
        let app = APP.get().ok_or("app handle is not ready")?;
        let cut_path = cache_cut_path(app)?;
        fs::write(&cut_path, &bytes).map_err(|error| error.to_string())?;
        Ok(ScrollCaptureResult {
            cut_path: Some(cut_path.to_string_lossy().to_string()),
            frames: frames.len() as u32,
            error: if ["no_change", "end"].contains(&stopped.as_str()) { None } else { Some(format!("Partial scrolling capture: {stopped}")) },
            stopped,
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
        if SCROLL_RUNNING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
            return Err("a scrolling capture is already running".into());
        }
        SCROLL_FRAMES.store(0, Ordering::SeqCst);
        let result = tauri::async_runtime::spawn_blocking(move || win::run(left, top, width, height)).await;
        SCROLL_RUNNING.store(false, Ordering::SeqCst);
        if let Some(app) = crate::APP.get() { crate::tray::update_tray(app.clone(), String::new(), String::new()); }
        result.map_err(|error| error.to_string())?
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
    fn matching_and_stitching_cancel_during_work() {
        let frame = unique_row_image(32, 100, 0);
        assert_eq!(find_overlap(&frame, &frame, || true).unwrap_err(), "cancelled");
        assert_eq!(stitch_with_overlaps(&[frame], &[], || true).unwrap_err(), "cancelled");
    }

    #[test]
    fn full_size_overlap_detects_shift_without_quadratic_pixel_scan() {
        let frame = |offset: u32| {
            RgbaImage::from_fn(1920, 1080, |x, y| {
                let n = (y + offset).wrapping_mul(2654435761) ^ x.wrapping_mul(374761393);
                Rgba([n as u8, (n >> 8) as u8, (n >> 16) as u8, 255])
            })
        };
        let first = frame(0); let second = frame(300);
        let start = std::time::Instant::now();
        assert_eq!(overlap_rows(&first, &second), 780);
        eprintln!("1080p overlap search: {:?}", start.elapsed());
    }

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
