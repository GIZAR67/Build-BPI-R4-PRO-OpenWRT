#!/bin/sh
# T-024: наполняет наборы vpn_users/grp_full/grp_restricted из /etc/config/vpnsplit
# и грузит ru_nets из /etc/vpnsplit/ru.cidr (гр.1 «всё через VPN, кроме РФ»)
. /lib/functions.sh
nft list set inet fw4 vpn_users >/dev/null 2>&1 || exit 0
for s in vpn_users grp_full grp_restricted; do
	nft flush set inet fw4 "$s" 2>/dev/null
done
add_host() {
	local enabled ip mode
	config_get enabled "$1" enabled '0'
	config_get ip "$1" ip
	config_get mode "$1" mode '2'
	[ "$enabled" = "1" ] && [ -n "$ip" ] || return 0
	case "$mode" in
		1)	nft add element inet fw4 grp_full "{ $ip }" 2>/dev/null ;;
		3)	nft add element inet fw4 vpn_users "{ $ip }" 2>/dev/null
			nft add element inet fw4 grp_restricted "{ $ip }" 2>/dev/null ;;
		*)	nft add element inet fw4 vpn_users "{ $ip }" 2>/dev/null ;;
	esac
}
config_load vpnsplit 2>/dev/null && config_foreach add_host host
# ru_nets: набор пересоздаётся пустым при fw4 reload — грузим, только если пуст
if [ -s /etc/vpnsplit/ru.cidr ] && ! nft list set inet fw4 ru_nets 2>/dev/null | grep -q elements; then
	{
		printf 'add element inet fw4 ru_nets { '
		grep -E '^[0-9]+\.[0-9.]+/[0-9]+$' /etc/vpnsplit/ru.cidr | tr '\n' ',' | sed 's/,$//'
		printf ' }\n'
	} > /tmp/ru_nets.load
	nft -f /tmp/ru_nets.load 2>/dev/null || logger -t vpnsplit "ошибка загрузки ru_nets"
	rm -f /tmp/ru_nets.load
fi
exit 0
