# Android 首版验收记录

日期：2026-09-08（北京时间）。版本：0.1.0，开发签名测试包。

## 已完成

- `:app:assembleDebug`、`:app:assembleDebugAndroidTest` 构建通过。
- `:app:testDebugUnitTest`：11 项通过，0 失败。
- `:app:lintDebug`：0 错误，35 警告，主要为依赖更新、版本目录风格及模板资源提示。导出媒体服务由 `onGetSession` 校验控制器身份。
- APK 签名校验通过，包名 `io.github.lonnnnnng.localaudio`，versionCode 1，versionName 0.1.0，minSdk 24，targetSdk 36。
- 固定后端 `http://192.168.1.2/` 实际返回 32 首音频，中文目录和 M4A 资源可正常读取。
- Redmi Note 8 Pro / Android 16，设备序列号 `wsvwypiz7xwslvl7`：启动、选曲、暂停、切歌、快进和拖动进度已操作验证。
- 返回桌面后服务 `isForeground=true`，媒体会话为 `PLAYING`，队列 32 首。
- 将第一集拖近末尾后，后台自动接上第二集；锁屏显示曲名、目录、播放 / 暂停、上一首和下一首控件。
- 播放期间系统存在 `ExoPlayer:WakeLockManager`，正常暂停时释放。

## 持续播放观察

使用后端真实的 `早春晴朗 全一季完结新增番外2/02.m4a`，未下载成替代测试文件。
手机通过 USB 连接，临时通过 `dumpsys battery unplug` 模拟未充电；未设置电池优化豁免，也未强制进入深度 Doze。

自动只读观察从 00:11:05 开始；连续熄屏检查到第 456 秒（7 分 36 秒）均正常，前台服务持续运行。
该段相邻播放日志全部为 `playing=true state=3`。首末连续样本间真实经过约 420.514 秒，音频位置增加 420.515 秒，差约 1 毫秒。

第 487 秒检查发现屏幕被唤醒，并出现进度跳转。用户随后确认正在操作手机并要求停止手机测试。
因此原计划的 15 分钟用例未完成，保留原始 `passed=false` 和 `Screen woke during screen-off verification` 结果，不将被干预的用例算作通过。
本轮观察到的是人为交互中断验收条件，不是播放日志出现停播。

模拟电池状态已执行 `dumpsys battery reset` 恢复；收到停止要求后不再向手机发送命令。

## 尚未完成

- Redmi K80 / HyperOS 真机测试，以及完整 15 分钟、数小时、整夜连续播放。
- 长时间断网后的恢复、来电 / 音频焦点争用、拔出耳机和厂商强制清理的实机回归。
- 划掉最近任务、横屏、大字体和键盘遮挡的完整自动化回归。
- 初版 Compose / Hilt 界面测试在测试类加载阶段失败；已替换成 UI Automator 真实应用测试并编译通过，但按用户要求未继续在手机上执行。
- 持续播放使用的播放器源码与交付包一致；之后仅替换测试依赖并移除测试宿主。最终交付 APK 未再次覆盖安装到手机。

## 本地证据

以下文件位于仓库根目录的 `output/android/`，均不提交 Git：

- `phone-playing.png`：真实音频列表与播放界面。
- `phone-lockscreen.png`：第二集自动接播后的锁屏媒体卡片。
- `background-verification.json`：完整只读观察记录，含被用户操作中断的结果。
- `LocalAudio-0.1.0-debug.apk`：交付测试包。
- `SHA256SUMS`：APK 校验值。

APK SHA-256：`578856c1beff1d7ce1b1693b4617c18ba463bc2e73de36e0d10f1c84c17ad063`。

本轮未修改后端和网页逻辑，未提交或推送代码。
