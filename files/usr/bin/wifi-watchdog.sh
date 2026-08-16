#!/bin/sh
# Сторож Wi-Fi для BPI-R4-Pro-8X (mt7996e/BE14).
# Лечит две болячки, см. WIKI T-004.11:
#   1) после загрузки радио не поднимается само — hostapd падает на MLD-интерфейсе ap-mld-1;
#   2) зависает MCU радиомодуля — в dmesg сыплется "Message ... timeout", клиенты не цепляются.
# Оба случая лечит "wifi down && wifi up". Перезагрузку роутера НЕ делает — только пишет в лог.
TAG=wifi-watchdog
LOCK=/tmp/wifi-watchdog.lock
STATE=/tmp/wifi-wd-mcu
FAILS=/tmp/wifi-wd-fails
LASTF=/tmp/wifi-wd-last
NETDIR=/sys/class/ieee80211/phy0/device/net
MIN_GAP=600        # не дёргать радио чаще раза в 10 минут
MAX_FAILS=3        # после стольких безуспешных попыток подряд — только лог
NEW_TIMEOUTS=3     # столько новых MCU-таймаутов за проход = зависание
STALE_LOCK=600     # блокировку старше 10 минут считаем зависшей

log() { logger -t "$TAG" "$1"; }

# --- Защита от параллельного запуска. Зависший экземпляр (radio не отвечает) снимаем по времени.
NOW=$(date +%s)
if mkdir "$LOCK" 2>/dev/null; then
    echo "$NOW" > "$LOCK/ts"
else
    LT=$(cat "$LOCK/ts" 2>/dev/null)
    [ -n "$LT" ] || LT=0
    if [ $((NOW - LT)) -gt "$STALE_LOCK" ]; then
        log "previous run stuck for $((NOW - LT))s (radio not responding) - clearing lock"
        rm -rf "$LOCK"
        mkdir "$LOCK" 2>/dev/null || exit 0
        echo "$NOW" > "$LOCK/ts"
    else
        exit 0
    fi
fi
trap 'rm -rf "$LOCK"' EXIT INT TERM

# --- Есть ли радиоинтерфейсы. Читаем sysfs, а не iw: при зависшем MCU iw уходит в D-состояние.
count_ifaces() { ls "$NETDIR" 2>/dev/null | wc -l; }
IFACES=$(count_ifaces)

# --- Новые таймауты MCU. dmesg кольцевой: если счётчик упал — база сбилась, начинаем заново.
MCU=$(dmesg 2>/dev/null | grep -c "Message .* timeout")
PREV=$(cat "$STATE" 2>/dev/null)
[ -n "$PREV" ] || PREV=0
[ "$MCU" -lt "$PREV" ] && PREV=0
DIFF=$((MCU - PREV))
echo "$MCU" > "$STATE"

REASON=""
[ "$DIFF" -ge "$NEW_TIMEOUTS" ] && REASON="MCU hang ($DIFF new timeouts)"
[ "$IFACES" -eq 0 ] && REASON="no radio interfaces"

# --- Всё в порядке: сбрасываем счётчик неудач и выходим тихо.
if [ -z "$REASON" ]; then
    echo 0 > "$FAILS"
    exit 0
fi

# --- Не чаще раза в MIN_GAP, иначе при глухом зависании будем долбить радио каждые две минуты.
LASTTRY=$(cat "$LASTF" 2>/dev/null)
[ -n "$LASTTRY" ] || LASTTRY=0
[ $((NOW - LASTTRY)) -lt "$MIN_GAP" ] && exit 0
echo "$NOW" > "$LASTF"

F=$(cat "$FAILS" 2>/dev/null)
[ -n "$F" ] || F=0
if [ "$F" -ge "$MAX_FAILS" ]; then
    log "radio still down after $F attempts ($REASON) - router reboot required"
    exit 0
fi

log "restarting wifi: $REASON"
wifi down >/dev/null 2>&1
sleep 3
wifi up >/dev/null 2>&1
sleep 15

NEWC=$(count_ifaces)
if [ "$NEWC" -gt 0 ]; then
    log "wifi is up, interfaces: $NEWC"
    echo 0 > "$FAILS"
    dmesg 2>/dev/null | grep -c "Message .* timeout" > "$STATE"
else
    F=$((F + 1))
    echo "$F" > "$FAILS"
    log "wifi did not come up (attempt $F of $MAX_FAILS)"
fi
