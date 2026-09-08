import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';

const [serial, minutesText = '15'] = process.argv.slice(2);
const minutes = Number(minutesText);
if (!serial || !Number.isFinite(minutes) || minutes < 1 || minutes > 120) {
  throw new Error('Usage: node scripts/verify-background.mjs DEVICE_SERIAL [MINUTES:1..120]');
}
const packageName = 'io.github.lonnnnnng.localaudio';
const adb = (...args) => execFileSync('adb', ['-s', serial, ...args], { encoding: 'utf8', timeout: 15000 });
const started = Date.now();
const output = resolve(import.meta.dirname, '../../output/android/background-verification.json');
const report = { serial, started: new Date(started).toISOString(), minutes, samples: [], checkpoints: [] };
let lastSampleTime = started / 1000;
let failure;

// long: 此脚本只读取日志，绝不发送播放或唤醒命令，避免测试本身掩盖后台停止问题。
try {
  while (true) {
    const logs = adb('logcat', '-d', '-v', 'epoch', '-s', 'LocalAudioPlayback:I', '*:S');
    for (const line of logs.split('\n')) {
      const match = line.match(/^\s*(\d+\.\d+).*LocalAudioPlayback:\s+playing=(true|false) state=(\d+) positionMs=(\d+) bufferedMs=(\d+)/);
      if (!match || Number(match[1]) <= lastSampleTime) continue;
      lastSampleTime = Number(match[1]);
      const sample = { timestamp: lastSampleTime, playing: match[2] === 'true', state: Number(match[3]), position: Number(match[4]), buffered: Number(match[5]) };
      report.samples.push(sample);
      if (!sample.playing || sample.state !== 3) throw new Error(`Playback interrupted: ${line}`);
    }
    const service = adb('shell', 'dumpsys', 'activity', 'services', packageName);
    const power = adb('shell', 'dumpsys', 'power');
    const checkpoint = {
      elapsedSeconds: Math.round((Date.now() - started) / 1000),
      foreground: service.includes('isForeground=true'),
      wakefulness: power.match(/mWakefulness=(\w+)/)?.[1],
      powered: power.match(/mIsPowered=(\w+)/)?.[1],
      latestPosition: report.samples.at(-1)?.position,
    };
    report.checkpoints.push(checkpoint);
    console.log(JSON.stringify(checkpoint));
    if (!checkpoint.foreground) throw new Error('Foreground playback service stopped');
    if (checkpoint.wakefulness === 'Awake') throw new Error('Screen woke during screen-off verification');
    if (Date.now() / 1000 - lastSampleTime > 75) throw new Error('No playback heartbeat for more than 75 seconds');
    if (Date.now() - started >= minutes * 60000) break;
    await setTimeout(30000);
  }
  if (report.samples.length < Math.floor(minutes)) throw new Error('Insufficient playback samples');
  const first = report.samples[0];
  const last = report.samples.at(-1);
  // long: 本用例播放同一段长音频，进度必须与真实经过时间一致，防止只更新播放状态却没有解码输出。
  if (Math.abs((last.position - first.position) - (last.timestamp - first.timestamp) * 1000) > 5000) {
    throw new Error('Playback position did not advance with elapsed time');
  }
} catch (error) {
  failure = error.message;
  process.exitCode = 1;
} finally {
  report.finished = new Date().toISOString();
  report.passed = !failure;
  if (failure) report.failure = failure;
  mkdirSync(resolve(import.meta.dirname, '../../output/android'), { recursive: true });
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ passed: report.passed, output, failure }));
}
