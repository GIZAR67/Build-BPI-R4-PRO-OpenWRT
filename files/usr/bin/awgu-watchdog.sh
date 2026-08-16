#!/bin/sh
# Сторож рабочего туннеля awgu. Запускается из cron раз в минуту.
#
# Задача — не доложить о падении, а поднять канал после ЛЮБОГО падения:
#   - демон amneziawg-go умер или не стартовал после перезагрузки;
#   - часы уехали (RTC на плате нет): после обесточивания время откатывается,
#     хендшейк AWG молча не проходит, туннель «висит» вечно;
#   - сессия протухла — сменился IP эндпоинта, ТСПУ прибил поток, peer сбросил.
#
# Пока туннель лежит, kill-switch держит помеченный трафик в blackhole, то есть
# у LAN нет интернета — поэтому чинимся настойчиво, а не «раз в час».

IFACE=awgu
CONF=/etc/amneziawg/awgu.conf
SOCK=/var/run/amneziawg/${IFACE}.sock
INIT=/etc/init.d/amneziawg-go
THRESHOLD=${THRESHOLD:-240}   # хендшейк старше — считаем, что канал лёг
MARKER=/tmp/awgu-down         # чтобы в syslog не капало каждую минуту
FAILS=/tmp/awgu-fails         # сколько кругов подряд не встаёт
MIN_EPOCH=1767225600          # 2026-01-01: время меньше — часы точно откатились

[ -f "$CONF" ] || exit 0      # туннель не настроен — сторожить нечего

# NTP-серверы: сначала по имени, затем голые IP — на случай, когда DNS ходит
# через тот же упавший туннель и резолвить некому.
fix_clock() {
    for S in 0.openwrt.pool.ntp.org 192.36.143.130 162.159.200.1 216.239.35.0; do
        ntpd -q -n -p "$S" >/dev/null 2>&1 && {
            logger -t awgu-watchdog "часы переставлены по $S: $(date)"
            return 0
        }
    done
    logger -t awgu-watchdog "часы поправить не удалось: все NTP недоступны"
    return 1
}

# Демона нет — поднимаем и уходим: хендшейку нужно время.
if [ ! -S "$SOCK" ]; then
    logger -t awgu-watchdog "демон не найден, стартую сервис (kill-switch держит LAN без интернета)"
    "$INIT" start >/dev/null 2>&1
    exit 0
fi

/usr/bin/awgu-routes.sh

LAST=$(/usr/bin/awg-amn show "$IFACE" latest-handshakes 2>/dev/null | awk '{print $2}')
NOW=$(date +%s)
[ -n "$LAST" ] && AGE=$((NOW - LAST)) || AGE=99999

# Часы могли уехать вперёд-назад: тогда возраст хендшейка — выдумка, а не факт.
[ "$AGE" -lt 0 ] && AGE=99999

if [ "$AGE" -le "$THRESHOLD" ]; then
    rm -f "$FAILS"
    [ -f "$MARKER" ] && { rm -f "$MARKER"; logger -t awgu-watchdog "туннель поднялся (хендшейк ${AGE}с)"; }
    exit 0
fi

N=$(cat "$FAILS" 2>/dev/null || echo 0)
N=$((N + 1))
echo "$N" > "$FAILS"
[ -f "$MARKER" ] || { touch "$MARKER"; logger -t awgu-watchdog "туннель лёг (хендшейк ${AGE}с): чиню, у LAN нет интернета"; }

# Часы вне здравого диапазона — правим сразу: пока время в прошлом,
# любые перезапуски бесполезны, хендшейк не пройдёт.
[ "$NOW" -lt "$MIN_EPOCH" ] && fix_clock

# Каждый круг — дёшево переставить конфиг и маршруты.
/usr/bin/awg-amn setconf "$IFACE" "$CONF" >/dev/null 2>&1
/usr/bin/awgu-routes.sh

# Не встаёт третий круг подряд — полный перезапуск демона.
if [ $((N % 3)) -eq 0 ]; then
    logger -t awgu-watchdog "не встаёт ${N}-ю минуту — полный перезапуск amneziawg-go"
    "$INIT" stop >/dev/null 2>&1
    # stop() в init-скрипте глушит демона через pkill, которого в этом busybox нет:
    # добиваем по pid, иначе start() увидит живой сокет и молча ничего не сделает.
    for P in $(ps w 2>/dev/null | grep "[a]mneziawg-go ${IFACE}" | awk '{print $1}'); do
        kill "$P" 2>/dev/null
    done
    rm -f "$SOCK"
    sleep 2
    "$INIT" start >/dev/null 2>&1
fi

# Десятый круг — часы могли уехать на правдоподобное, но неверное значение,
# в диапазон MIN_EPOCH такое не ловится. Сверяемся с NTP принудительно.
[ $((N % 10)) -eq 0 ] && fix_clock

exit 0
