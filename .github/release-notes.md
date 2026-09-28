<!-- Release 草稿的说明模板：发布工作流会把 {{VERSION}} 换成版本号。发布前在草稿中补充这个版本的更新内容 -->

English | [简体中文](#简体中文)

## Download

| System | File |
| --- | --- |
| Windows 10 / 11, 64-bit | `video-dedup-{{VERSION}}-win-x64.exe` |
| macOS 15 or later, Apple silicon (M1 and later) | `video-dedup-{{VERSION}}-mac-arm64.dmg` |
| macOS 13 or later, Intel | `video-dedup-{{VERSION}}-mac-x64.dmg` |
| Linux, 64-bit | `video-dedup-{{VERSION}}-linux-x86_64.AppImage` |

`SHA256SUMS.txt` lists the SHA-256 checksum of every file.

## First launch

The installers are not signed with a paid developer certificate, so the system shows a warning the first time you open the app:

- **macOS**: open the `.dmg` and drag the app (named 视频去重工具) into Applications. When macOS says it can't verify the app, open **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**.
- **Windows**: if "Windows protected your PC" appears, click **More info**, then **Run anyway**.
- **Linux**: make the file executable with `chmod +x video-dedup-{{VERSION}}-linux-x86_64.AppImage`, then run it. If it doesn't start, install `libfuse2` (on Ubuntu 24.04 and later, `libfuse2t64`).

## FFmpeg

Each installer includes FFmpeg, which is licensed under the GPL v3 and is not covered by the app's MIT license. The license text and where to get the source code of each FFmpeg build are in the installer's `resources/ffmpeg` folder, and in [SOURCES.md](https://github.com/Caldalis/video-dedup-app/blob/v{{VERSION}}/build/ffmpeg/SOURCES.md).

This is an experimental project. Please read the [disclaimer](https://github.com/Caldalis/video-dedup-app#disclaimer) before use.

---

## 简体中文

### 下载

| 系统 | 文件 |
| --- | --- |
| Windows 10 / 11，64 位 | `video-dedup-{{VERSION}}-win-x64.exe` |
| macOS 15 及以上，Apple 芯片（M1 及更新的机型） | `video-dedup-{{VERSION}}-mac-arm64.dmg` |
| macOS 13 及以上，Intel 芯片 | `video-dedup-{{VERSION}}-mac-x64.dmg` |
| Linux，64 位 | `video-dedup-{{VERSION}}-linux-x86_64.AppImage` |

`SHA256SUMS.txt` 中是每个文件的 SHA-256 校验值。

### 第一次打开

安装包没有使用付费的开发者证书签名，第一次打开时系统会给出安全提示：

- **macOS**：打开 `.dmg`，把“视频去重工具”拖到“应用程序”文件夹。提示无法验证时，打开“系统设置 → 隐私与安全性”，在页面下方点击“仍要打开”。
- **Windows**：出现“Windows 已保护你的电脑”时，点击“更多信息”，再点击“仍要运行”。
- **Linux**：用 `chmod +x video-dedup-{{VERSION}}-linux-x86_64.AppImage` 加上执行权限后运行；打不开时安装 `libfuse2`（Ubuntu 24.04 及以上为 `libfuse2t64`）。

### FFmpeg

每个安装包都带有 FFmpeg。它按 GPL v3 发布，不属于本程序的 MIT 许可证。许可证全文和各个 FFmpeg 构建的源码获取方式在安装包的 `resources/ffmpeg` 目录中，也可以查看 [SOURCES.md](https://github.com/Caldalis/video-dedup-app/blob/v{{VERSION}}/build/ffmpeg/SOURCES.md)。

本项目是实验性项目，使用前请阅读[免责声明](https://github.com/Caldalis/video-dedup-app/blob/main/README.zh-CN.md#免责声明)。
