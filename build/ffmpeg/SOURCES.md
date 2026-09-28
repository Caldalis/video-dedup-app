# FFmpeg in Video Dedup

Video Dedup runs FFmpeg as a separate program. FFmpeg is not covered by the app's MIT license: the FFmpeg builds included in the installers are free software licensed under the GNU General Public License, version 3 or later. The full license text is in `COPYING.GPLv3` next to this file.

| Installer | FFmpeg | Built by | Source code |
| --- | --- | --- | --- |
| Windows x64 | 6.1.1 (essentials build) | [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) | FFmpeg [commit e38092ef93](https://github.com/FFmpeg/FFmpeg/commit/e38092ef93); the libraries and build configuration are listed on gyan.dev |
| Linux x64 | 7.0.2 (static build) | [John Van Sickle](https://johnvansickle.com/ffmpeg/) | [ffmpeg-7.0.2.tar.xz](https://ffmpeg.org/releases/ffmpeg-7.0.2.tar.xz); the libraries and build configuration are listed on johnvansickle.com |
| macOS, Intel | 6.1.1 | [evermeet.cx](https://evermeet.cx/ffmpeg/) | [ffmpeg-6.1.1.tar.xz](https://ffmpeg.org/releases/ffmpeg-6.1.1.tar.xz); the libraries and build configuration are listed on evermeet.cx |
| macOS, Apple silicon | 8.1.2 | [Shaka Project](https://github.com/shaka-project/static-ffmpeg-binaries/releases/tag/n8.1.2-1) | [ffmpeg-8.1.2.tar.xz](https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz); the build scripts and the version of every library are in [shaka-project/static-ffmpeg-binaries at n8.1.2-1](https://github.com/shaka-project/static-ffmpeg-binaries/tree/n8.1.2-1) |

The Windows, Linux and Intel macOS builds are distributed by [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1) (release b6.1.1). The version and build configuration of the included FFmpeg can also be checked by running it with `-version`.

---

# 程序中的 FFmpeg

视频去重工具把 FFmpeg 作为单独的程序调用。FFmpeg 不属于本程序的 MIT 许可证：安装包中的 FFmpeg 是自由软件，按 GNU 通用公共许可证第 3 版或更高版本发布，许可证全文见同一目录下的 `COPYING.GPLv3`。

各个安装包中 FFmpeg 的版本、构建者和源码的获取方式见上表：Windows、Linux 和 Intel 芯片 Mac 版来自 ffmpeg-static 的 b6.1.1 版本，Apple 芯片 Mac 版来自 Shaka Project 的 n8.1.2-1 版本。用 `-version` 参数运行其中的 FFmpeg，也可以看到它的版本和编译参数。
