'use strict';
'require view';
'require fs';
'require ui';

// T-004.13: настройки VPN-клиентов (телефоны и ноутбуки) — QR-кодом и текстом

// список — JSON
function cli(args) {
	return fs.exec('/usr/bin/vpnclients', args).then(function(res) {
		try { return JSON.parse(res.stdout || '{}'); }
		catch (e) { return { error: 'непонятный ответ роутера: ' + (res.stdout || res.stderr || '') }; }
	}).catch(function(e) { return { error: e.message }; });
}

// конфиг и QR — сырой вывод (длиннее, чем принимает JSON-обвязка роутера)
function cliRaw(args) {
	return fs.exec('/usr/bin/vpnclients', args).then(function(res) {
		if (res.code !== 0 || !res.stdout)
			return { error: (res.stderr || 'роутер не отдал настройки').trim() };
		return { data: res.stdout };
	}).catch(function(e) { return { error: e.message }; });
}

function notifyErr(msg) { ui.addNotification(null, E('p', {}, msg), 'error'); }

function fmtAge(a) {
	if (a == null || a < 0) return 'ещё не подключалось';
	if (a < 180) return 'на связи';
	if (a < 7200) return Math.floor(a / 60) + ' мин назад';
	if (a < 172800) return Math.floor(a / 3600) + ' ч назад';
	return Math.floor(a / 86400) + ' дн назад';
}

var MODES = {
	'1': 'Всё через VPN, кроме РФ',
	'2': 'Заблокированные через VPN',
	'3': 'Заблокированные через VPN + свой запрет'
};

function busy(msg) { ui.showModal(msg, [ E('p', { 'class': 'spinning' }, 'Подождите') ]); }

function showQr(name, r) {
	if (r.error) { ui.hideModal(); notifyErr(r.error); return; }
	var box = E('div', { 'style': 'background:#fff; padding:12px; display:inline-block; border:1px solid #ccc' });
	var svg = r.data || '';
	var i = svg.indexOf('<svg');
	if (i >= 0) {
		box.innerHTML = svg.substring(i);
		var s = box.querySelector('svg');
		if (s) { s.style.width = '280px'; s.style.height = '280px'; }
	}
	ui.showModal('Профиль «' + name + '» — QR-код', [
		E('p', {}, 'На телефоне: приложение AmneziaWG (App Store / Google Play) → «+» → сканировать QR-код. ' +
		           'Обычный WireGuard не подойдёт — провайдер его режет.'),
		E('div', { 'style': 'text-align:center' }, box),
		E('div', { 'class': 'right' }, E('button', { 'class': 'btn cbi-button-action', 'click': ui.hideModal }, 'Закрыть'))
	]);
}

function showText(name, r) {
	if (r.error) { ui.hideModal(); notifyErr(r.error); return; }
	var conf = r.data || '';
	ui.showModal('Профиль «' + name + '» — текст настроек', [
		E('p', {}, 'На компьютере: AmneziaWG для Windows/Mac → импорт файла .conf. ' +
		           'Либо скопируйте текст целиком и вставьте в приложение как новый профиль.'),
		E('textarea', { 'readonly': '', 'rows': 16, 'style': 'width:100%; font-family:monospace; font-size:12px', 'spellcheck': 'false' }, conf),
		E('div', { 'class': 'right' }, [
			E('button', { 'class': 'btn', 'click': function() {
				var a = document.createElement('a');
				a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(conf);
				a.download = name + '.conf';
				document.body.appendChild(a); a.click(); a.remove();
			} }, 'Скачать .conf'),
			' ',
			E('button', { 'class': 'btn cbi-button-action', 'click': ui.hideModal }, 'Закрыть')
		])
	]);
}

return view.extend({
	load: function() { return cli([ 'list' ]); },

	render: function(data) {
		if (data.error) notifyErr(data.error);
		var clients = data.clients || [];

		var t = E('table', { 'class': 'table' }, [
			E('tr', { 'class': 'tr table-titles' }, [
				E('th', { 'class': 'th left' }, 'Устройство'),
				E('th', { 'class': 'th left' }, 'Адрес в туннеле'),
				E('th', { 'class': 'th left' }, 'Режим'),
				E('th', { 'class': 'th left' }, 'Последнее подключение'),
				E('th', { 'class': 'th right', 'width': '220' }, 'Настройки')
			])
		]);

		clients.forEach(function(c) {
			function btn(label, cls, action, show) {
				return E('button', { 'class': 'btn ' + cls, 'click': function() {
					busy('Готовлю настройки...');
					cliRaw([ action, c.name ]).then(function(r) { show(c.name, r); });
				} }, label);
			}
			t.appendChild(E('tr', { 'class': 'tr' }, [
				E('td', { 'class': 'td left' }, c.label ? (c.label + ' (' + c.name + ')') : c.name),
				E('td', { 'class': 'td left' }, c.address || '—'),
				E('td', { 'class': 'td left' }, MODES[c.mode] || 'не задан — доступа через туннель нет'),
				E('td', { 'class': 'td left' }, fmtAge(c.handshake_age)),
				E('td', { 'class': 'td right' }, [
					btn('QR-код', 'cbi-button-action', 'qr', showQr), ' ',
					btn('Текст', 'cbi-button-neutral', 'conf', showText)
				])
			]));
		});

		if (!clients.length)
			t.appendChild(E('tr', { 'class': 'tr' }, E('td', { 'class': 'td left', 'colspan': '5' },
				'Профилей пока нет. Они лежат на роутере в каталоге /root/clients.')));

		return E('div', { 'class': 'cbi-map' }, [
			E('h2', {}, 'Профили VPN'),
			E('div', { 'class': 'cbi-map-descr' },
				'Настройки для подключения телефонов и ноутбуков к VPN завода. ' +
				'«QR-код» — для телефона, «Текст» — для компьютера или чтобы переслать. ' +
				'Один профиль — одно устройство: два устройства с одним профилем перебивают друг друга. ' +
				'Режим каждого устройства меняется в разделе «Доступ к заблокированным».'),
			E('div', { 'class': 'cbi-section' }, t),
			E('p', { 'style': 'color:#c62828' },
				'Настройки содержат ключ доступа в сеть завода — не публикуйте их и не пересылайте посторонним.')
		]);
	},

	handleSave: null,
	handleSaveApply: null,
	handleReset: null
});
