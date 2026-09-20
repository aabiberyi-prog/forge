# 真实截图验收与修复（2026-09-19）

用户症状：能够框选，但无法进入编辑、保存或复制。本轮以此故障为验收范围，未替换正式安装版、迁移用户数据或发布版本。

## 已复现的三个问题

1. **截图画布被跨域图像污染。** 原生截图成功生成 3840 × 2160 PNG，WebView 图像加载完成，但 `getImageData` 报 `SecurityError: The canvas has been tainted by cross-origin data`。应用页面是 `https://tauri.localhost`，图像是 `https://asset.localhost`，图像的 `crossOrigin` 为 null。同一文件用 anonymous CORS 加载后，像素读取及 PNG 导出成功。这一对照将故障定位到编辑入口，而非仅仅猜测快捷键或显卡截图失败。
2. **文字标注输入框立即失焦消失。** 实际事件依次为画布 pointerdown → textarea 获得焦点 → 画布默认 mousedown → textarea 失焦。文字工具阻止默认 pointerdown 行为后，输入框保留焦点，中英文文字可提交并导出。
3. **同步创建贴图窗口导致 Windows WebView2 死锁。** 剪贴板图像可读取，但 `pin_from_clipboard` 调用超过 30 秒未返回，日志停在 `Creating new window: pin-1`。本地 Tauri 2.11.5 的 WebviewWindowBuilder 文档明确记录同步命令创建窗口的死锁限制。将五个相关命令改为异步调度后，窗口创建、复制及保存命令正常返回。

## 改动

- 截图选择器和标注器图像均使用 `crossOrigin='anonymous'`，覆盖普通截图及文件形式的滚动截图输入。
- 截图初始化顺序等待模式、显示器、原生截图及文件路径；图像 URL 带时间戳，避免复用旧缓存。失败时显示错误并使窗口可见，保留取消入口。
- 文字工具保留 textarea 焦点；标注图像加载失败时显示错误并禁用保存。
- `finish_capture`、`retry_capture_copy`、`open_pin_from_path`、`pin_from_clipboard`、`open_pin_history_window` 使用异步命令调度。

## 实际验证

本机显示器 3840 × 2160、缩放 150%。独立应用标识为 `com.aabiber.pot-forge.review`。使用真实 WebView2、原生 xcap、PNG 文件、SQLite 历史及 Windows 系统剪贴板。

| 检查单元 | 通过 / 执行 | 证据 |
| --- | --- | --- |
| 矩形、椭圆、自由形状、多区域 | 4 / 4 | 实际截图 → 鼠标框选 → 标注器 → PNG 导出 |
| 12 种标注工具 | 12 / 12 | 绘制及导出冒烟验证；文字/气泡实际输入中英文 |
| 编辑器裁剪、文件形式图像输入 | 2 / 2 | 输出尺寸改变；asset 图像不再污染画布 |
| 保存、历史、剪贴板读回 | 4 / 4 | 每种框选各产生一条历史记录，保存文件与剪贴板贴图的解码 RGBA SHA-256 完全一致 |
| 多贴图及历史窗口 | 2 / 2 | 四个独立贴图 WebView 共存，历史窗口创建不再死锁 |
| 加载失败 | 2 / 2 | 缺失图像及原生命令拒绝均显示错误，可取消 |
| 其余原生贴图入口 | 3 / 3 | 文件贴图、重试复制并贴图、保存并贴图均返回成功；三个窗口图像均加载为 900 × 600 |
| 现有 JavaScript 回归 | 47 / 47 | `node .scripts/run-tests.mjs` |

主验收脚本共 26 项，补验 3 项，合计 **29 / 29**；主验收零未捕获页面异常。第一次运行在关闭历史窗口时因页面先关闭产生脚本收尾错误，修正关闭等待后完整重跑 26 项通过。前端及独立 Review 原生构建通过。未把此前 Rust 测试计为本轮重新执行。

可复跑脚本：`.scripts/tests/run-capture-webview.cjs`。先启动独立 Review，给该进程设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=19229 --remote-debugging-address=127.0.0.1`，随后设置 `FORGE_PLAYWRIGHT_MODULE` 指向已有 Playwright 安装、`FORGE_REVIEW_BINARY` 指向验收二进制并运行脚本。脚本核对 Review 标识，默认将报告写到系统临时目录。

本轮机器证据：系统临时目录中的 `forge-capture-webview.json`、`forge-capture-pin-entrypoints.json`、`forge-capture-fixed-build.log`、`forge-capture-js.log`。截图内容只保存在本机隔离 Review 缓存，不进入 Git。

## 身份与限制

- 源码基线：`4864c3feba38e19711e1e9250fcd8e756458c19d` 加本轮未提交改动。
- 源码指纹：`ab0078abd57f1728ad41e8f318a1192ac25fdc6766c7a3bb7adecfebcac09bf5`，验收前后一致。
- Review 二进制：`C:/cargo-target/forge/debug/Pot Forge Review.exe`。
- Review SHA-256：`6fae9ba7b6f23f984cf2c611634ef72d827f4513371d8231078f253d7a4d83d2`。
- 正式安装版仍为 `D:/Pot Forge/Pot Forge.exe`，SHA-256 `81ef17eb65ee9d29f42eb8805327741596e0c76722c89b44089c0bfd62581c3a`；未包含本轮修复。

桌面自动化插件因 native pipe 不存在而不可用，因此改接 Review 的本地 WebView2 调试通道。原生 OCR HTTP 入口创建真实截图窗口；测试仅将前端获取的模式替换为 save，以自动驱动保存/标注分支。真实截图、图像文件、保存、历史、剪贴板和贴图命令均未替换。负例刻意注入缺失文件及原生拒绝。

**未验收：** 操作系统级快捷键及托盘输入、真实目标页面的滚动拼接、多显示器/其他 DPI、OCR 服务、安装/更新/回滚、正式配置与历史迁移。本轮未覆盖全部项目：42 条总验收契约中的 7 条必需桌面项目仍需各自完整验收；未将它们批量改为通过，发布门禁保持未就绪。标注工具检查是绘制/导出冒烟，不代表全部属性和交互组合均已实测。

## 后续与停止条件

本轮 29 项与 47 项检查均已全过。正式替换需另行授权并保留旧程序及配置备份；替换后当天、首次使用前复测 Alt+1 → 框选 → 文字 → 保存/复制 → 三贴图。任一步失败或历史条数意外改变，应停止发布并回退旧程序，保留数据和故障证据。真实滚动及多显示器验收未通过前，不宣称全部桌面验收完成。

## 本轮文件清单

- `src/window/Screenshot/index.jsx`
- `src/window/Screenshot/Annotator.jsx`
- `src-tauri/src/features/capture.rs`
- `src-tauri/src/features/pins.rs`
- `src/i18n/locales/en_US.json`
- `src/i18n/locales/zh_CN.json`
- `.scripts/tests/run-capture-webview.cjs`
- `docs/CAPTURE-ACCEPTANCE-2026-09-19.md`
