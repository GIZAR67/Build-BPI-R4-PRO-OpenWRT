#!/bin/sh
# T-024: обновление списков — заблокированные домены (itdog.info) + подсети РФ (гр.1).
# Маршрут до raw.githubusercontent.com идёт через туннель (см. awgu-routes.sh).

# --- 1. Заблокированные домены ---
URL="https://raw.githubusercontent.com/itdoginfo/allow-domains/main/Russia/inside-dnsmasq-nfset.lst"
OUT=/etc/vpnsplit/domains.lst
TMP=/tmp/vpnsplit-domains.$$
if wget -q -T 30 -O "$TMP" "$URL"; then
	N=$(grep -c "^nftset=" "$TMP")
	if [ "$N" -lt 500 ]; then
		logger -t vpnsplit "список доменов подозрительно мал ($N строк) — оставляю старый"
	else
		# нормализуем имя набора на случай смены формата источника
		sed -nE 's|^nftset=/([^/]+)/.*$|nftset=/\1/4#inet#fw4#vpn_domains|p' "$TMP" > "$TMP.norm"
		if ! cmp -s "$TMP.norm" "$OUT"; then
			mv "$TMP.norm" "$OUT"
			/etc/init.d/dnsmasq restart
			# состав общего списка влияет на комбинированные директивы deny.conf
			/etc/init.d/vpnsplit reload
			logger -t vpnsplit "список доменов обновлён: $N"
		fi
		rm -f "$TMP.norm"
	fi
else
	logger -t vpnsplit "не удалось скачать список доменов"
fi
rm -f "$TMP"

# --- 2. Подсети РФ для гр.1 «всё через VPN, кроме РФ» ---
RUURL="https://raw.githubusercontent.com/ipverse/rir-ip/master/country/ru/ipv4-aggregated.txt"
RUOUT=/etc/vpnsplit/ru.cidr
TMPR=/tmp/vpnsplit-ru.$$
if wget -q -T 60 -O "$TMPR" "$RUURL"; then
	grep -E '^[0-9]+\.[0-9.]+/[0-9]+$' "$TMPR" > "$TMPR.ok"
	NR=$(wc -l < "$TMPR.ok")
	if [ "$NR" -lt 1000 ]; then
		logger -t vpnsplit "список РФ подозрительно мал ($NR) — оставляю старый"
	elif ! cmp -s "$TMPR.ok" "$RUOUT"; then
		mv "$TMPR.ok" "$RUOUT"
		nft flush set inet fw4 ru_nets 2>/dev/null
		/usr/bin/vpnsplit-users.sh
		logger -t vpnsplit "подсети РФ обновлены: $NR"
	fi
	rm -f "$TMPR.ok"
else
	logger -t vpnsplit "не удалось скачать список РФ"
fi
rm -f "$TMPR"
exit 0
