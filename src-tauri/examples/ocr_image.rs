#[cfg(windows)]
fn main() -> windows::core::Result<()> {
    use windows::{
        core::HSTRING,
        Graphics::Imaging::BitmapDecoder,
        Media::Ocr::OcrEngine,
        Storage::{FileAccessMode, StorageFile},
    };
    let path = std::env::args().nth(1).expect("Supply the test image path");
    let file = StorageFile::GetFileFromPathAsync(&HSTRING::from(path))?.get()?;
    let bitmap = BitmapDecoder::CreateWithIdAsync(
        BitmapDecoder::PngDecoderId()?,
        &file.OpenAsync(FileAccessMode::Read)?.get()?,
    )?
    .get()?
    .GetSoftwareBitmapAsync()?
    .get()?;
    let text = OcrEngine::TryCreateFromUserProfileLanguages()?
        .RecognizeAsync(&bitmap)?
        .get()?
        .Text()?;
    println!("{}", text.to_string_lossy());
    Ok(())
}
#[cfg(not(windows))]
fn main() {
    eprintln!("Windows-only OCR diagnostic");
}
