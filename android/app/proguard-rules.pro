# long: JSON 字段使用显式 key，不依赖反射字段名；只保留 Android 清单入口与 Hilt 生成的注入边界。
# Media3、OkHttp、Compose 和 Hilt 的库规则由各自依赖的 consumer-rules 自动合并。
-keep class com.example.localaudio.AudioApplication { *; }
-keep class com.example.localaudio.MainActivity { *; }
-keep class com.example.localaudio.playback.PlaybackService { *; }
