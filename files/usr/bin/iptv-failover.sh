#!/bin/sh
# T-004.16: сторож канала IPTV.
# Основной путь — wgmgmt (хаб в Болгарии, быстрее). Если он молчит, таблица 102
# переключается на awgu, иначе помеченный трафик упёрся бы в blackhole и телевидение встало.
# Возврат на основной путь — после двух подряд удачных проверок (гистерезис от дёрганья).
PEER=10.9.0.1
STATE=/tmp/iptv-failover.state
OKCNT=/tmp/iptv-failover.okcnt

cur=$(cat $STATE 2>/dev/null || echo wgmgmt)

if [ "$FORCE_DOWN" = "1" ]; then
	alive=0
elif ping -c 2 -W 2 -q $PEER >/dev/null 2>&1; then
	alive=1
else
	sleep 2
	ping -c 2 -W 2 -q $PEER >/dev/null 2>&1 && alive=1 || alive=0
fi

if [ "$alive" = "0" ]; then
	echo 0 > $OKCNT
	[ "$cur" = "awgu" ] && exit 0
	ip route replace default dev awgu table 102
	echo awgu > $STATE
	logger -t iptv-failover "хаб в Болгарии молчит — IPTV переведён на резервный туннель awgu"
	exit 0
fi

n=$(cat $OKCNT 2>/dev/null || echo 0)
n=$((n + 1))
echo $n > $OKCNT
[ "$cur" = "wgmgmt" ] && exit 0
[ "$n" -lt 2 ] && exit 0
ip route replace default dev wgmgmt table 102
echo wgmgmt > $STATE
logger -t iptv-failover "хаб в Болгарии снова отвечает — IPTV возвращён на основной туннель"
exit 0
