# M1racle Note

像普通笔记一样写，文件仍然是你的 Markdown。

Windows 使用 Electron，Android 使用本地 WebView，两端共用 CodeMirror 6 编辑基础。Markdown 文件是唯一内容源；预览不重写整篇原文，未编辑保存应保留 BOM 和混合换行。项目仍处于编辑器基础建设阶段。

## 开发

使用 Node.js 22.12 或更高版本，在仓库根目录执行：

```sh
npm ci
npm test
npm run windows:build
npm run windows:start
```

Windows 打包：`npm run windows:package`。如已保留本仓库品牌图标，可执行 `node desktop/scripts/windows-package.mjs --use-existing-icons`。安装器使用 NSIS 3.11，默认编译器位置为 `tools/windows-installer/nsis-3.11/makensis.exe`，也可通过 `NOTE_NSIS_PATH` 指向自行准备的编译器，然后运行 `npm run windows:installer`。编译器不作为本项目源码或运行组件分发。

Android 编辑资源：`npm run build`。安装 Android SDK 并配置本机 `mobile/local.properties` 后，在 `mobile/` 下执行 `gradlew.bat :app:assembleDebug`，其他系统使用 `./gradlew :app:assembleDebug`。Android SDK 37、Build Tools 36.0.0 及 JDK 17 或兼容配置须自行准备。

源码布局：`desktop/` 为 Windows，`mobile/` 为 Android，`editor/` 为共用编辑基础，`editor-corpus/` 为合成测试语料。`npm run verify:fast` 使用现有验证入口；界面、中文输入法与设备体验需要额外的实机验收。

## 当前状态

Windows 当前用户安装、同版本覆盖安装、真实主窗口及合成文档无编辑保存已经实机验证。尚无签名正式版；未签名卸载程序在启用应用控制的 Windows 环境被拦截，完整安装/卸载发布验收仍未通过。Android 设备、物理输入法和持续性能不因公开源码而自动通过。

## 许可与 Code signing policy

原创源码采用 [MIT License](LICENSE)。第三方软件和字体保留各自许可证，见 [第三方声明](THIRD_PARTY_NOTICES.md)。[Code signing policy](CODE_SIGNING.md) 说明计划申请 SignPath 的状态，当前尚未获批；[隐私说明](PRIVACY.md) 列出本地文件及网络行为。
