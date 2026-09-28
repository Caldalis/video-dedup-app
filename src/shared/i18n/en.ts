// 英文界面文字。条目和参数由 zh-CN.ts 推导出的 Messages 类型约束
import type { FFmpegInfo } from '../ipc'
import { SAMPLING_RANDOM_RANGE, TIME_JUMP_AMPLITUDE, TIME_JUMP_PERIOD } from '../options'
import type { Messages } from './zh-CN'

const fileManagers = (platform: string | undefined) =>
  platform === 'darwin' ? 'Finder' : platform === 'win32' ? 'File Explorer' : 'File Manager'

const logSources: Record<FFmpegInfo['source'], string> = {
  bundled: 'bundled with the app',
  system: 'installed on the system',
  env: 'set by VIDEO_DEDUP_FFMPEG',
}

export const en: Messages = {
  appName: 'Video Dedup',
  appTagline: 'Powered by FFmpeg',
  standaloneNotice: 'Please start with pnpm dev: the interface needs to run inside Electron.',

  header: {
    theme: 'Appearance',
    themes: { light: 'Light', dark: 'Dark', system: 'System' },
    language: 'Language',
    ffmpegMissing: 'FFmpeg not found',
    ffmpegDetails: 'FFmpeg details',
    ffmpegVersion: (version, source) =>
      `Version ${version ?? 'unknown'} (${{ bundled: 'bundled', system: 'system', env: 'from environment variable' }[source]})`,
    ffmpegEnvHint: 'Use the VIDEO_DEDUP_FFMPEG environment variable to choose which FFmpeg to use.',
  },

  ffmpeg: {
    outdated: (version) => `FFmpeg ${version} is too old; this app requires version 5.1 or later`,
    missing: (platform, packaged) => {
      const after = "Once it's installed, just start processing; there's no need to restart the app."
      if (packaged) {
        return (
          "FFmpeg was not found, so videos can't be processed yet. The FFmpeg in the installer may have been deleted " +
          `or blocked by antivirus software. Reinstall this app, or install FFmpeg yourself. ${after}`
        )
      }
      const install =
        platform === 'darwin'
          ? 'or install it by running brew install ffmpeg in Terminal'
          : platform === 'win32'
            ? 'or install FFmpeg and add the folder containing ffmpeg.exe to PATH'
            : "or install it with your system's package manager (for example, sudo apt install ffmpeg)"
      return `FFmpeg was not found, so videos can't be processed yet. Run pnpm install again to download FFmpeg, ${install}. ${after}`
    },
  },

  file: {
    title: 'Video file',
    change: 'Change video',
    dropTitle: 'Drop a video file here, or click to choose one',
    dropHint: 'Supports MP4, MOV, MKV, AVI, WMV, FLV, WebM and more',
    loading: 'Reading video info…',
    remove: 'Remove file',
    noAudio: 'No audio',
    originalMd5: 'Original MD5',
    outputTo: 'Output to',
    changeOutput: 'Change…',
    md5Computing: 'Calculating…',
    md5Failed: 'Failed',
    copyMd5: 'Copy MD5',
  },

  inputErrors: {
    invalidPath: 'Invalid file path',
    notAFile: 'Please choose a video file, not a folder',
    unreadable: (detail) => `Can't read the file: ${detail}`,
    cannotRead: (reason) => `Can't read this file: ${reason}`,
    noVideo: 'This file has no video',
  },

  features: {
    title: 'Dedup features',
    selected: (count) => `${count} selected`,
    reset: 'Restore defaults',
    details: (name) => `About ${name}`,
    opacity: 'Opacity',
    opacityHint: 'Between 0 and 1; higher values make the picture grayer',
    opacityInvalid: 'Must be greater than 0 and at most 1',
    interval: 'Every',
    intervalLabel: 'Drop interval',
    frames: 'frames',
    randomInterval: 'Random interval',
    intervalInvalid: 'Must be a whole number of at least 2',
    samplingRandom: (from, to) => `Drops 1 frame at random intervals of ${from}–${to} frames`,
    samplingFixed: (interval) => `Drops 1 frame every ${interval} frames`,
    items: {
      mirror: {
        name: 'Mirror',
        summary: 'Flip the picture horizontally',
        detail: 'Flips the picture left to right, like a mirror. The whole picture is kept, with nothing cropped or covered.',
      },
      rgbShift: {
        name: 'RGB shift',
        summary: 'Offset the red, green and blue channels by 1 pixel',
        detail:
          'Moves the red channel 1 pixel right and the blue channel 1 pixel down while green stays in place, ' +
          'so the three color channels are at most 1 pixel apart, creating a subtle color difference.',
      },
      timeJump: {
        name: 'Time jump',
        summary: 'Make playback speed wobble slightly and periodically',
        detail:
          `Nudges the timeline back and forth along a sine wave (up to about ±${TIME_JUMP_AMPLITUDE} s, with a period of ` +
          `${TIME_JUMP_PERIOD} s), so playback periodically runs slightly faster and slower, within about ±3%, ` +
          'which is imperceptible in normal viewing. The number of frames stays the same, the total duration changes by ' +
          `at most ${TIME_JUMP_AMPLITUDE} s, and the audio is unaffected. AVI output can only be adjusted in whole frames.`,
      },
      md5Change: {
        name: 'Change MD5',
        summary: "Write random data so the file's MD5 changes",
        detail:
          'Writes a random comment into the file, so every output file has a different MD5; ' +
          "the original video's title and date are not carried over. When this is the only feature selected, " +
          'the audio and video streams are copied without re-encoding, which is lossless and fast; ' +
          "if the output format can't hold the original codecs (for example, WMV to MP4), the video is re-encoded automatically.",
      },
      maskInvert: {
        name: 'Invert mask',
        summary: 'Overlay a semi-transparent color-inverted layer',
        detail:
          'Overlays a semi-transparent color-inverted layer on the picture. The opacity ranges from 0 to 1 and defaults to 0.03; ' +
          'higher values make the picture grayer, and at 1 the colors are fully inverted.',
      },
      frameSampling: {
        name: 'Drop frames',
        summary: 'Remove one frame every few frames',
        detail:
          'Removes 1 frame out of every N (N is 5 by default); the previous frame fills the gap, and the audio is unaffected. ' +
          `With “Random interval” checked, the interval varies randomly between N and N+${SAMPLING_RANDOM_RANGE - 1} frames, ` +
          'so different frames are removed each time.',
      },
    },
  },

  problems: {
    noInput: 'No video file selected yet',
    loading: 'Reading video info…',
    noFeatures: 'No features are turned on',
    opacity: 'The Invert mask opacity must be a number greater than 0 and at most 1, for example 0.03',
    interval: 'The Drop frames interval must be a whole number of at least 2, for example 5',
  },

  process: {
    title: 'Process',
    stages: {
      probe: 'Reading video info',
      encode: 'Re-encoding',
      copy: 'Copying streams',
      cover: 'Embedding cover thumbnail',
      finalize: 'Saving',
    },
    cancelling: 'Cancelling…',
    preparing: 'Preparing',
    finishing: 'Finishing up',
    elapsed: (time) => `Elapsed ${time}`,
    remaining: (time) => `About ${time} left`,
    done: 'Processing complete',
    took: (time) => `Took ${time}`,
    newMd5: 'New MD5',
    showInFolder: (platform) => `Show in ${fileManagers(platform)}`,
    open: 'Open',
    failed: 'Processing failed',
    failedDetail: 'See the processing log below for details',
    cancelled: 'Cancelled',
    cancelledDetail: 'No output file was created, and any existing file with the same name was left untouched',
    waiting: 'Waiting for a video',
    waitingDetail: 'Choose or drop a video file to start processing',
    notReady: "Can't start yet",
    ready: 'Ready',
    copyOnly: "Change MD5 only: the streams are copied without re-encoding, so it's fast",
    reencode: (codec) => `The video is re-encoded as ${codec}; the audio is copied whenever possible`,
    samplingChip: (name, from, to) => (to === null ? `${name} every ${from}` : `${name} every ${from}–${to}`),
    cancel: 'Cancel',
    starting: 'Preparing…',
    start: 'Start processing',
    restart: 'Process again',
    clear: 'Clear',
    clearHint: 'Clear the file, options and log',
  },

  log: {
    title: 'Processing log',
    copyAll: 'Copy all logs',
    clear: 'Clear log',
    empty: 'No log entries yet',
  },

  app: {
    ffmpegFound: (version, path, source) => `FFmpeg ${version ?? '(unknown version)'}: ${path} (${logSources[source]})`,
    md5Done: (slot, value) => `${slot === 'input' ? 'Original file' : 'Output file'} MD5: ${value}`,
    md5Failed: (slot, message) => `Couldn't calculate the MD5 of the ${slot === 'input' ? 'original file' : 'output file'}: ${message}`,
    opened: (path) => `Opened video: ${path}`,
    outputChanged: (path) => `Output location changed to: ${path}`,
    cleared: 'Cleared; options restored to defaults',
    starting: 'Starting processing',
    cannotStart: (message) => `Can't start: ${message}`,
    finished: (time) => `Done in ${time}`,
    failed: (message) => `Processing failed: ${message}`,
    cancelled: 'Processing cancelled; no output file was created',
    cancelling: 'Cancelling…',
    copied: 'Copied to clipboard',
    copyFailed: (message) => `Copy failed: ${message}`,
    openFailed: (message) => `Can't open the file: ${message}`,
    busy: "A video is being processed; you can't change the file right now",
    dropHere: 'Release to choose this video',
  },

  ui: {
    decrease: (label) => `Decrease ${label.toLowerCase()}`,
    increase: (label) => `Increase ${label.toLowerCase()}`,
    copied: 'Copied',
  },

  units: {
    seconds: (value) => `${value} s`,
    minutes: (minutes, seconds) => `${minutes} min ${seconds} s`,
    hours: (hours, minutes) => `${hours} h ${minutes} min`,
  },

  dialogs: {
    openTitle: 'Open Video',
    videoFiles: 'Video Files',
    allFiles: 'All Files',
    saveTitle: 'Choose Output Location',
    extensionFiles: (ext) => `.${ext} Files`,
    cancelJob: {
      message: 'Cancel the current processing?',
      detail: 'Everything processed so far will be discarded, and no output file will be created.',
      confirm: 'Cancel Processing',
      keep: 'Keep Processing',
    },
    overwrite: { message: 'The output file already exists. Overwrite it?', confirm: 'Overwrite', cancel: 'Cancel' },
    quit: { message: 'A video is being processed, and quitting will cancel it. Quit anyway?', confirm: 'Quit', keep: 'Keep Processing' },
  },

  errors: {
    invalidArgument: 'Invalid argument',
    invalidPath: 'Invalid file path',
    busy: 'Another video is being processed. Please wait until it finishes.',
    noInput: 'No video file selected yet',
    inputMissing: (path) => `Input file not found:\n${path}`,
    noOutput: 'No output location set yet',
    sameFile: "The output file can't be the same as the input file. Please choose a different output path.",
    outputDirMissing: (dir) => `The output folder doesn't exist:\n${dir}`,
  },

  menu: {
    about: (name) => `About ${name}`,
    services: 'Services',
    hide: (name) => `Hide ${name}`,
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    quit: (name) => `Quit ${name}`,
    file: 'File',
    open: 'Open Video…',
    close: 'Close Window',
    edit: 'Edit',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',
    view: 'View',
    reload: 'Reload',
    devTools: 'Toggle Developer Tools',
    fullScreen: 'Toggle Full Screen',
    window: 'Window',
    minimize: 'Minimize',
    zoom: 'Zoom',
    front: 'Bring All to Front',
  },

  processor: {
    input: (path) => `Input: ${path}`,
    output: (path) => `Output: ${path}`,
    cannotReadInput: (reason) => `Can't read the input file: ${reason}`,
    noVideo: 'The input file has no video',
    duration: (seconds) => `Duration: ${seconds} s`,
    noDuration: "Can't read the video duration, so no progress percentage will be shown",
    cannotWriteOutput: (message) => `Can't write the output file (it may be open in another program): ${message}`,
    tempDeleteFailed: (file, message) => `Failed to delete the temporary file: ${file} (${message})`,
    saved: 'Output file saved',
    effectMirror: 'Effect: mirror',
    effectMask: (opacity) => `Effect: invert mask, opacity ${opacity}`,
    effectRgbShift: 'Effect: RGB shift',
    effectTimeJump: (amplitude, period) => `Effect: time jump, timeline offset of up to ±${amplitude} s with a period of ${period} s`,
    effectSamplingRandom: (from, to) => `Effect: drop frames, 1 frame at random intervals of ${from}–${to} frames`,
    effectSamplingFixed: (interval) => `Effect: drop frames, 1 frame every ${interval} frames`,
    copyOnly: 'Change MD5 only: copying the audio and video streams without re-encoding',
    copyFallback: (ext, message) => `Can't copy the streams directly into ${ext}; re-encoding instead: ${message}`,
    reencode: 'Re-encoding the video',
    aviTimeJump: 'Note: AVI can only record time in whole frames, so time jump offsets are rounded to whole frames',
    noVp9: "This FFmpeg doesn't support the VP9 encoder (libvpx-vp9) that WebM requires. Please change the output file to .mp4",
    noX264: "This FFmpeg doesn't include the H.264 encoder (libx264), so the video can't be re-encoded",
    audioCopy: 'Audio copied without re-encoding',
    audioReencode: (ext, codec) => `${ext} doesn't support the original audio codec; re-encoding the audio as ${codec}`,
    noWebmAudio:
      "This FFmpeg doesn't support the audio encoders (libopus / libvorbis) that WebM requires. Please change the output file to .mp4",
    noCoverSupport: (ext) => `${ext} doesn't support embedded cover thumbnails; skipped`,
    coverGenerating: 'Generating the cover thumbnail',
    noThumbnail: 'No cover image was captured',
    coverFailed: (message) => `Couldn't embed the cover thumbnail, so the output video has no cover: ${message}`,
    coverEmbedded: 'Cover thumbnail embedded',
    command: (command) => `Command: ${command}`,
    cannotRunFFmpeg: (message) => `Can't run FFmpeg: ${message}`,
    ffmpegExit: (code, signal) => (code === null ? `FFmpeg was terminated by signal ${signal}` : `FFmpeg exited with error code ${code}`),
  },
}
