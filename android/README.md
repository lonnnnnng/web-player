# 本地听 Android 0.2.0

现有网页播放器的原生 Android 音频客户端。Kotlin、Compose Material 3、Media3 ExoPlayer / MediaSessionService，Android 7.0 及以上可安装。

## 功能范围

- 默认连接 `http://192.168.1.2/`，使用 80 端口；也可在“设置”中配置 HTTP/HTTPS 服务地址，保留反向代理子路径。当前部署的 8080 端口不是默认后端端口。
- 分页读取全部音频，支持搜索、播放 / 暂停、上一首 / 下一首、拖动进度、前后 10 秒、按列表顺序连播。
- 播放详情页支持 0.5x 至 3x 倍速、从头播放和完整进度控制。
- 播放历史按服务地址隔离，记录最近 100 首；重新打开应用只恢复上次队列和位置，不会自动出声。
- 可选“灵动岛”播放悬浮窗：需在设置中授权“显示在其他应用上层”，后台解锁时显示，支持展开、暂停、切歌、返回详情和关闭。
- 播放器由前台媒体服务持有，退出页面、返回桌面和锁屏不释放播放器。
- 系统媒体通知和锁屏控制；音频焦点管理，拔出耳机时暂停。
- 播放期间由 ExoPlayer 管理 CPU / Wi-Fi 锁，正常暂停时释放，不使用亮屏锁或静音音轨保活。
- 缓冲目标 60 至 180 秒；临时网络故障按 2 至 30 秒退避重试。恢复网络时重试，主动暂停后不强制恢复。
- 本地约每 5 秒保存当前队列、曲目和进度，重新启动只恢复位置，不自动出声。
- 浅色 / 深色主题、横屏分栏，以及设置页中的系统电池优化入口。

不包含视频、服务器密码、离线下载、后端播放记录同步和单曲循环。后端和网页无需修改。

## 后端接口

| 用途 | 请求 |
| --- | --- |
| 音频列表 | `GET /api/library?kind=audio&sort=name&limit=100&offset=0` |
| 音频流 / 拖动 | `GET /api/file?path=<URL 编码的资源路径>`，支持 HTTP Range |

默认地址在 `AudioEndpoint.BASE_URL` 中定义，运行时地址保存到应用私有设置；服务会拒绝不合法路径、用户名密码、查询参数和非 HTTP(S) 协议。
`network_security_config.xml` 允许用户配置内网 HTTP；公网部署推荐使用 HTTPS。播放服务仍只接受本应用或受信任媒体控制器。

## 构建与测试

在本目录运行，使用项目自带 Gradle Wrapper，需 Android SDK 36、可运行 Gradle 的 JDK 17+，编译工具链为 JDK 17：

```sh
./gradlew :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

APK：`app/build/outputs/apk/debug/app-debug.apk`。这是开发签名测试包，不是正式发布签名。
包名：`io.github.lonnnnnng.localaudio`。

```sh
android run --device=DEVICE_SERIAL --apks=app/build/outputs/apk/debug/app-debug.apk
ANDROID_SERIAL=DEVICE_SERIAL ./gradlew :app:connectedDebugAndroidTest
```

单元测试覆盖列表分页、URL 编码、错误处理、网络重试策略、服务地址校验与隔离、ViewModel 状态、历史/倍速持久化、灵动岛生命周期、详情页和小屏布局。
设备测试使用 UI Automator 从系统界面操作真实 App，不替换播放器或后端。
设备必须能连接配置的服务，默认后端应包含本轮使用的 `01.m4a`、`02.m4a`，且搜索 `02` 只匹配一首。
该测试会选曲和暂停，不要与持续播放验收同时运行。

### 持续播放验收

手动选一首剩余时长超过 15 分钟的音频，返回桌面并熄屏，然后运行：

```sh
node scripts/verify-background.mjs DEVICE_SERIAL 15
```

该脚本只读设备日志、前台服务与电源状态，不发送播放、唤醒、网络或电池设置命令。
它核对持续播放心跳和进度与真实时间的差值，结果写入仓库根目录的 `output/android/background-verification.json`。
本用例不应手动切曲或跨越曲尾。手机与电脑需保持时钟同步；完整曲尾连播单独验证。

## 0.2.0 验收边界

- 本轮已执行本地 JVM 单测、Compose/Robolectric 界面渲染、AndroidTest APK 编译、Debug APK 构建和 Lint。
- 本轮未重新操作已连接手机；因此 0.2.0 的详情、历史、服务切换和灵动岛未在 Redmi K80 或其他真机上宣称通过。
- 灵动岛依赖厂商对 `SYSTEM_ALERT_WINDOW` 的授权与后台弹窗策略；它是可选展示层，权限被收回时自动关闭，不影响媒体服务播放。

## 后台播放边界

原生前台服务消除了浏览器冻结网页导致的停播，但不能绕过系统强制停止、厂商强制清理、持续断网或音频文件错误。
无可用网络时只能播放已缓冲的部分；重试不等于离线播放。长时间网络故障后系统仍可能停止服务。
来电、其他应用抢占音频焦点、拔出耳机和用户主动暂停都应尊重系统或用户意图，不能靠定时调用 `play()` 抵消。

Redmi K80 上应按实际系统界面允许本应用后台运行，并检查是否被单独设为受限省电。
设置页的电池入口只打开系统设置，不会自动授予豁免，也不保证厂商的额外策略已关闭。
当前接入的 Redmi Note 8 Pro 测试机不等于 K80；详细实测范围见 `VALIDATION.md`。

## 实现依据

- [Media3 后台播放与前台服务](https://developer.android.com/media/media3/session/background-playback)
- [通过 MediaController 连接媒体应用](https://developer.android.com/media/media3/session/connect-to-media-app)
- [ExoPlayer API](https://developer.android.com/reference/androidx/media3/exoplayer/ExoPlayer)

官方文档已于 2026-09-07 至 2026-09-08 核对；依赖版本固定，升级时需重新验证后台行为。
