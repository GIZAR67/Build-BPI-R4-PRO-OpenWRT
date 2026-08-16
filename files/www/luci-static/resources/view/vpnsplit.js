'use strict';
'require view';
'require form';

return view.extend({
	render: function() {
		var m, s, o;

		m = new form.Map('vpnsplit', _('Доступ к заблокированным сайтам'),
			_('Режимы: «Всё через VPN, кроме РФ» — весь зарубежный трафик устройства идёт через туннель; ' +
			  '«Заблокированные через VPN» — обычные сайты напрямую, заблокированные через туннель; ' +
			  '«…+ свой запрет» — то же, плюс устройству закрыты сайты из списка ниже. ' +
			  'У устройств не из списка заблокированные сайты не открываются, обычные работают напрямую. ' +
			  'Чтобы IP устройства не менялся, закрепите его: Сеть → DHCP и DNS → Постоянные аренды.'));

		s = m.section(form.GridSection, 'host', _('Устройства'));
		s.addremove = true;
		s.anonymous = true;
		s.nodescriptions = true;
		s.addbtntitle = _('Добавить устройство');

		o = s.option(form.Flag, 'enabled', _('Включено'));
		o.default = '1';
		o.editable = true;
		o.rmempty = false;

		o = s.option(form.Value, 'name', _('Имя'));
		o.placeholder = 'например: ноутбук директора';

		o = s.option(form.Value, 'ip', _('IP-адрес'));
		o.datatype = 'ip4addr("nomask")';
		o.rmempty = false;
		o.placeholder = '192.168.1.100';

		o = s.option(form.ListValue, 'mode', _('Режим'));
		o.value('1', _('Всё через VPN, кроме РФ'));
		o.value('2', _('Заблокированные через VPN'));
		o.value('3', _('Заблокированные через VPN + свой запрет'));
		o.default = '2';
		o.editable = true;

		s = m.section(form.NamedSection, 'global', 'global',
			_('Свой список запрещённых сайтов'),
			_('Действует только на устройства в режиме «…+ свой запрет»: эти сайты им не открываются ' +
			  'ни напрямую, ни через VPN (включая поддомены). Указывайте домен без «http://», например: youtube.com'));

		o = s.option(form.DynamicList, 'deny_domain', _('Домены'));
		o.datatype = 'hostname';
		o.placeholder = 'youtube.com';

		return m.render();
	}
});
