#!/usr/bin/env bash
# Первичная подготовка хоста Ubuntu (26.04 / 24.04) под облегчённый стек Open
# (2 vCPU / 3 ГБ RAM / 30 ГБ NVMe).
#
# Запускать от root:
#   sudo bash infra/setup-host.sh
#
# Что делает скрипт:
#   1. Создаёт и подключает 4 ГБ swap-файл (/swapfile), чтобы пики памяти не
#      вызывали OOM-killer на 3 ГБ ОЗУ.
#   2. Настраивает sysctl: vm.swappiness=10, vm.overcommit_memory=1 и буферы UDP
#      для медиапотоков WebRTC (LiveKit).
#   3. Устанавливает Docker Engine и Docker Compose plugin (если ещё не стоят)
#      и ограничивает размер логов контейнеров на уровне демона.
#   4. Открывает в UFW только нужные порты (SSH, HTTP/HTTPS, LiveKit RTC + TURN).

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Ошибка: запустите скрипт от root (sudo bash infra/setup-host.sh)" >&2
  exit 1
fi

echo "==> [1/4] Настройка 4 ГБ swap-файла (/swapfile)..."
if swapon --show | grep -q '/swapfile'; then
  echo "Swap-файл /swapfile уже активен."
else
  if [ ! -f /swapfile ]; then
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096 status=progress
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  echo "Swap 4 ГБ активирован."
fi

echo "==> [2/4] Настройка параметров ядра (/etc/sysctl.d/99-open-diet.conf)..."
cat >/etc/sysctl.d/99-open-diet.conf <<'EOF'
# Используем swap только при реальной нехватке ОЗУ
vm.swappiness = 10
vm.vfs_cache_pressure = 50
vm.overcommit_memory = 1

# Буферы сокетов под WebRTC / LiveKit и Caddy HTTP/3
net.core.rmem_max = 26214400
net.core.wmem_max = 26214400
net.core.rmem_default = 1048576
net.core.wmem_default = 1048576
net.ipv4.tcp_fastopen = 3
fs.file-max = 2097152
EOF
sysctl --system >/dev/null

echo "==> [3/4] Проверка Docker и лимитов логирования..."
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg ufw
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

mkdir -p /etc/docker
if [ ! -f /etc/docker/daemon.json ]; then
  cat >/etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF
  systemctl restart docker
fi

echo "==> [4/4] Настройка межсетевого экрана UFW..."
if ! command -v ufw >/dev/null 2>&1; then
  apt-get update -y && apt-get install -y ufw
fi

ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp
# Caddy HTTP / HTTPS / HTTP3
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
# LiveKit WebRTC и встроенный TURN
ufw allow 7881/tcp
ufw allow 3478/udp
ufw allow 5349/tcp
ufw allow 50000:50100/udp

ufw --force enable
ufw status verbose

echo "==> Хост готов к запуску: cd infra && docker compose up -d"
