#!/bin/sh
# T-004.14: наполнение набора bg_domains адресами доменов «болгарского» канала.
# Нужно потому, что телефоны ходят с приватным DNS (DoH) и роутер их запросов не видит:
# после fw4 reload набор оставался бы пустым до чужого резолва, и канал молча отваливался.
# Домены берём из custom.lst — те, что направлены в bg_domains.
DOMS=$(sed -nE 's|^nftset=/([^/]+)/.*#bg_domains$|\1|p' /etc/vpnsplit/custom.lst)
[ -n "$DOMS" ] || exit 0
for d in $DOMS; do
	for h in "$d" "www.$d" "app.$d" "api.$d" "sockets.$d"; do
		nslookup "$h" 127.0.0.1 2>/dev/null | sed -n 's/^Address: *//p' | grep -E '^[0-9]+\.[0-9.]+$' | while read -r ip; do
			nft add element inet fw4 bg_domains "{ $ip }" 2>/dev/null
		done
	done
done
exit 0
