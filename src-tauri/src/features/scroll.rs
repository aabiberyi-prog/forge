use image::{Rgba, RgbaImage};
use log::info;

const STRIP: u32 = 48;
const MAX_FRAMES: usize = 40;

/// Find how many top rows of `next` overlap the bottom of `prev`.
/// Uses a 1D phase-correlation-style peak on row signatures (SAD).
pub fn overlap_rows(prev: &RgbaImage, next: &RgbaImage) -> u32 {
    if prev.width() != next.width() || prev.height() < 4 || next.height() < 4 {
        return 0;
    }
    let height = prev.height().min(next.height());
    let max_overlap = height.saturating_sub(2).min(height * 9 / 10);
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
    let pixel_count = (best_overlap * prev.width()).max(1) as i64;
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
    for y in 0..overlap {
        for x in 0..width {
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
    use crate::features::capture::{
        cache_cut_path, capture_filename, capture_save_dir, copy_png_bytes, record_capture_history,
    };
    use crate::APP;
    use std::fs;
    use std::io::Cursor;
    use std::thread;
    use std::time::Duration;
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
        MOUSEEVENTF_WHEEL, MOUSEINPUT,
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

    fn focus_and_scroll(x: i32, y: i32) {
        unsafe {
            let _ = SetCursorPos(x, y);
        }
        thread::sleep(Duration::from_millis(40));
        send_mouse(MOUSEEVENTF_LEFTDOWN, 0);
        send_mouse(MOUSEEVENTF_LEFTUP, 0);
        thread::sleep(Duration::from_millis(80));
        send_mouse(MOUSEEVENTF_WHEEL, -WHEEL_DELTA * 3);
    }

    fn grab_region(left: u32, top: u32, width: u32, height: u32) -> Result<RgbaImage, String> {
        let monitors = xcap::Monitor::all().map_err(|error| error.to_string())?;
        for monitor in monitors {
            let mx = monitor.x().map_err(|error| error.to_string())?;
            let my = monitor.y().map_err(|error| error.to_string())?;
            let mw = monitor.width().map_err(|error| error.to_string())?;
            let mh = monitor.height().map_err(|error| error.to_string())?;
            let right = left + width;
            let bottom = top + height;
            if (left as i32) >= mx
                && (top as i32) >= my
                && (right as i32) <= mx + mw as i32
                && (bottom as i32) <= my + mh as i32
            {
                let full = monitor
                    .capture_image()
                    .map_err(|error| error.to_string())?;
                let crop_x = left.saturating_sub(mx as u32);
                let crop_y = top.saturating_sub(my as u32);
                let cropped = image::imageops::crop_imm(&full, crop_x, crop_y, width, height);
                return Ok(cropped.to_image());
            }
        }
        Err("region is not inside a single monitor".into())
    }

    pub fn run(left: u32, top: u32, width: u32, height: u32) -> Result<String, String> {
        if width < 16 || height < 16 {
            return Err("scroll region is too small".into());
        }
        let mut frames = Vec::new();
        frames.push(grab_region(left, top, width, height)?);
        let cx = (left + width / 2) as i32;
        let cy = (top + height / 2) as i32;
        for _ in 0..MAX_FRAMES {
            focus_and_scroll(cx, cy);
            thread::sleep(Duration::from_millis(220));
            let next = grab_region(left, top, width, height)?;
            let overlap = overlap_rows(frames.last().unwrap(), &next);
            if overlap < 8 {
                frames.push(next);
                break;
            }
            if overlap >= next.height().saturating_sub(2) {
                break;
            }
            frames.push(next);
        }
        info!("Scrolling capture gathered {} frames", frames.len());
        let stitched = stitch_frames(&frames)?;
        let mut encoded = Cursor::new(Vec::new());
        stitched
            .write_to(&mut encoded, image::ImageFormat::Png)
            .map_err(|error| error.to_string())?;
        let bytes = encoded.into_inner();
        let app = APP.get().ok_or("app handle is not ready")?;
        let cut_path = cache_cut_path(app)?;
        fs::write(&cut_path, &bytes).map_err(|error| error.to_string())?;
        let dir = capture_save_dir();
        fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
        let save_path = dir.join(capture_filename(std::time::SystemTime::now()));
        fs::write(&save_path, &bytes).map_err(|error| error.to_string())?;
        copy_png_bytes(&bytes)?;
        let _ = record_capture_history(app, &save_path, "scroll");
        Ok(save_path.to_string_lossy().to_string())
    }
}

#[tauri::command]
pub fn scrolling_capture(left: u32, top: u32, width: u32, height: u32) -> Result<String, String> {
    #[cfg(windows)]
    {
        win::run(left, top, width, height)
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
}
