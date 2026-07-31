#!/usr/bin/env bash
set -euo pipefail

MYSQL_HOME="/home/hunter/.local/opt/mysql"
MYSQL_LIBRARY_PATH="/home/hunter/.local/opt/mysql-deps/usr/lib/x86_64-linux-gnu"
MYSQL_CONFIG="/home/hunter/.config/movie/mysql.cnf"
MYSQL_ADMIN_CONFIG="/home/hunter/.config/movie/mysql-admin.cnf"
MYSQL_SOCKET="/home/hunter/.local/share/movie/run/mysql.sock"
MYSQL_LOG="/home/hunter/.local/share/movie/log/mysql.log"

REDIS_HOME="/home/hunter/.local/opt/redis-portable"
REDIS_LIBRARY_PATH="${REDIS_HOME}/usr/lib/x86_64-linux-gnu"
REDIS_CONFIG="/home/hunter/.config/movie/redis.conf"
REDIS_PID="/home/hunter/.local/share/movie/run/redis.pid"

mysql_admin() {
  LD_LIBRARY_PATH="${MYSQL_LIBRARY_PATH}" \
    "${MYSQL_HOME}/bin/mysqladmin" \
    --defaults-extra-file="${MYSQL_ADMIN_CONFIG}" \
    "$@"
}

mysql_running() {
  [[ -S "${MYSQL_SOCKET}" ]] && mysql_admin ping --silent >/dev/null 2>&1
}

redis_cli() {
  LD_LIBRARY_PATH="${REDIS_LIBRARY_PATH}" \
    "${REDIS_HOME}/usr/bin/redis-cli" \
    -h 127.0.0.1 \
    -p 6379 \
    "$@"
}

redis_running() {
  [[ "$(redis_cli ping 2>/dev/null || true)" == "PONG" ]]
}

start_mysql() {
  if mysql_running; then
    echo "MySQL is already running on 127.0.0.1:3306."
    return
  fi
  if ss -H -ltn 'sport = :3306' | rg -q .; then
    echo "Port 3306 is occupied by another process; refusing to start the project MySQL." >&2
    return 1
  fi

  LD_LIBRARY_PATH="${MYSQL_LIBRARY_PATH}" \
    "${MYSQL_HOME}/bin/mysqld" \
    --defaults-file="${MYSQL_CONFIG}" \
    --daemonize

  for _ in $(seq 1 30); do
    if mysql_running; then
      echo "MySQL started on 127.0.0.1:3306."
      return
    fi
    sleep 1
  done
  tail -30 "${MYSQL_LOG}" >&2
  echo "MySQL did not become ready within 30 seconds." >&2
  return 1
}

start_redis() {
  if redis_running; then
    echo "Redis is already running on 127.0.0.1:6379."
    return
  fi
  if ss -H -ltn 'sport = :6379' | rg -q .; then
    echo "Port 6379 is occupied by another process; refusing to start the project Redis." >&2
    return 1
  fi

  LD_LIBRARY_PATH="${REDIS_LIBRARY_PATH}" \
    "${REDIS_HOME}/usr/bin/redis-server" \
    "${REDIS_CONFIG}"

  for _ in $(seq 1 30); do
    if redis_running; then
      echo "Redis started on 127.0.0.1:6379."
      return
    fi
    sleep 1
  done
  echo "Redis did not become ready within 30 seconds." >&2
  return 1
}

stop_mysql() {
  if ! mysql_running; then
    echo "MySQL is not running."
    return
  fi
  mysql_admin shutdown
  echo "MySQL stopped."
}

stop_redis() {
  if [[ ! -f "${REDIS_PID}" ]]; then
    echo "Project Redis PID file is absent; refusing to stop an unowned Redis process."
    return
  fi
  local redis_pid
  redis_pid="$(<"${REDIS_PID}")"
  if [[ ! "${redis_pid}" =~ ^[0-9]+$ ]] || \
      [[ ! -e "/proc/${redis_pid}/exe" ]] || \
      [[ "$(readlink -f "/proc/${redis_pid}/exe")" != "$(readlink -f "${REDIS_HOME}/usr/bin/redis-server")" ]]; then
    echo "Redis PID does not belong to the project binary; refusing to stop it." >&2
    return 1
  fi
  if ! redis_running; then
    echo "Redis is not running."
    return
  fi
  redis_cli shutdown
  echo "Redis stopped."
}

show_status() {
  if mysql_running; then
    echo "MySQL: running (127.0.0.1:3306)"
  else
    echo "MySQL: stopped"
  fi
  if redis_running; then
    echo "Redis: running (127.0.0.1:6379)"
  else
    echo "Redis: stopped"
  fi
}

case "${1:-status}" in
  start)
    start_mysql
    start_redis
    ;;
  stop)
    stop_redis
    stop_mysql
    ;;
  restart)
    stop_redis
    stop_mysql
    start_mysql
    start_redis
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status}" >&2
    exit 2
    ;;
esac
