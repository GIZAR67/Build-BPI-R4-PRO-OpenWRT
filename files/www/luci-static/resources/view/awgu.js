'use strict';
'require view';
'require fs';
'require ui';
'require poll';

function callStatus() {
	return fs.exec('/usr/bin/awgu-ctl', ['status']).then(function(res) {
		try { return JSON.parse(res.stdout || '{}'); } catch(e) { return {}; }
	});
}

function loadConf() {
	return fs.exec('/usr/bin/awgu-ctl', ['getconf']).then(function(res) {
		return res.stdout || '';
	}).catch(function() { return ''; });
}

function b64ToBytes(s) {
	s = s.replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/=]/g, '');
	while (s.length % 4) s += '=';
	var bin = atob(s), out = new Uint8Array(bin.length);
	for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

function inflateZlib(bytes) {
	// qCompress (Qt): 4 байта big-endian размера, дальше zlib-поток
	if (typeof DecompressionStream == 'undefined')
		return Promise.reject(new Error('браузер не поддерживает распаковку сжатой ссылки — обнови браузер'));
	var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
	return new Response(stream).text();
}

function buildConfFromAmnezia(root) {
	var cont = null, containers = root.containers || [];
	for (var i = 0; i < containers.length; i++)
		if (containers[i].awg || containers[i].wireguard) { cont = containers[i]; break; }
	var proto = cont ? (cont.awg || cont.wireguard) : root;
	var lc = proto.last_config || proto;
	if (typeof lc == 'string') lc = JSON.parse(lc);
	if (lc.config && /PrivateKey\s*=/.test(lc.config)) return lc.config;
	if (!lc.client_priv_key || !lc.server_pub_key)
		throw new Error('в файле нет ключей клиента/сервера (client_priv_key / server_pub_key)');
	var host = lc.hostName || root.hostName, port = lc.port || proto.port;
	if (!host || !port) throw new Error('в файле нет адреса или порта сервера');
	var lines = [ '[Interface]', 'PrivateKey = ' + lc.client_priv_key ];
	var map = [ ['Jc','junkPacketCount'], ['Jmin','junkPacketMinSize'], ['Jmax','junkPacketMaxSize'],
		['S1','initPacketJunkSize'], ['S2','responsePacketJunkSize'],
		['S3','cookieReplyPacketJunkSize'], ['S4','transportPacketJunkSize'],
		['H1','initPacketMagicHeader'], ['H2','responsePacketMagicHeader'],
		['H3','underloadPacketMagicHeader'], ['H4','transportPacketMagicHeader'],
		['I1','I1'], ['I2','I2'], ['I3','I3'], ['I4','I4'], ['I5','I5'],
		['J1','J1'], ['J2','J2'], ['J3','J3'], ['Itime','Itime'] ];
	for (var j = 0; j < map.length; j++) {
		var v = lc[map[j][1]]; if (v == null) v = lc[map[j][0]];
		if (v != null && v !== '') lines.push(map[j][0] + ' = ' + v);
	}
	lines.push('[Peer]', 'PublicKey = ' + lc.server_pub_key);
	if (lc.psk_key) lines.push('PresharedKey = ' + lc.psk_key);
	lines.push('AllowedIPs = 0.0.0.0/0', 'Endpoint = ' + host + ':' + port, 'PersistentKeepalive = 25');
	return lines.join('\n') + '\n';
}

function parseVpnLink(raw) {
	var m = raw.match(/vpn:\/\/([A-Za-z0-9\-_+\/=]+)/);
	var code = m ? m[1] : raw.trim();
	var bytes;
	try { bytes = b64ToBytes(code); } catch (e) { return Promise.reject(new Error('это не base64-ссылка vpn://')); }
	var asText = '';
	try { asText = new TextDecoder().decode(bytes); } catch (e) {}
	var p = (asText.trim().charAt(0) == '{') ? Promise.resolve(asText) : inflateZlib(bytes.slice(4));
	return p.then(function(jsonText) {
		var root;
		try { root = JSON.parse(jsonText); } catch (e) { throw new Error('после распаковки не JSON — файл повреждён или формат не Amnezia'); }
		return buildConfFromAmnezia(root);
	});
}

function fmtBytes(b) {
	if (b > 1073741824) return (b/1073741824).toFixed(2) + ' GB';
	if (b > 1048576) return (b/1048576).toFixed(1) + ' MB';
	if (b > 1024) return (b/1024).toFixed(0) + ' KB';
	return b + ' B';
}

function doAction(action, confirmMsg) {
	if (confirmMsg && !confirm(confirmMsg)) return;
	ui.showModal(_('Выполняется...'), [ E('p', { 'class': 'spinning' }, _('Подождите')) ]);
	return fs.exec('/usr/bin/awgu-ctl', [action]).then(function(res) {
		ui.hideModal();
		ui.addNotification(null, E('pre', {}, (res.stdout || '') + (res.stderr || '')), 'info');
	}).catch(function(e) { ui.hideModal(); ui.addNotification(null, E('p', {}, e.message), 'error'); });
}

return view.extend({
	load: function() { return Promise.all([ callStatus(), loadConf() ]); },
	render: function(data) {
		var st = data[0], conf = data[1];
		var rows = E('div', { 'id': 'awgu-status' });

		function renderStatus(s) {
			var vpnUp = (s.daemon == 1 && s.handshake_age >= 0 && s.handshake_age < 240 && s.routes > 0);
			var stateTxt, stateColor;
			if (s.emergency == 1) { stateTxt = 'АВАРИЙНЫЙ РЕЖИМ: VPN отключён, весь трафик напрямую'; stateColor = '#c62828'; }
			else if (vpnUp) { stateTxt = 'VPN работает — заблокированные сайты идут через туннель'; stateColor = '#2e7d32'; }
			else { stateTxt = 'VPN НЕ работает — заблокированные сайты недоступны (остальной интернет напрямую)'; stateColor = '#c62828'; }
			rows.innerHTML = '';
			rows.appendChild(E('h4', { 'style': 'color:' + stateColor }, stateTxt));
			var t = E('table', { 'class': 'table' });
			function tr(k, v) { t.appendChild(E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left', 'width': '40%' }, k), E('td', { 'class': 'td left' }, v) ])); }
			tr('Демон туннеля', s.daemon == 1 ? 'запущен' : 'остановлен');
			tr('Последнее рукопожатие', s.handshake_age >= 0 ? s.handshake_age + ' сек назад' : 'не было');
			tr('Принято / отправлено', fmtBytes(s.rx || 0) + ' / ' + fmtBytes(s.tx || 0));
			tr('Маршрутизация split-tunnel (fwmark → awgu)', s.routes > 0 ? 'активна' : 'снята');
			tr('Watchdog (самолечение)', s.watchdog > 0 ? 'включён (раз в минуту)' : 'ВЫКЛЮЧЕН');
			rows.appendChild(t);
		}
		renderStatus(st);
		poll.add(function() { return callStatus().then(renderStatus); }, 5);

		var confArea = E('textarea', {
			'id': 'awgu-conf',
			'style': 'width:100%; font-family:monospace; font-size:12px',
			'rows': 22,
			'spellcheck': 'false'
		}, [ conf ]);

		function applyParsed(conf, srcName) {
			confArea.value = conf;
			ui.addNotification(null, E('p', {}, 'Реквизиты из ' + srcName + ' распознаны и подставлены в окно. Проверь и нажми «Сохранить и перезапустить VPN».'), 'info');
		}

		function importText(txt, srcName) {
			txt = (txt || '').trim();
			if (txt.indexOf('[Interface]') >= 0) { applyParsed(txt, srcName); return Promise.resolve(); }
			return parseVpnLink(txt).then(function(conf) { applyParsed(conf, srcName); });
		}

		var fileInput = E('input', { 'type': 'file', 'style': 'display:none', 'change': function(ev) {
			var f = ev.target.files[0];
			ev.target.value = '';
			if (!f) return;
			f.text().then(function(txt) { return importText(txt, 'файла «' + f.name + '»'); })
				.catch(function(e) { ui.addNotification(null, E('p', {}, 'Не удалось разобрать файл: ' + e.message), 'error'); });
		} });

		function saveConf() {
			var txt = confArea.value || '';
			if (/vpn:\/\//.test(txt) && txt.indexOf('[Interface]') < 0) {
				importText(txt, 'вставленной ссылки vpn://')
					.catch(function(e) { ui.addNotification(null, E('p', {}, 'Не удалось разобрать ссылку: ' + e.message), 'error'); });
				return;
			}
			if (!confirm('Применить новые реквизиты и перезапустить VPN?\n\nПеред заменой будет сделана резервная копия. Если за 15 секунд не будет связи с новым сервером — автоматический откат к прежним реквизитам.')) return;
			ui.showModal('Применяю реквизиты...', [ E('p', { 'class': 'spinning' }, 'Перезапуск туннеля и проверка связи с сервером (до 30 секунд)') ]);
			return fs.exec('/usr/bin/awgu-ctl', ['setconf', txt]).then(function(res) {
				ui.hideModal();
				ui.addNotification(null, E('pre', {}, (res.stdout || '') + (res.stderr || '')), (res.code === 0) ? 'info' : 'error');
				return loadConf().then(function(c) { confArea.value = c; });
			}).catch(function(e) {
				ui.hideModal();
				ui.addNotification(null, E('pre', {}, 'Не дождался ответа: ' + e.message + '\nЭто не значит, что всё пропало: применение и автооткат доделываются на роутере сами. Смотри статус вверху страницы (обновляется каждые 5 сек) и нажми «Перечитать из файла».'), 'error');
			});
		}

		function reloadConf() {
			return loadConf().then(function(c) {
				confArea.value = c;
				ui.addNotification(null, E('p', {}, 'Конфигурация перечитана из файла на роутере.'), 'info');
			});
		}

		return E('div', {}, [
			E('h2', {}, 'VPN (AmneziaWG 2.0, split-tunnel + kill-switch)'),
			rows,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { doAction('restart'); } }, 'Перезапустить VPN'),
				' ',
				E('button', { 'class': 'btn cbi-button-negative', 'click': function() { doAction('emergency_off', 'ВНИМАНИЕ: VPN будет отключён, весь трафик пойдёт НАПРЯМУЮ через провайдера (без защиты). Продолжить?'); } }, 'Аварийно: интернет напрямую'),
				' ',
				E('button', { 'class': 'btn cbi-button-positive', 'click': function() { doAction('emergency_on'); } }, 'Вернуть VPN-режим')
			]),
			E('p', { 'style': 'color:#666' }, 'Split-tunnel: через VPN идёт только трафик заблокированных сайтов для разрешённых устройств (наборы vpnsplit), остальной интернет — напрямую. Kill-switch: при падении VPN этот трафик глушится (blackhole), наружу в открытую не утекает. Watchdog раз в минуту сам чинит туннель и маршруты. Журнал: System → System Log (awgu-watchdog).'),
			E('h3', {}, 'Реквизиты сервера (awgu.conf)'),
			E('p', { 'style': 'color:#666' }, 'Полная конфигурация туннеля: в [Interface] — наш приватный ключ и параметры обфускации, в [Peer] — публичный ключ сервера, PresharedKey и Endpoint (адрес:порт сервера). Можно вставить целиком конфиг от провайдера (строки Address/DNS/MTU уберутся автоматически), вставить ссылку vpn://… из AmneziaVPN или загрузить файл кнопкой ниже. Перед применением создаётся резервная копия (хранятся последние 10 в /etc/amneziawg/backup); если связи с новым сервером нет — автооткат.'),
			confArea,
			fileInput,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'btn cbi-button-apply', 'click': saveConf }, 'Сохранить и перезапустить VPN'),
				' ',
				E('button', { 'class': 'btn cbi-button-action', 'click': function() { fileInput.click(); } }, 'Загрузить из файла (vpn:// или .conf)'),
				' ',
				E('button', { 'class': 'btn', 'click': reloadConf }, 'Перечитать из файла на роутере')
			])
		]);
	},
	handleSave: null, handleSaveApply: null, handleReset: null
});
