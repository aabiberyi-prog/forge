// Read-only playback evidence for explicitly supplied test-process IDs. No audio is recorded.
#[cfg(windows)]
fn main() -> windows::core::Result<()> {
    use std::collections::BTreeMap;
    use windows::core::Interface;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };
    let pids: Vec<u32> = std::env::args()
        .skip(1)
        .map(|pid| pid.parse().expect("PID must be numeric"))
        .collect();
    assert!(!pids.is_empty(), "Supply test-process IDs");
    let mut peaks: BTreeMap<u32, (f32, u32)> = BTreeMap::new();
    unsafe {
        CoInitializeEx(None, COINIT_MULTITHREADED).ok()?;
        {
            let devices: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = devices.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
            println!("Monitoring supplied test processes for 30 seconds");
            for _ in 0..300 {
                let sessions = manager.GetSessionEnumerator()?;
                for index in 0..sessions.GetCount()? {
                    let session = sessions.GetSession(index)?;
                    let control: IAudioSessionControl2 = session.cast()?;
                    let pid = control.GetProcessId()?;
                    if !pids.contains(&pid) {
                        continue;
                    }
                    let meter: IAudioMeterInformation = session.cast()?;
                    let value = meter.GetPeakValue()?;
                    let entry = peaks.entry(pid).or_default();
                    entry.0 = entry.0.max(value);
                    if value > 0.0001 {
                        entry.1 += 1;
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
        }
        CoUninitialize();
    }
    println!("{}", serde_json::to_string(&peaks).unwrap());
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Windows-only playback meter");
}
