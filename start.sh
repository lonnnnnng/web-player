#!/usr/bin/env bash
# ============================================================
# 本地视频播放器 启动脚本 (Linux / macOS，兼容 bash 与 POSIX sh)
#
# 用法:
#   bash start.sh                          # 后台启动（默认方式）
#   bash start.sh --dir /data/videos --port 9090   # 带参数后台启动
#   bash start.sh fg                       # 前台运行（Ctrl+C 停止，方便调试）
#   bash start.sh stop                     # 停止后台进程
#   bash start.sh restart                  # 重启
#   bash start.sh status                   # 查看运行状态
#
# 视频目录/端口/密码也可以写在 config.json 或环境变量里，
# 不传参数时服务端会自动读取。
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/player.pid"
LOG_FILE="$SCRIPT_DIR/player.log"

# 优先使用 python3
PYTHON="$(command -v python3 || command -v python)"
if [ -z "$PYTHON" ]; then
    echo "错误: 未找到 python3，请先安装 (sudo apt install python3)"
    exit 1
fi

is_running() {
    [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

do_start() {
    if is_running; then
        echo "播放器已在运行 (PID $(cat "$PID_FILE"))，如需重启请执行: bash start.sh restart"
        exit 0
    fi
    rm -f "$PID_FILE"
    nohup "$PYTHON" "$SCRIPT_DIR/server.py" "$@" >> "$LOG_FILE" 2>&1 &
    local pid=$!
    echo "$pid" > "$PID_FILE"
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "=============================================="
        echo "  播放器已在后台启动 (PID $pid)"
        echo "  日志文件 : $LOG_FILE"
        echo "  查看日志 : tail -f $LOG_FILE"
        echo "  停止服务 : bash start.sh stop"
        echo "=============================================="
    else
        echo "启动失败！最近日志:"
        tail -n 10 "$LOG_FILE"
        rm -f "$PID_FILE"
        exit 1
    fi
}

do_stop() {
    if is_running; then
        local pid
        pid=$(cat "$PID_FILE")
        echo "正在停止 (PID $pid)..."
        kill "$pid" 2>/dev/null
        for i in 1 2 3 4 5; do
            kill -0 "$pid" 2>/dev/null || break
            sleep 1
        done
        if kill -0 "$pid" 2>/dev/null; then
            kill -9 "$pid" 2>/dev/null
        fi
        echo "已停止"
    else
        echo "播放器未在运行"
    fi
    rm -f "$PID_FILE"
}

do_status() {
    if is_running; then
        echo "运行中 (PID $(cat "$PID_FILE"))"
    else
        echo "未运行"
    fi
}

case "$1" in
    stop)
        do_stop
        ;;
    restart)
        shift
        do_stop
        do_start "$@"
        ;;
    status)
        do_status
        ;;
    fg|foreground)
        shift
        echo "前台运行模式，Ctrl+C 停止..."
        exec "$PYTHON" "$SCRIPT_DIR/server.py" "$@"
        ;;
    *)
        do_start "$@"
        ;;
esac
