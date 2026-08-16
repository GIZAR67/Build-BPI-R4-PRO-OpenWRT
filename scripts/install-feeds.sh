#!/usr/bin/env bash
set -euo pipefail

# zapret (remittor) provides zapret + luci-app-zapret. Default branch is zap1.
# The feed must be in feeds.conf.default BEFORE feeds update, or the packages never appear.
grep -q '^src-git zapret ' feeds.conf.default || \
    echo 'src-git zapret https://github.com/remittor/zapret-openwrt.git;zap1' >> feeds.conf.default
cat feeds.conf.default

# podkop (itdoginfo) provides podkop + luci-app-podkop. Ни один из фидов сборки их
# не содержит, поэтому defconfig молча выбрасывал оба пакета (прогон 31952714106).
grep -q '^src-git podkop ' feeds.conf.default || \
    echo 'src-git podkop https://github.com/itdoginfo/podkop.git' >> feeds.conf.default

./scripts/feeds update -a

# mtk-openwrt arm-trusted-firmware mirror hash has drifted; accept the currently published archive hash.
sed -i 's/PKG_MIRROR_HASH:=1138649f64ac3982330925c38c795ca6860289adbd95755991f80afa30ebdea7/PKG_MIRROR_HASH:=93fa1a61e810ed7753801f007e3ee3fa425f93ba65e19dbb64aaa78d061b239b/' package/boot/arm-trusted-firmware-mediatek/Makefile

# Feeds are installed in order and the FIRST one to claim a name wins, so the
# official 'packages' feed goes before kenzo — otherwise a third-party copy of a
# common package (curl, dnsmasq, samba) would shadow the upstream one.
#
# 'packages' used to be left out: everything we needed came in as a dependency of
# something else. With the full composition (samba4, ksmbd, p910nd, omcproxy,
# openvpn, xl2tpd, usbutils…) that no longer holds — a package nobody depends on
# is simply never symlinked, and defconfig drops it without a word.
#
# 'small' (kenzok8) carries the proxy stack of the Octava build: xray-core,
# sing-box, shadowsocks-rust, dns2socks, ipt2socks, mosdns. Its mihomo package
# fails to build (Go dns library) and is deleted in the next workflow step.
for feed in base packages luci routing telephony mtk_openwrt_feed kenzo amneziawg zapret podkop small; do
    ./scripts/feeds install -p "$feed" -a
done
