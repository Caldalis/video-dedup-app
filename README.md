# 视频去重

一个视频去重的桌面程序：对画面做镜像、色彩偏移、时间轴微调等细微改动，并写入随机信息，让输出的视频无论是画面还是文件本身都和原视频不一样。视频处理由 FFmpeg 完成。

使用 Electron + React + TypeScript 编写。

> 本项目是实验性项目，出于学习和研究目的开发，以 [MIT 许可证](LICENSE) 开源。请勿将其用于违法违规或侵犯他人权益的用途，使用前请阅读[免责声明](#免责声明)。

## 功能

| 功能     | 效果                                                | FFmpeg 实现             |
| ------ | ------------------------------------------------- | --------------------- |
| 水平镜像   | 画面左右翻转                                            | `hflip`               |
| RGB偏移  | 红色通道右移、蓝色通道下移 1 个像素，绿色不动，任意两个通道在水平、垂直方向上都只差 1 个像素 | `rgbashift`           |
| 时间跳跃   | 每帧的显示时间按正弦规律前后微调（最多 ±0.04 秒，周期 8 秒），帧数不变          | `settb` + `setpts`    |
| 修改MD5值 | 写入随机注释，不保留原视频的标题和日期；只勾选这一项时直接复制音视频流，不重新编码         | `-metadata`、`-c copy` |
| 蒙版倒置   | 叠加一层半透明的反色蒙版，不透明度可调（默认 0.03）                      | `lutyuv`              |
| 视频抽帧   | 每隔 N 帧抽掉 1 帧，也可以每次随机间隔 N~N+5 帧                    | `select`              |

“时间跳跃”和“修改MD5值”默认开启。

- 浅色、深色、跟随系统三种外观，会记住上次的选择
- 把视频拖到窗口任意位置即可选择，并显示时长、分辨率、帧率、编码和原始 MD5
- 处理时显示进度、速度和预计剩余时间，可以随时取消；完成后显示新文件的 MD5，并可在访达或资源管理器中找到它
- 声音能直接复制就不重新编码；输出为 MP4、M4V、MKV 时自动嵌入封面缩略图；WebM 使用 VP9 + Opus
- 结果先写入临时文件，全部完成后才改名为输出文件：失败或取消时不会留下半成品，也不会破坏已有的同名文件

## 快速开始

需要 Node.js 22.12 或更高版本（推荐 24）和 pnpm 11：

```bash
corepack enable        # 或者 npm install -g pnpm
pnpm install           # 安装依赖，同时下载 FFmpeg（约 45 MB）
pnpm dev               # 启动开发模式，修改界面代码后自动刷新；第一次运行时会下载 Electron（约 110 MB）
```

下载慢时可以改用国内镜像，在当前终端中设置以下环境变量后再执行上面的命令：

```bash
# macOS / Linux
export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
export FFMPEG_BINARIES_URL=https://cdn.npmmirror.com/binaries/ffmpeg-static

# Windows PowerShell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:FFMPEG_BINARIES_URL="https://cdn.npmmirror.com/binaries/ffmpeg-static"
```

> pnpm 11 默认不运行依赖包的安装脚本，本项目在 `pnpm-workspace.yaml` 的 `allowBuilds` 中允许了 ffmpeg-static 下载 FFmpeg 的脚本。如果安装后提示找不到 FFmpeg，执行 `pnpm rebuild ffmpeg-static` 重新下载。

## 常用命令

| 命令               | 作用                                  |
| ---------------- | ----------------------------------- |
| `pnpm dev`       | 以开发模式启动                             |
| `pnpm build`     | 构建到 `out/` 目录                       |
| `pnpm start`     | 以构建后的正式版本启动                         |
| `pnpm typecheck` | 类型检查                                |
| `pnpm test`      | 处理核心的测试：用真实的 FFmpeg 处理测试素材，逐项检查实际效果 |
| `pnpm test:e2e`  | 界面测试：构建程序，并用 Playwright 模拟用户操作      |
| `pnpm dist`      | 打包安装包到 `dist/` 目录                   |
| `pnpm dist:dir`  | 只生成可以直接运行的程序目录，不做安装包                |

## FFmpeg

程序按以下顺序查找 FFmpeg：

1. 环境变量 `VIDEO_DEDUP_FFMPEG` 指定的程序
2. 随程序提供的 FFmpeg：开发时是 ffmpeg-static 在 `pnpm install` 时下载的，打包后在安装目录的 `resources/ffmpeg` 中
3. 系统中安装的 FFmpeg：`PATH` 中的，以及 macOS 上 Homebrew、MacPorts 默认目录中的

界面右上角显示正在使用的 FFmpeg 版本，点旁边的 ⓘ 可以看到它的路径。本工具需要 FFmpeg 5.1 及以上版本。例如改用 Homebrew 安装的 FFmpeg：

```bash
VIDEO_DEDUP_FFMPEG=/opt/homebrew/bin/ffmpeg pnpm dev
```

ffmpeg-static 为各系统提供的 FFmpeg 都包含本工具用到的编码器（libx264、libvpx-vp9、libopus、libvorbis）：

| 系统                | FFmpeg 版本                | 许可证                             |
| ----------------- | ------------------------ | ------------------------------- |
| Windows x64       | 6.1.1（gyan.dev）          | GPLv3                           |
| macOS（Intel）      | 6.1.1                    | GPLv3                           |
| macOS（Apple 芯片）   | 6.0                      | 包含 nonfree 部分，不能再分发（见[打包](#打包)） |
| Linux x64 / arm64 | 7.0.2（johnvansickle.com） | GPLv3                           |

**时间戳**：重新编码时总是加上 `-fps_mode vfr -enc_time_base:v 1/90000`（AVI 只能以帧为单位记录时间，不加后者），保留每一帧原本的显示时间：

- FFmpeg 7 以前的版本默认把 MP4 等格式重排成固定帧率，会抹掉时间跳跃的偏移，被抽掉的帧也会被补回来。
- 编码器默认使用“1/帧率”的时间基。处理可变帧率的视频（例如手机拍的、做过时间跳跃的）时，两帧可能被舍入到同一时刻，后一帧会被丢掉。
- `-enc_time_base:v filter` 也能保留时间，但 FFmpeg 7 才支持这种写法，所以直接写成 1/90000，与时间跳跃滤镜使用的时间基相同。

## 测试

`pnpm test` 先用当前的 FFmpeg 生成测试素材（缓存在系统临时目录中），然后逐项检查以下内容：

- 抽帧的位置和间隔，蒙版倒置对画面的改变
- 输出的像素格式，时间跳跃后每一帧的时间戳，可变帧率的视频不丢帧
- 各种格式的封装、封面和音频，音画同步，写入的元数据
- 带旋转信息的竖拍视频、带字幕的视频、很短的视频，文件名中有空格、中文和特殊字符的情况
- 出错时的提示，取消后没有残留的文件和进程

换一个 FFmpeg 测试：

```bash
VIDEO_DEDUP_FFMPEG=/opt/homebrew/bin/ffmpeg pnpm test
```

`pnpm test:e2e` 会启动构建好的程序，由测试代替用户回答系统对话框，检查以下操作：

- 选择文件、拖入文件，选择了不能处理的文件
- 参数校验、处理、处理失败、覆盖确认
- 取消，以及处理中关闭窗口
- 快捷键、菜单、复制 MD5、在访达中显示
- 外观切换，设置文件损坏，重复启动
- 界面不能直接使用 Node.js，也不能跳转到其他页面

测试使用单独的用户数据目录，不会改动本机的设置，也不会真的打开访达或改动剪贴板。

## 打包

```bash
pnpm dist
```

- 每个系统的安装包需要在对应的系统上打包：ffmpeg-static 只下载当前系统的 FFmpeg，打包时把它复制到 `resources/ffmpeg`。
- macOS 版默认做 ad-hoc 签名，不需要开发者证书。别人下载后，macOS 会提示“无法验证开发者”，可以在“系统设置 → 隐私与安全性”中选择仍要打开；不签名的话会提示“已损坏”，根本打不开。
- 有 Apple 的 Developer ID 证书时，打包时用它签名并开启 hardened runtime，再按 [electron-builder 的说明](https://www.electron.build/code-signing) 做公证：`pnpm dist -c.mac.identity="证书名称" -c.mac.hardenedRuntime=true`。Windows 版没有配置签名。
- **FFmpeg 的许可证**：分发安装包就是在分发其中的 FFmpeg。ffmpeg-static 下载的是 GPL 版本，分发时需要附上许可证并提供源码的获取方式。Apple 芯片 Mac 上的版本编译时开启了 `--enable-nonfree`，`ffmpeg -L` 会显示它不能合法地再分发。要分发 macOS 版，先把 `node_modules/ffmpeg-static/ffmpeg` 换成可以再分发的 FFmpeg，再打包。

## 项目结构

```
src/
├── core/          处理核心：调用 FFmpeg，只依赖 Node.js，与界面无关
│   ├── processor.ts   VideoProcessor：重新编码或复制音视频流、嵌入封面、临时文件、取消
│   ├── filters.ts     各项功能对应的 FFmpeg 滤镜
│   ├── probe.ts       读取时长、分辨率、编码等信息
│   ├── ffmpeg.ts      查找 FFmpeg，读取版本和编码器
│   └── files.ts       MD5、默认输出路径
├── shared/        主进程和界面共用：参数的定义与校验、功能说明、通信接口
├── main/          Electron 主进程：窗口、菜单、对话框、处理任务、外观设置
├── preload/       向界面提供 window.api
└── renderer/      React 界面（顶栏、视频文件、去重功能、处理、日志）
tests/
├── core/          处理核心的单元测试和集成测试
├── e2e/           界面测试
├── helpers/       测试素材，以及只用 FFmpeg 就能完成的各种检查
└── setup/         生成测试素材
build/icon.png     程序图标
```

界面运行在沙箱中，不能直接使用 Node.js，只能调用 preload 提供的几个方法，主进程会检查收到的每个参数。打包后的页面带有内容安全策略，只加载程序自带的脚本和样式。

## 免责声明

本项目是一个实验性项目，用于学习和研究 Electron 桌面程序开发与 FFmpeg 视频处理技术，不是成熟的软件产品，功能和处理效果随时可能改变。使用前请仔细阅读以下内容。

**视频来源**：请只处理你拥有版权的视频（例如你本人拍摄、制作的），或者已经获得版权人授权的视频。

**请勿用于以下用途**，它们可能违反法律法规、侵犯他人权益或违反平台规则：

- 未经授权搬运、转载他人的视频，或者把他人的作品当作自己的原创发布
- 规避视频平台的版权保护、原创检测、重复内容识别等机制
- 批量制作、发布重复的内容，刷流量，或者骗取平台的收益分成、流量扶持和奖励
- 制作、传播违法违规、虚假、色情、暴力等内容
- 冒充他人、诈骗、诽谤，或者以其他方式侵犯他人的著作权、肖像权、名誉权、隐私权等合法权益
- 其他违反法律法规，或者违反视频平台用户协议、社区规范的行为

**不提供任何保证**：本项目按现状提供，不保证功能正确、完整、稳定，不保证处理结果能达到任何特定效果，也不保证会持续维护和更新。

**后果自负**：使用者需要自行遵守所在地的法律法规和相关平台的规则。因使用或无法使用本项目产生的一切后果，包括但不限于账号被限流或封禁、版权纠纷、经济损失、数据丢失、行政处罚和法律责任，都由使用者自行承担，本项目的作者和贡献者不承担任何责任。

**修改和再分发**：基于本项目修改、打包或再分发的版本，由修改者或分发者自行负责。

本声明可能随时修改，以最新版本为准。

## 许可证

本项目的代码以 [MIT 许可证](LICENSE) 开源。简单来说：任何人都可以免费使用、复制、修改、合并、发布、分发、再授权和销售本项目，只需要在副本中保留版权声明和许可声明；本项目不提供任何保证，作者不对使用它产生的任何后果负责。具体条款以 [LICENSE](LICENSE) 中的英文原文为准。

MIT 许可证只适用于本项目自己的代码。本项目用到的第三方软件按各自的许可证发布，其中打包进安装包的 FFmpeg 使用 GPL 许可证，Apple 芯片 Mac 上的版本还含有不能再分发的部分，分发安装包时需要遵守它的许可证（见[打包](#打包)）。
