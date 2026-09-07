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
    echo "错误: 未找到 python3，请先安装 Python 3"
    exit 1
fi

load_identity() {
    [ -f "$PID_FILE" ] || return 1
    {
        IFS= read -r player_pid && IFS= read -r instance_token && IFS= read -r started_at
    } < "$PID_FILE" || return 1
    case "$player_pid" in ''|*[!0-9]*) return 1 ;; esac
    [ "$player_pid" -gt 1 ] 2>/dev/null || return 1
    case "$instance_token" in ''|*[!0-9a-f]*) return 1 ;; esac
    [ "${#instance_token}" -eq 32 ] && [ -n "$started_at" ]
}

matches_process() {
    kill -0 "$player_pid" 2>/dev/null || return 1
    actual_start=$(LC_ALL=C ps -p "$player_pid" -o lstart= 2>/dev/null) || return 1
    [ "$actual_start" = "$started_at" ] || return 1
    process_command=$(ps -ww -p "$player_pid" -o command= 2>/dev/null) || return 1
    # long: 路径、随机启动标识和出生时间都必须一致，PID 被其他进程复用时绝不能误杀。
    case "$process_command" in
        *" $SCRIPT_DIR/server.py --instance-token $instance_token"|*" $SCRIPT_DIR/server.py --instance-token $instance_token "*) return 0 ;;
        *) return 1 ;;
    esac
}

is_running() {
    load_identity && matches_process
}

# 从命令行参数 / config.json 推断端口（与服务端优先级一致）
get_port() {
    port=""
    prev=""
    for a in "$@"; do
        case "$prev" in
            --port|-p) port="$a" ;;
        esac
        case "$a" in
            --port=*) port="${a#--port=}" ;;
            -p?*) port="${a#-p}" ;;
        esac
        prev="$a"
    done
    if [ -z "$port" ] && [ -f "$SCRIPT_DIR/config.json" ]; then
        port=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$SCRIPT_DIR/config.json" | head -n 1)
    fi
    echo "${port:-8080}"
}

# 获取本机局域网 IP（复用服务端同款逻辑：沿默认网关探测，单一实现保证一致）
get_ip() {
    ip=$("$PYTHON" "$SCRIPT_DIR/server.py" --print-ip 2>/dev/null)
    if [ -z "$ip" ]; then
        ip="127.0.0.1"
    fi
    echo "$ip"
}

print_urls() {
    p=$(get_port "$@")
    ip=$(get_ip)
    echo "  访问地址 :"
    echo "    本机   : http://127.0.0.1:$p/"
    echo "    局域网 : http://$ip:$p/"
}

do_start() {
    if is_running; then
        echo "播放器已在运行 (PID $player_pid)，如需重启请执行: bash start.sh restart"
        exit 0
    fi
    if [ -f "$PID_FILE" ]; then
        # long: 旧版仅有 PID 的记录无法证明归属，保留现场，不能覆盖后再失去旧服务的线索。
        if ! load_identity || kill -0 "$player_pid" 2>/dev/null; then
            echo "无法确认 player.pid 对应进程的身份；未启动或停止任何进程。请先核实旧服务。"
            return 1
        fi
    fi
    instance_token=$("$PYTHON" -c 'import uuid; print(uuid.uuid4().hex)') || return 1
    nohup "$PYTHON" "$SCRIPT_DIR/server.py" --instance-token "$instance_token" "$@" >> "$LOG_FILE" 2>&1 &
    player_pid=$!
    sleep 1
    started_at=$(LC_ALL=C ps -p "$player_pid" -o lstart= 2>/dev/null)
    if matches_process; then
        printf '%s\n%s\n%s\n' "$player_pid" "$instance_token" "$started_at" > "$PID_FILE"
        echo "=============================================="
        echo "  播放器已在后台启动 (PID $player_pid)"
        print_urls "$@"
        echo "  日志文件 : $LOG_FILE"
        echo "  查看日志 : tail -f $LOG_FILE"
        echo "  停止服务 : bash start.sh stop"
        echo "=============================================="
    else
        echo "启动失败！最近日志:"
        tail -n 10 "$LOG_FILE"
        exit 1
    fi
}

do_stop() {
    if is_running; then
        echo "正在停止 (PID $player_pid)..."
        # long: 发信号前再次核对；不使用强制 KILL，避免等待期间 PID 变化或误判归属。
        matches_process && kill "$player_pid" 2>/dev/null || return 1
        for i in 1 2 3 4 5; do
            matches_process || break
            sleep 1
        done
        if matches_process; then
            echo "服务尚未退出，已保留 PID 记录；请检查日志后重试。"
            return 1
        fi
        echo "已停止"
        rm -f "$PID_FILE"
    else
        if [ -f "$PID_FILE" ]; then
            echo "PID 记录过期或身份不匹配，未发送停止信号，已保留 player.pid。"
            return 1
        fi
        echo "播放器未在运行"
    fi
}

do_status() {
    if is_running; then
        echo "运行中 (PID $player_pid)"
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
        do_stop || exit 1
        do_start "$@"
        ;;
    status)
        do_status
        ;;
    fg|foreground)
        shift
        echo "前台运行模式，Ctrl+C 停止..."
        print_urls "$@"
        exec "$PYTHON" "$SCRIPT_DIR/server.py" "$@"
        ;;
    *)
        do_start "$@"
        ;;
esac
