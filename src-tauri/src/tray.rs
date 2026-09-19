use crate::clipboard::*;
use crate::config::{get, set};
use crate::window::{
    config_window, input_translate, ocr_recognize, ocr_translate, panel_window, updater_window,
};
use log::info;
use tauri::menu::{CheckMenuItem, Menu, MenuBuilder, MenuEvent, SubmenuBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_global_shortcut::GlobalShortcutExt;
use tauri_plugin_shell::ShellExt;

pub fn init_tray(app: &tauri::App) -> tauri::Result<()> {
    TrayIconBuilder::with_id("main")
        .icon(
            app.default_window_icon()
                .expect("missing application icon")
                .clone(),
        )
        .icon_as_template(cfg!(target_os = "macos"))
        .show_menu_on_left_click(!cfg!(target_os = "windows"))
        .on_menu_event(handle_menu)
        .on_tray_icon_event(|_, event| {
            #[cfg(target_os = "windows")]
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                on_tray_click();
            }
        })
        .build(app)?;
    Ok(())
}

#[tauri::command]
pub fn update_tray(app_handle: AppHandle, mut language: String, mut copy_mode: String) {
    if language.is_empty() {
        language = get("app_language")
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| {
                set("app_language", "en");
                "en".into()
            });
    }
    if copy_mode.is_empty() {
        copy_mode = get("translate_auto_copy")
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_else(|| {
                set("translate_auto_copy", "disable");
                "disable".into()
            });
    }
    let monitor = get("clipboard_monitor")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let tray = app_handle
        .tray_by_id("main")
        .expect("tray initialized before menu");
    tray.set_menu(Some(
        build_menu(&app_handle, &language, &copy_mode, monitor).unwrap(),
    ))
    .unwrap();
    tray.set_tooltip(Some(format!(
        "Pot Forge {} | Alt+Q: translate selection",
        app_handle.package_info().version
    )))
    .unwrap();
}

fn build_menu(
    app: &AppHandle,
    language: &str,
    mode: &str,
    monitor: bool,
) -> tauri::Result<Menu<tauri::Wry>> {
    let labels = labels(language);
    let text = |id: &str| {
        labels
            .iter()
            .find(|(key, _)| *key == id)
            .map(|(_, value)| *value)
            .unwrap_or("")
    };
    let clipboard = CheckMenuItem::with_id(
        app,
        "clipboard_monitor",
        text("clipboard_monitor"),
        true,
        monitor,
        None::<&str>,
    )?;
    let mut copies = SubmenuBuilder::new(app, text("auto_copy"));
    for id in [
        "copy_source",
        "copy_target",
        "copy_source_target",
        "copy_disable",
    ] {
        if id == "copy_disable" {
            copies = copies.separator();
        }
        let item = CheckMenuItem::with_id(
            app,
            id,
            text(id),
            true,
            mode == id.trim_start_matches("copy_"),
            None::<&str>,
        )?;
        copies = copies.item(&item);
    }
    MenuBuilder::new(app)
        .text("input_translate", text("input_translate"))
        .item(&clipboard)
        .item(&copies.build()?)
        .separator()
        .text("ocr_recognize", text("ocr_recognize"))
        .text("ocr_translate", text("ocr_translate"))
        .separator()
        .text("config", text("config"))
        .text("panel", text("panel"))
        .text("check_update", text("check_update"))
        .text("view_log", text("view_log"))
        .separator()
        .text("restart", text("restart"))
        .text("quit", text("quit"))
        .build()
}

fn handle_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "input_translate" => input_translate(),
        "ocr_recognize" => ocr_recognize(),
        "ocr_translate" => ocr_translate(),
        "config" => config_window(),
        "panel" => panel_window(),
        "check_update" => updater_window(),
        "clipboard_monitor" => {
            let enabled = !get("clipboard_monitor")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            set("clipboard_monitor", enabled);
            *app.state::<ClipboardMonitorEnableWrapper>()
                .0
                .lock()
                .unwrap() = enabled.to_string();
            if enabled {
                start_clipboard_monitor(app.clone());
            }
            update_tray(app.clone(), String::new(), String::new());
        }
        id @ ("copy_source" | "copy_target" | "copy_source_target" | "copy_disable") => {
            let mode = id.trim_start_matches("copy_");
            set("translate_auto_copy", mode);
            app.emit("translate_auto_copy_changed", mode).unwrap();
            update_tray(app.clone(), String::new(), mode.into());
        }
        "view_log" => {
            let path = app.path().app_log_dir().unwrap();
            app.shell()
                .open(path.to_string_lossy().to_string(), None)
                .unwrap();
        }
        "restart" => app.restart(),
        "quit" => {
            let _ = app.global_shortcut().unregister_all();
            crate::selection_helper::stop_selection_helper();
            info!("============== Quit App ==============");
            // Tauri 2's app.exit() from this callback does not terminate the
            // process while the HTTP server thread is still running.
            std::process::exit(0);
        }
        _ => {}
    }
}

#[cfg(target_os = "windows")]
fn on_tray_click() {
    let event = get("tray_click_event")
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_else(|| {
            set("tray_click_event", "config");
            "config".into()
        });
    match event.as_str() {
        "translate" => input_translate(),
        "ocr_recognize" => ocr_recognize(),
        "ocr_translate" => ocr_translate(),
        "disable" => {}
        _ => config_window(),
    }
}

fn labels(language: &str) -> &'static [(&'static str, &'static str)] {
    match language {
        "en" => &[
            ("input_translate", "Input Translate"),
            ("copy_source", "Source"),
            ("copy_target", "Target"),
            ("clipboard_monitor", "Clipboard Monitor"),
            ("copy_source_target", "Source+Target"),
            ("copy_disable", "Disable"),
            ("ocr_recognize", "OCR Recognize"),
            ("ocr_translate", "OCR Translate"),
            ("config", "Config"),
            ("panel", "Tasks"),
            ("check_update", "Check Update"),
            ("view_log", "View Log"),
            ("restart", "Restart"),
            ("quit", "Quit"),
            ("auto_copy", "Auto Copy"),
        ],
        "zh_cn" => &[
            ("input_translate", "输入翻译"),
            ("clipboard_monitor", "监听剪切板"),
            ("copy_source", "原文"),
            ("copy_target", "译文"),
            ("copy_source_target", "原文+译文"),
            ("copy_disable", "关闭"),
            ("ocr_recognize", "文字识别"),
            ("ocr_translate", "截图翻译"),
            ("config", "偏好设置"),
            ("panel", "任务"),
            ("check_update", "检查更新"),
            ("restart", "重启应用"),
            ("view_log", "查看日志"),
            ("quit", "退出"),
            ("auto_copy", "自动复制"),
        ],
        "zh_tw" => &[
            ("input_translate", "輸入翻譯"),
            ("clipboard_monitor", "偵聽剪貼簿"),
            ("copy_source", "原文"),
            ("copy_target", "譯文"),
            ("copy_source_target", "原文+譯文"),
            ("copy_disable", "關閉"),
            ("ocr_recognize", "文字識別"),
            ("ocr_translate", "截圖翻譯"),
            ("config", "偏好設定"),
            ("panel", "任務"),
            ("check_update", "檢查更新"),
            ("restart", "重啓程式"),
            ("view_log", "查看日誌"),
            ("quit", "退出"),
            ("auto_copy", "自動複製"),
        ],
        "ja" => &[
            ("input_translate", "翻訳を入力"),
            ("clipboard_monitor", "クリップボードを監視する"),
            ("copy_source", "原文"),
            ("copy_target", "訳文"),
            ("copy_source_target", "原文+訳文"),
            ("copy_disable", "閉じる"),
            ("ocr_recognize", "テキスト認識"),
            ("ocr_translate", "スクリーンショットの翻訳"),
            ("config", "プリファレンス設定"),
            ("panel", "タスク"),
            ("check_update", "更新を確認する"),
            ("restart", "アプリの再起動"),
            ("view_log", "ログを見る"),
            ("quit", "退出する"),
            ("auto_copy", "自動コピー"),
        ],
        "ko" => &[
            ("input_translate", "입력 번역"),
            ("clipboard_monitor", "감청 전단판"),
            ("copy_source", "원문"),
            ("copy_target", "번역문"),
            ("copy_source_target", "원문+번역문"),
            ("copy_disable", "닫기"),
            ("ocr_recognize", "문자인식"),
            ("ocr_translate", "스크린샷 번역"),
            ("config", "기본 설정"),
            ("panel", "작업"),
            ("check_update", "업데이트 확인"),
            ("restart", "응용 프로그램 다시 시작"),
            ("view_log", "로그 보기"),
            ("quit", "퇴출"),
            ("auto_copy", "자동 복사"),
        ],
        "fr" => &[
            ("input_translate", "Traduction d'entrée"),
            ("clipboard_monitor", "Surveiller le presse-papiers"),
            ("copy_source", "Source"),
            ("copy_target", "Cible"),
            ("copy_source_target", "Source+Cible"),
            ("copy_disable", "Désactiver"),
            ("ocr_recognize", "Reconnaissance de texte"),
            ("ocr_translate", "Traduction d'image"),
            ("config", "Paramètres"),
            ("panel", "Tâches"),
            ("check_update", "Vérifier les mises à jour"),
            ("restart", "Redémarrer l'application"),
            ("view_log", "Voir le journal"),
            ("quit", "Quitter"),
            ("auto_copy", "Copier automatiquement"),
        ],
        "de" => &[
            ("input_translate", "Eingabeübersetzung"),
            ("clipboard_monitor", "Zwischenablage überwachen"),
            ("copy_source", "Quelle"),
            ("copy_target", "Ziel"),
            ("copy_source_target", "Quelle+Ziel"),
            ("copy_disable", "Deaktivieren"),
            ("ocr_recognize", "Texterkennung"),
            ("ocr_translate", "Bildübersetzung"),
            ("config", "Einstellungen"),
            ("panel", "Aufgaben"),
            ("check_update", "Auf Updates prüfen"),
            ("restart", "Anwendung neu starten"),
            ("view_log", "Protokoll anzeigen"),
            ("quit", "Beenden"),
            ("auto_copy", "Automatisch kopieren"),
        ],
        "ru" => &[
            ("input_translate", "Ввод перевода"),
            ("clipboard_monitor", "Следить за буфером обмена"),
            ("copy_source", "Источник"),
            ("copy_target", "Цель"),
            ("copy_source_target", "Источник+Цель"),
            ("copy_disable", "Отключить"),
            ("ocr_recognize", "Распознавание текста"),
            ("ocr_translate", "Перевод изображения"),
            ("config", "Настройки"),
            ("panel", "Задачи"),
            ("check_update", "Проверить обновления"),
            ("restart", "Перезапустить приложение"),
            ("view_log", "Просмотр журнала"),
            ("quit", "Выход"),
            ("auto_copy", "Автоматическое копирование"),
        ],
        "fa" => &[
            ("input_translate", "متن"),
            ("clipboard_monitor", "گوش دادن به تخته برش"),
            ("copy_source", "منبع"),
            ("copy_target", "هدف"),
            ("copy_source_target", "منبع + هدف"),
            ("copy_disable", "متن"),
            ("ocr_recognize", "تشخیص متن"),
            ("ocr_translate", "ترجمه عکس"),
            ("config", "تنظیمات ترجیح"),
            ("panel", "وظایف"),
            ("check_update", "بررسی بروزرسانی"),
            ("restart", "راه‌اندازی مجدد برنامه"),
            ("view_log", "مشاهده گزارشات"),
            ("quit", "خروج"),
            ("auto_copy", "کپی خودکار"),
        ],
        "pt_br" => &[
            ("input_translate", "Traduzir Entrada"),
            ("clipboard_monitor", "Monitorando a área de transferência"),
            ("copy_source", "Origem"),
            ("copy_target", "Destino"),
            ("copy_source_target", "Origem+Destino"),
            ("copy_disable", "Desabilitar"),
            ("ocr_recognize", "Reconhecimento de Texto"),
            ("ocr_translate", "Tradução de Imagem"),
            ("config", "Configurações"),
            ("panel", "Tarefas"),
            ("check_update", "Checar por Atualização"),
            ("restart", "Reiniciar aplicativo"),
            ("view_log", "Exibir Registro"),
            ("quit", "Sair"),
            ("auto_copy", "Copiar Automaticamente"),
        ],
        "uk" => &[
            ("input_translate", "Введення перекладу"),
            ("clipboard_monitor", "Стежити за буфером обміну"),
            ("copy_source", "Джерело"),
            ("copy_target", "Мета"),
            ("copy_source_target", "Джерело+Мета"),
            ("copy_disable", "Відключивши"),
            ("ocr_recognize", "Розпізнавання тексту"),
            ("ocr_translate", "Переклад зображення"),
            ("config", "Настройка"),
            ("panel", "Завдання"),
            ("check_update", "Перевірити оновлення"),
            ("restart", "Перезапустити додаток"),
            ("view_log", "Перегляд журналу"),
            ("quit", "Вихід"),
            ("auto_copy", "Автоматичне копіювання"),
        ],
        _ => labels("en"),
    }
}
