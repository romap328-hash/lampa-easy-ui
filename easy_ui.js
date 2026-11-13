/*
 * Easy UI — плагин интерфейса для Lampa (проверен на 3.4.7).
 * Механики не трогает: только внешний вид и порядок действий.
 * Источники видео остаются в установленных онлайн-модах (Online Mod, моды на Lampac и др.).
 *
 *  1. Одна кнопка «Смотреть»: открывает мод, выбранный в прошлый раз.
 *     Остальные — по кнопке «Источники». Shots убран отовсюду.
 *  2. Шапка на странице мода: «Сезон», «Озвучка», «Источник» — видимые кнопки
 *     с текущим значением вместо меню «Сортировать» и «Фильтр».
 *  3. Автоподбор балансера: пустой или зависший — сам переключает на следующий,
 *     начиная с тех, что уже находили этот фильм или находят чаще.
 *  4. Цепочка модов: если мод не нашёл фильм ни на одном балансере,
 *     сам открывается следующий мод.
 *  5. Озвучка в плеере: смена озвучки во время просмотра, без выхода к списку.
 *  6. Пульт: короткий свайп — один шаг, фокус не проскакивает и не уходит в другой ряд.
 *
 * Каждый пункт выключается в «Настройки → Удобный интерфейс».
 * Синтаксис ES5 — чтобы работало на старых устройствах.
 */
(function () {
    'use strict';

    if (window.easy_ui_plugin) return;
    window.easy_ui_plugin = true;

    var VERSION = '0.5.0';
    window.easy_ui_version = VERSION;

    var KEY = {
        play: 'easy_ui_direct_play',
        shots: 'easy_ui_hide_shots',
        head: 'easy_ui_source_menu',
        auto: 'easy_ui_auto_source',
        chain: 'easy_ui_chain',
        voice: 'easy_ui_player_voice',
        priority: 'easy_ui_hide_priority',
        smooth: 'easy_ui_smooth',
        anchor: 'easy_ui_anchor'
    };

    // Всё включено, кроме перечисленного здесь
    var OFF_BY_DEFAULT = [KEY.priority];

    // «Прилипание» фокуса, мс
    var BURST_GAP = 110;   // события чаще этого — один жест (свайп по сенсору или удержание кнопки)
    var HOLD_DELAY = 360;  // сколько длится жест, прежде чем фокус пойдёт дальше сам
    var HOLD_REPEAT = 150; // шаг при долгом свайпе или удержании

    // Автоподбор и цепочка, мс
    var AUTO_CHECK = 800;      // как часто смотрим, что показал мод
    var AUTO_SETTLE = 1500;    // пауза после переключения, пока мод очищает экран
    var AUTO_WAIT = 15000;     // сколько ждём ответа балансера, прежде чем считать его зависшим
    var MANAGED_WAIT = 45000;  // сколько ждём мод, который сам перебирает балансеры
    var FORGET = 600000;       // через сколько забываем попытки и цепочку
    var HISTORY_LIMIT = 200;   // сколько фильмов помнить

    function enabled(name) {
        var def = OFF_BY_DEFAULT.indexOf(name) < 0;
        var value = Lampa.Storage.get(name, def ? 'true' : 'false');
        return !(value === false || value === 'false');
    }

    function closeMenuIfOpen() {
        try {
            if (Lampa.Controller.enabled().name === 'select') Lampa.Select.close();
        } catch (e) {}
    }

    // Выполнить выбор в моде, когда меню выбора не открыто:
    // некоторые моды в обработчике сами закрывают меню, которого нет
    function withoutMenuClose(fn) {
        var close = Lampa.Select.close;
        var menuOpen = false;

        try { menuOpen = Lampa.Controller.enabled().name === 'select'; } catch (e) {}

        if (!menuOpen) Lampa.Select.close = function () {};

        try { fn(); } finally { Lampa.Select.close = close; }
    }

    function short(text, size) {
        text = $.trim(String(text || ''));
        return text.length > size ? text.slice(0, size - 1) + '…' : text;
    }

    /* ---------- Стили ---------- */

    var CSS = [
        /* Плавность: прокрутка тормозит мягко и не дёргается при удержании кнопки пульта */
        'body.easy-ui--smooth .scroll__body{',
        '-webkit-transition:-webkit-transform .42s cubic-bezier(.22,.8,.26,1);',
        'transition:transform .42s cubic-bezier(.22,.8,.26,1)}',
        'body.easy-ui--smooth .scroll__body.notransition,',
        'body.easy-ui--smooth .scroll__body.transition-reset{-webkit-transition:none;transition:none}',

        /* Скрытое */
        '.easy-ui-hidden{display:none!important}',
        'body.easy-ui--noshots .shots-view-button{display:none!important}',
        'body.easy-ui--nopriority .full-start-new__buttons .button--priority{display:none!important}',

        /* Шапка на странице мода: родные кнопки прячем, свои показываем */
        '.easy-ui-head .filter--sort,.easy-ui-head .filter--filter{display:none!important}',
        '.easy-ui-chip.hide{display:none!important}'
    ].join('');

    function applyBodyClasses() {
        $('body')
            .toggleClass('easy-ui--smooth', enabled(KEY.smooth))
            .toggleClass('easy-ui--noshots', enabled(KEY.shots))
            .toggleClass('easy-ui--nopriority', enabled(KEY.priority));

        markShots();
    }

    /* ---------- Shots: меню и ленты на главной ---------- */

    function setHidden(elem, hide) {
        if (hide) {
            if (elem.hasClass('easy-ui-hidden')) return;
            if (elem.hasClass('selector')) elem.attr('data-easy-selector', '1').removeClass('selector');
            elem.addClass('easy-ui-hidden');
        } else if (elem.hasClass('easy-ui-hidden')) {
            elem.removeClass('easy-ui-hidden');
            if (elem.attr('data-easy-selector')) elem.addClass('selector').removeAttr('data-easy-selector');
        }
    }

    function markShots() {
        var hide = enabled(KEY.shots);

        $('.menu__item').each(function () {
            var item = $(this);
            if ($.trim(item.find('.menu__text').text()) === 'Shots') setHidden(item, hide);
        });

        $('.shots-line-title').each(function () {
            var line = $(this).closest('.items-line');
            if (line.length) setHidden(line, hide);
        });
    }

    function watchShots() {
        if (typeof MutationObserver === 'undefined') {
            setInterval(markShots, 3000);
            return;
        }

        var timer;
        new MutationObserver(function () {
            clearTimeout(timer);
            timer = setTimeout(markShots, 300);
        }).observe(document.body, { childList: true, subtree: true });
    }

    /* ---------- Карточка: одна кнопка «Смотреть» и цепочка модов ---------- */

    // Lampa сама собирает все источники (онлайн-моды, торренты, трейлеры)
    // в меню кнопки «Смотреть». Её обработчик не трогаем — Lampa перевешивает его
    // при каждом переключении, — а вмешиваемся в само меню.

    var LAST_SOURCE = 'easy_ui_last_source';
    var forceMenu = false;
    var chain = null; // { activity, render, keys, titles, tried, time }

    function isCardButton(item) {
        return !!(item && item.btn && item.btn.hasClass && item.btn.hasClass('full-start__button'));
    }

    // По чему узнаём источник в следующий раз: его классы и подпись
    function buttonKey(btn) {
        var skip = ['focus', 'hover', 'selector', 'hide', 'full-start__button'];
        var classes = (btn.attr('class') || '').split(/\s+/).filter(function (name) {
            return name && skip.indexOf(name) < 0;
        }).sort().join('.');

        return classes + '|' + $.trim(btn.text());
    }

    function isTrailer(btn) {
        return btn.hasClass('view--trailer');
    }

    function isTorrent(btn) {
        return btn.hasClass('view--torrent');
    }

    function startChain(items, picked) {
        chain = null;

        if (!picked || isTorrent(picked.btn) || isTrailer(picked.btn)) return;

        var active = Lampa.Activity.active();
        if (!active || !active.activity) return;

        var keys = [];
        var titles = {};

        items.forEach(function (item) {
            if (!isCardButton(item) || isTorrent(item.btn) || isTrailer(item.btn)) return;

            var key = buttonKey(item.btn);
            keys.push(key);
            titles[key] = $.trim(item.btn.text()) || 'Источник';
        });

        var first = buttonKey(picked.btn);

        chain = {
            activity: active.activity,
            render: active.activity.render(),
            keys: keys,
            titles: titles,
            tried: [first],
            current: first,
            time: Date.now()
        };
    }

    // Открыть следующий мод из карточки. Возвращает true, если открыли
    function chainNext() {
        if (!chain || !enabled(KEY.chain) || Date.now() - chain.time > FORGET) return false;

        // Цепочка работает, только если мы на странице мода, открытой из этой карточки
        var all = Lampa.Activity.all ? Lampa.Activity.all() : [];
        var previous = all.length > 1 ? all[all.length - 2] : null;

        if (!previous || previous.activity !== chain.activity) return false;

        var buttons = chain.render.find('.buttons--container > .full-start__button').not('.hide');
        var next = null;
        var nextKey = null;

        chain.keys.forEach(function (key) {
            if (next || chain.tried.indexOf(key) >= 0) return;

            buttons.each(function () {
                if (!next && buttonKey($(this)) === key) {
                    next = $(this);
                    nextKey = key;
                }
            });
        });

        if (!next) return false;

        var failed = chain.titles[chain.current] || 'Источник';

        chain.tried.push(nextKey);
        chain.current = nextKey;
        chain.time = Date.now();

        Lampa.Noty.show(failed + ' не нашёл. Открываю ' + (chain.titles[nextKey] || $.trim(next.text())));
        Lampa.Activity.back();

        setTimeout(function () {
            next.trigger('hover:enter');
        }, 500);

        return true;
    }

    // Возвращает параметры меню или null, если меню показывать не нужно
    function watchMenu(params) {
        var items = params && params.items;

        if (!items || !items.some(isCardButton)) return params;

        var force = forceMenu;
        forceMenu = false;

        if (enabled(KEY.shots)) {
            items = items.filter(function (item) {
                return !(isCardButton(item) && item.btn.hasClass('shots-view-button'));
            });
            params.items = items;
        }

        if (!items.length) {
            Lampa.Noty.show('Нет источника для просмотра: подключите онлайн-мод или парсер торрентов');
            return null;
        }

        if (!enabled(KEY.play)) return params;

        var select = params.onSelect;
        var last = Lampa.Storage.get(LAST_SOURCE, '') + '';
        var sources = items.filter(function (item) {
            return isCardButton(item) && !isTrailer(item.btn);
        });
        var remembered = null;

        sources.forEach(function (item) {
            if (!remembered && buttonKey(item.btn) === last) remembered = item;
        });

        if (!remembered && sources.length === 1) remembered = sources[0];

        if (remembered && !force) {
            startChain(sources, remembered);
            select(remembered);
            return null;
        }

        if (remembered && !remembered.subtitle) remembered.subtitle = 'Открывается по кнопке «Смотреть»';

        // Что выбрали в списке — то и будет открываться в следующий раз
        params.onSelect = function (item) {
            if (isCardButton(item) && !isTrailer(item.btn)) {
                Lampa.Storage.set(LAST_SOURCE, buttonKey(item.btn));
                startChain(sources, item);
            }

            select.apply(this, arguments);
        };

        return params;
    }

    function wrapSelect() {
        var base = Lampa.Select.show;

        Lampa.Select.show = function (params) {
            var result = params;

            try { result = watchMenu(params); } catch (e) { result = params; }

            if (result) return base.call(Lampa.Select, result);
        };
    }

    var SOURCES_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8 6h13M8 12h13M8 18h13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="3.5" cy="6" r="1.5" fill="currentColor"/><circle cx="3.5" cy="12" r="1.5" fill="currentColor"/><circle cx="3.5" cy="18" r="1.5" fill="currentColor"/></svg>';

    function countSources(render) {
        return render.find('.buttons--container > .full-start__button').not('.hide').not('.view--trailer').length;
    }

    function setupFull(render) {
        var row = render.find('.full-start-new__buttons');
        var play = row.find('.button--play');

        if (!play.length) return;

        var list = row.find('.easy-ui-sources');

        if (!list.length) {
            list = $('<div class="full-start__button selector easy-ui-sources">' + SOURCES_ICON + '<span>Источники</span></div>');

            // Показывает полный список, даже если источник уже запомнен
            list.on('hover:enter', function () {
                forceMenu = true;
                play.trigger('hover:enter');
                forceMenu = false;
            });

            play.after(list);
        }

        var shown = null;

        function refresh() {
            if (!document.body.contains(render[0])) return;

            // Класс hide убирает Shots из родного меню Lampa
            if (enabled(KEY.shots)) render.find('.buttons--container .shots-view-button').addClass('hide');

            var show = enabled(KEY.play) && countSources(render) > 1;
            var changed = shown !== show;

            shown = show;
            list.toggleClass('hide', !show).toggleClass('selector', show);

            if (changed) {
                try {
                    var active = Lampa.Controller.enabled();
                    if (active && active.name === 'full_start') Lampa.Controller.toggle('full_start');
                } catch (e) {}
            }
        }

        // Онлайн-моды добавляют свои кнопки с задержкой — проверяем несколько раз
        [0, 600, 1500, 3000].forEach(function (delay) {
            setTimeout(refresh, delay);
        });
    }

    /* ---------- История: какой балансер находил какой фильм ---------- */

    var HISTORY_KEY = 'easy_ui_found';

    function loadHistory() {
        var h = Lampa.Storage.get(HISTORY_KEY, '{}');

        if (typeof h === 'string') {
            try { h = JSON.parse(h); } catch (e) { h = {}; }
        }

        if (!h || typeof h !== 'object') h = {};
        if (!h.movies || typeof h.movies !== 'object') h.movies = {};
        if (!h.wins || typeof h.wins !== 'object') h.wins = {};
        if (!(h.order instanceof Array)) h.order = [];

        return h;
    }

    function rememberFound(mod, movieKey, source) {
        var h = loadHistory();

        if (h.movies[movieKey] === source) return;

        h.movies[movieKey] = source;
        h.order = h.order.filter(function (key) { return key !== movieKey; });
        h.order.push(movieKey);

        while (h.order.length > HISTORY_LIMIT) delete h.movies[h.order.shift()];

        h.wins[mod + ':' + source] = (h.wins[mod + ':' + source] || 0) + 1;

        Lampa.Storage.set(HISTORY_KEY, h);
    }

    /* ---------- Страница мода: шапка, автоподбор, озвучка ---------- */

    // Моды кладут балансеры в «sort», а сезон, озвучку и качество — в «filter»
    // стандартного Lampa.Filter. Через него плагин работает с любым модом.

    var attempts = {}; // movieKey → { touched, names, manual, finished, found }
    var pages = [];    // открытые страницы модов — для озвучки в плеере

    // Каждый заход на страницу мода начинается заново
    function freshAttempts(movieKey) {
        var record = { touched: Date.now(), names: [], manual: false, finished: false, found: false };

        attempts[movieKey] = record;

        return record;
    }

    function attemptsFor(movieKey) {
        return attempts[movieKey] || freshAttempts(movieKey);
    }

    function selectedOf(list) {
        var current = null;

        list.forEach(function (item) {
            if (!current && item.selected) current = item;
        });

        return current;
    }

    function groupKind(group) {
        var type = String(group.stype || '').toLowerCase();
        var title = String(group.title || '').toLowerCase();

        if (type === 'season' || title.indexOf('сезон') >= 0) return 'season';
        if (type === 'voice' || title.indexOf('перевод') >= 0 || title.indexOf('озвуч') >= 0) return 'voice';
        if (type === 'source') return 'source';

        return 'other';
    }

    function groupValue(group) {
        if (typeof group.subtitle === 'string' && group.subtitle) return group.subtitle;

        var current = selectedOf(group.items || []);

        return current ? current.title : '—';
    }

    function enhanceFilter(filter, params) {
        var movie = params && params.movie ? params.movie : {};
        var mod = params && params.component ? params.component : 'mod';
        var movieKey = mod + ':' + (movie.id || movie.title || movie.name || 'unknown');
        var baseSet = filter.set;
        var baseShow = filter.show;
        var chips = {};
        var order = [];

        freshAttempts(movieKey);

        function read(type) {
            try { return filter.get(type) || []; } catch (e) { return []; }
        }

        // Список балансеров; у сортировки торрентов поля source нет — её не трогаем
        function sources() {
            var items = read('sort');

            return items.length && items[0] && items[0].source !== undefined ? items : null;
        }

        // Моды на Lampac сами проверяют балансеры: у их пунктов есть поле ghost
        function managed(list) {
            return list.some(function (item) {
                return Object.prototype.hasOwnProperty.call(item, 'ghost');
            });
        }

        // Меню с галочками и вложенные без пунктов оставляем моду как есть
        function simple(groups) {
            return !groups.some(function (group) {
                return group.checkbox || (group.items || []).some(function (item) { return item.checkbox || item.items; });
            });
        }

        function headOn() {
            return enabled(KEY.head) && !!sources() && simple(read('filter'));
        }

        // Группы фильтра без дубля списка балансеров (Online Mod кладёт его и туда)
        function groups() {
            var list = sources() || [];
            var titles = list.map(function (item) { return item.title; });

            return read('filter').filter(function (group) {
                if (!group.items || !group.items.length) return false;
                if (groupKind(group) === 'source') return false;

                return !(titles.length && group.items.length === titles.length && group.items.every(function (item) {
                    return titles.indexOf(item.title) >= 0;
                }));
            });
        }

        /* Шапка */

        function chip(key, label, onEnter) {
            var elem = chips[key];

            if (!elem) {
                elem = $('<div class="simple-button simple-button--filter selector easy-ui-chip"><span></span><div></div></div>');
                elem.on('hover:enter', function () { onEnter(); });
                chips[key] = elem;
                elem.data('created', true);
            }

            elem.find('span').text(label);

            return elem;
        }

        function sourceLabel() {
            var list = sources();
            var current = list ? selectedOf(list) : null;
            var name = current ? current.title : '—';
            var record = attemptsFor(movieKey);
            var auto = enabled(KEY.auto) && !record.manual && list && !managed(list);

            return (auto ? 'Авто · ' : '') + name;
        }

        function refreshHead() {
            var root;

            try { root = filter.render(); } catch (e) { return; }

            var on = headOn();

            root.toggleClass('easy-ui-head', on);

            if (!on) {
                $.each(chips, function (key, elem) { elem.addClass('hide'); });
                return;
            }

            var line = root.find('.torrent-filter');
            var created = [];
            var lists = { season: [], voice: [], other: [] };

            groups().forEach(function (group) {
                var key = 'g:' + (group.stype || group.title);
                var kind = groupKind(group);
                var label = kind === 'season' ? 'Сезон' : kind === 'voice' ? 'Озвучка' : group.title;
                var elem = chip(key, label, function () { openGroup(key); });

                elem.data('group', group);
                elem.find('div').text(short(groupValue(group), 22));
                (lists[kind] || lists.other).push(key);
            });

            // Порядок: сезон, озвучка, источник, остальное (качество)
            var wanted = lists.season.concat(lists.voice, ['source'], lists.other);

            chip('source', 'Источник', openSource).find('div').text(short(sourceLabel(), 26));

            wanted.forEach(function (key) {
                var elem = chips[key];

                elem.removeClass('hide');

                if (!elem.parent().length || elem.parent()[0] !== line[0]) {
                    line.append(elem);
                    created.push(elem[0]);
                } else {
                    line.append(elem); // порядок
                }
            });

            $.each(chips, function (key, elem) {
                if (wanted.indexOf(key) < 0) elem.addClass('hide');
            });

            order = wanted;

            // Новые кнопки добавляем в навигацию пульта, если страница уже на экране
            if (created.length) {
                try {
                    if (Lampa.Controller.enabled().name === 'content' && document.body.contains(root[0])) {
                        Lampa.Controller.collectionAppend(created);
                    }
                } catch (e) {}
            }
        }

        function back() {
            if (typeof filter.onBack === 'function') filter.onBack();
            else Lampa.Controller.toggle('content');
        }

        function applyGroup(group, item) {
            filter.selected(group.items, item);
            filter.onSelect('filter', group, item);
        }

        function openGroup(key) {
            var elem = chips[key];
            var group = elem ? elem.data('group') : null;

            if (!group) return;

            var value = groupValue(group);

            Lampa.Select.show({
                title: elem.find('span').text(),
                items: group.items.map(function (item) {
                    return {
                        title: item.title,
                        subtitle: item.subtitle,
                        selected: !!item.selected || item.title === value,
                        item: item
                    };
                }),
                onBack: back,
                onSelect: function (picked) {
                    applyGroup(group, picked.item);
                    closeMenuIfOpen();
                    refreshHead();
                }
            });
        }

        function openSource() {
            var list = sources();

            if (!list) return;

            var record = attemptsFor(movieKey);
            var h = loadHistory();
            var known = h.movies[movieKey];
            var isManaged = managed(list);

            var sorted = list.slice().sort(function (a, b) {
                if (!!a.ghost !== !!b.ghost) return a.ghost ? 1 : -1;
                if (!isManaged) {
                    var sa = (a.source === known ? 100000 : 0) + (h.wins[mod + ':' + a.source] || 0);
                    var sb = (b.source === known ? 100000 : 0) + (h.wins[mod + ':' + b.source] || 0);
                    if (sa !== sb) return sb - sa;
                }
                return list.indexOf(a) - list.indexOf(b);
            });

            var menu = sorted.map(function (item) {
                var note = '';

                if (item.selected) note = 'Сейчас включён';
                else if (item.ghost) note = 'Недоступен';
                else if (record.names.indexOf(item.source) >= 0) note = 'Не нашёл этот фильм';
                else if (item.source === known) note = 'Уже находил этот фильм';
                else if (isManaged) note = 'Доступен';

                return {
                    title: item.title,
                    subtitle: note,
                    selected: !!item.selected,
                    ghost: !!item.ghost,
                    pick: { type: 'sort', item: item }
                };
            });

            // Пункты фильтра без вложенного списка («Сбросить фильтр»)
            read('filter').forEach(function (group) {
                if (!group.items || !group.items.length) menu.push({ title: group.title, pick: { type: 'filter', group: group } });
            });

            Lampa.Select.show({
                title: 'Источник',
                items: menu,
                onBack: back,
                onSelect: function (picked) {
                    var pick = picked.pick;

                    if (pick.type === 'sort') {
                        // Выбран руками — автоподбор и цепочка для этого фильма больше не вмешиваются
                        record.manual = true;
                        filter.selected(list, pick.item);
                        filter.onSelect('sort', pick.item);
                    } else {
                        filter.onSelect('filter', pick.group);
                    }

                    closeMenuIfOpen();
                    refreshHead();
                }
            });
        }

        filter.set = function (type, items) {
            baseSet.call(filter, type, items);
            refreshHead();
        };

        // Кнопка «Сменить балансер» в заглушках модов вызывает show('sort')
        filter.show = function (title, type) {
            if (type === 'sort' && headOn()) return openSource();
            return baseShow.call(filter, title, type);
        };

        /* Автоподбор балансера и цепочка */

        var watched = '';
        var since = Date.now();
        var born = Date.now();
        var jumped = false;
        var timer = setInterval(check, AUTO_CHECK);

        function page() {
            try { return filter.render().closest('.activity'); } catch (e) { return $(); }
        }

        function rows() {
            return page().find('.selector').filter(function () {
                return !$(this).closest('.torrent-filter, .explorer__left, .empty, .online-empty').length;
            });
        }

        // Что сейчас на странице мода: результаты, «Пусто», своя заглушка мода или ещё грузится
        function pageState() {
            var p = page();

            if (!p.length) return Date.now() - born > AUTO_WAIT ? 'gone' : 'loading';
            if (p.find('.online-empty').length) return 'handled';
            if (rows().length) return 'found';
            if (p.find('.empty').length) return 'empty';

            return 'loading';
        }

        function switchTo(list, item) {
            withoutMenuClose(function () {
                filter.selected(list, item);
                filter.onSelect('sort', item);
            });
        }

        function giveUp(record) {
            record.finished = true;
            if (!chainNext()) Lampa.Noty.show('Ни один источник не нашёл это видео');
        }

        function check() {
            var state = pageState();

            if (state === 'gone') {
                clearInterval(timer);
                pages = pages.filter(function (p) { return p !== api; });
                return;
            }

            var list = sources();
            if (!list) return;

            var current = selectedOf(list);
            var record = attemptsFor(movieKey);

            record.touched = Date.now();
            refreshSourceChip();

            if (state === 'found') {
                if (current && !record.found) {
                    record.found = true;
                    rememberFound(mod, movieKey, current.source);
                }

                record.finished = true;
                return;
            }

            if (record.finished || record.manual) return;

            // Мод сам перебирает балансеры — ждём его, а если так ничего и не нашёл, идём по цепочке
            if (managed(list) || state === 'handled') {
                if (Date.now() - born > MANAGED_WAIT) giveUp(record);
                return;
            }

            if (!enabled(KEY.auto) || !current) {
                if (state === 'empty' && Date.now() - born > AUTO_SETTLE * 2) giveUp(record);
                return;
            }

            var h = loadHistory();
            var known = h.movies[movieKey];

            // Второй заход в фильм: сразу открываем балансер, который уже находил его
            if (!jumped) {
                jumped = true;

                if (known && known !== current.source) {
                    var target = null;

                    list.forEach(function (item) {
                        if (!target && item.source === known && !item.ghost) target = item;
                    });

                    if (target) {
                        Lampa.Noty.show('Открываю ' + target.title + ': он уже находил этот фильм');
                        watched = target.source;
                        since = Date.now();
                        switchTo(list, target);
                        return;
                    }
                }
            }

            if (current.source !== watched) {
                watched = current.source;
                since = Date.now();
            }

            var waited = Date.now() - since;

            if (waited < AUTO_SETTLE) return;
            if (state === 'loading' && waited < AUTO_WAIT) return;

            // Балансер ничего не нашёл или завис — пробуем следующий
            if (record.names.indexOf(current.source) < 0) record.names.push(current.source);

            var candidates = list.filter(function (item) {
                return !item.ghost && record.names.indexOf(item.source) < 0;
            });

            candidates.sort(function (a, b) {
                var sa = (a.source === known ? 100000 : 0) + (h.wins[mod + ':' + a.source] || 0);
                var sb = (b.source === known ? 100000 : 0) + (h.wins[mod + ':' + b.source] || 0);
                return sa !== sb ? sb - sa : list.indexOf(a) - list.indexOf(b);
            });

            var next = candidates[0];

            if (!next) return giveUp(record);

            Lampa.Noty.show(current.title + ': не найдено. Пробую ' + next.title);
            watched = next.source;
            since = Date.now();
            switchTo(list, next);
        }

        function refreshSourceChip() {
            var elem = chips.source;
            if (!elem || elem.hasClass('hide')) return;

            var text = short(sourceLabel(), 26);
            var value = elem.find('div');

            if (value.text() !== text) value.text(text);
        }

        /* Для озвучки в плеере */

        var api = {
            filter: filter,
            movie: movie,
            lastRow: null,
            page: page,
            rows: rows,
            isMovie: function () {
                return !(movie.name || movie.number_of_seasons || movie.original_name);
            },
            voiceGroup: function () {
                var found = null;

                groups().forEach(function (group) {
                    if (!found && groupKind(group) === 'voice') found = group;
                });

                return found;
            },
            applyVoice: function (title) {
                var group = api.voiceGroup();
                var item = null;

                if (!group) return false;

                group.items.forEach(function (it) {
                    if (!item && it.title === title) item = it;
                });

                if (!item) return false;

                withoutMenuClose(function () { applyGroup(group, item); });
                refreshHead();

                return true;
            }
        };

        pages.push(api);
    }

    function wrapFilter() {
        var Original = Lampa.Filter;

        function Filter(params) {
            Original.call(this, params);
            try { enhanceFilter(this, params); } catch (e) {}
        }

        Filter.prototype = Original.prototype;
        Lampa.Filter = Filter;
    }

    /* ---------- Озвучка в плеере ---------- */

    // Моды отдают в плеер одну озвучку. Плагин добавляет в меню звука плеера
    // озвучки из фильтра мода: выбор закрывает видео, переключает озвучку в моде
    // и запускает ту же серию. Место просмотра восстанавливает сам мод.

    var playerVoices = null;

    function activePage() {
        var active = Lampa.Activity.active();
        var render = active && active.activity ? active.activity.render() : null;
        var found = null;

        if (!render) return null;

        pages.forEach(function (p) {
            var pg = p.page();
            if (!found && pg.length && (pg[0] === render[0] || $.contains(render[0], pg[0]) || $.contains(pg[0], render[0]))) found = p;
        });

        return found;
    }

    function rowText(row) {
        var title = row.find('.online__title, .online-prestige__title, .torrent-item__title').first().text();
        return $.trim(title || row.text()).slice(0, 120);
    }

    // Запоминаем, какую строку (серию) запустили
    function trackRows() {
        function remember(target) {
            var row = $(target).closest('.selector');

            if (!row.length || row.closest('.torrent-filter, .selectbox, .player').length) return;

            pages.forEach(function (p) {
                var list = p.rows();
                var index = list.index(row);

                if (index >= 0) p.lastRow = { index: index, text: rowText(row), count: list.length };
            });
        }

        // Пульт шлёт невсплывающее событие — ловим на фазе захвата
        document.addEventListener('hover:enter', function (e) { remember(e.target); }, true);
        // jQuery .trigger() идёт мимо addEventListener, но всплывает внутри jQuery
        $(document).on('hover:enter', '.selector', function (e) { remember(e.target); });
    }

    function findRow(p, wanted) {
        var list = p.rows();
        var match = null;

        list.each(function () {
            if (!match && rowText($(this)) === wanted.text) match = $(this);
        });

        // Другая озвучка может по-другому называть серию: ищем по номеру
        var number = (wanted.text.match(/\d+/) || [])[0];

        if (!match && number) {
            var same = list.filter(function () {
                return (rowText($(this)).match(/\d+/) || [])[0] === number;
            });

            if (same.length === 1) match = same.eq(0);
        }

        // Фильм: одна строка — она и есть
        if (!match && list.length === 1 && wanted.count === 1) match = list.eq(0);

        return match;
    }

    // Ждём, пока мод перестроит список. Нужной строки нет 2 с после появления списка — её нет совсем
    function waitForRow(p, wanted, done) {
        var started = Date.now();
        var listed = 0;

        function tick() {
            var now = Date.now();
            var match = now - started > 600 ? findRow(p, wanted) : null;

            if (match) return done(match);

            if (now - started > 600 && p.rows().length) {
                if (!listed) listed = now;
                if (now - listed > 2000) return done(null);
            } else listed = 0;

            if (now - started > 15000) return done(null);

            setTimeout(tick, 300);
        }

        setTimeout(tick, 300);
    }

    function switchVoice(p, title, previous) {
        var wanted = p.lastRow;

        Lampa.Player.close();

        setTimeout(function () {
            if (!p.applyVoice(title)) return Lampa.Noty.show('Не удалось переключить озвучку');
            if (!wanted) return;

            waitForRow(p, wanted, function (row) {
                if (row) {
                    row.trigger('hover:enter');
                    return;
                }

                Lampa.Noty.show('В озвучке «' + title + '» нет этой серии — вернул «' + previous + '»');

                // Возвращаем прежнюю озвучку и снова включаем ту же серию
                if (!p.applyVoice(previous)) return;

                waitForRow(p, wanted, function (again) {
                    if (again) again.trigger('hover:enter');
                });
            });
        }, 300);
    }

    // Для фильма, где мод показывает варианты строками (озвучка, качество)
    function switchRow(p, index) {
        Lampa.Player.close();

        setTimeout(function () {
            var row = p.rows().eq(index);
            if (row.length) row.trigger('hover:enter');
        }, 400);
    }

    function voiceItems(data) {
        if (!enabled(KEY.voice) || !data || data.voiceovers || data.torrent_hash || data.iptv) return null;

        var p = activePage();
        if (!p) return null;

        var group = p.voiceGroup();

        if (group && group.items.length > 1) {
            var current = groupValue(group);

            return group.items.map(function (item) {
                return {
                    name: 'Озвучка: ' + item.title,
                    ignore_translate: true,
                    selected: item.title === current,
                    onSelect: function () {
                        if (item.title !== current) switchVoice(p, item.title, current);
                    }
                };
            });
        }

        // Фильм без группы озвучки, но с несколькими строками-вариантами
        var list = p.rows();

        if (p.isMovie() && list.length > 1 && p.lastRow) {
            var items = [];

            list.each(function (i) {
                var text = rowText($(this));

                items.push({
                    name: 'Вариант: ' + short(text, 40),
                    ignore_translate: true,
                    selected: i === p.lastRow.index,
                    onSelect: function () {
                        if (i !== p.lastRow.index) switchRow(p, i);
                    }
                });
            });

            return items;
        }

        return null;
    }

    function watchPlayer() {
        Lampa.Player.listener.follow('start', function (data) {
            playerVoices = null;

            try { playerVoices = voiceItems(data); } catch (e) { playerVoices = null; }

            if (playerVoices) Lampa.PlayerPanel.setTracks(playerVoices.slice());
        });

        // Дорожки из самого видео (в том числе оригинал) оставляем и добавляем к ним озвучки мода
        Lampa.PlayerVideo.listener.follow('tracks', function (e) {
            if (!playerVoices) return;

            var own = e && e.tracks ? Array.prototype.slice.call(e.tracks) : [];

            Lampa.PlayerPanel.setTracks(own.concat(playerVoices));
        });

        Lampa.Player.listener.follow('destroy', function () {
            playerVoices = null;
        });
    }

    /* ---------- Якорь для пульта ---------- */

    function box(elem) {
        var r = elem.getBoundingClientRect();
        return r.width > 0 || r.height > 0 ? r : null;
    }

    // Сосед строго в своём ряду (влево/вправо) или в своей колонке (вверх/вниз)
    function anchored(nav, target, direction) {
        var t = box(target);
        var horizontal = direction === 'left' || direction === 'right';
        var forward = direction === 'right' || direction === 'down';
        var best = null;
        var bestScore = Infinity;

        if (!t || !nav._collection) return null;

        var tx = t.left + t.width / 2;
        var ty = t.top + t.height / 2;

        nav._collection.forEach(function (elem) {
            if (elem === target) return;

            var r = box(elem);
            if (!r) return;

            var dx = r.left + r.width / 2 - tx;
            var dy = r.top + r.height / 2 - ty;
            var along = horizontal ? dx : dy;
            var across = horizontal ? dy : dx;

            if (forward ? along < 2 : along > -2) return;

            // Должны перекрываться минимум наполовину по поперечной оси
            var overlap = horizontal
                ? Math.min(t.bottom, r.bottom) - Math.max(t.top, r.top)
                : Math.min(t.right, r.right) - Math.max(t.left, r.left);
            var size = horizontal ? Math.min(t.height, r.height) : Math.min(t.width, r.width);

            if (overlap < size * 0.5) return;

            var score = Math.round(Math.abs(along) / 4) * 10000 + Math.abs(across);

            if (score < bestScore && nav._isNavigable(elem)) {
                bestScore = score;
                best = elem;
            }
        });

        return best;
    }

    function wrapNavigator() {
        var nav = window.Navigator;

        if (!nav || typeof nav.navigate !== 'function') return;

        var base = nav.navigate;

        nav.navigate = function (target, direction) {
            if (enabled(KEY.anchor) && target && direction) {
                try {
                    var found = anchored(this, target, String(direction).toLowerCase());
                    if (found) return found;
                } catch (e) {}
            }

            return base.call(this, target, direction);
        };
    }

    // Стрелки пульта на разных платформах → направление
    var ARROWS = {
        37: 'left', 4: 'left', 50400010: 'left',
        38: 'up', 29460: 'up', 50400012: 'up',
        39: 'right', 5: 'right', 50400011: 'right',
        40: 'down', 29461: 'down', 50400013: 'down'
    };

    var gesture = { last: 0, start: 0, step: 0, direction: '' };

    // Сенсор пульта шлёт стрелки пачкой: короткий свайп = ровно один шаг,
    // случайные стрелки поперёк движения внутри пачки отбрасываются,
    // долгий свайп или удержание кнопки двигают фокус размеренно.
    function allowStep(direction, now) {
        var gap = now - gesture.last;

        gesture.last = now;

        if (gap > BURST_GAP || gap < 0) {
            gesture.start = now;
            gesture.step = now;
            gesture.direction = direction;
            return true;
        }

        if (direction !== gesture.direction) return false;
        if (now - gesture.start < HOLD_DELAY) return false;
        if (now - gesture.step < HOLD_REPEAT) return false;

        gesture.step = now;
        return true;
    }

    function limitSteps() {
        window.addEventListener('keydown', function (e) {
            var direction = ARROWS[e.keyCode];

            if (!direction || !enabled(KEY.anchor)) return;

            var tag = e.target && e.target.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA') return;

            try { if (Lampa.Player.opened()) return; } catch (err) {}

            if (!allowStep(direction, Date.now())) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
    }

    /* ---------- Настройки ---------- */

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'easy_ui',
            name: 'Удобный интерфейс',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="2"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>'
        });

        Lampa.SettingsApi.addParam({
            component: 'easy_ui',
            param: { name: 'easy_ui_version_title', type: 'title' },
            field: { name: 'Версия ' + VERSION }
        });

        [
            [KEY.play, '«Смотреть» открывает сразу', 'Запускает мод, выбранный в прошлый раз; остальные — по кнопке «Источники»'],
            [KEY.shots, 'Скрыть Shots', 'Убирает нарезки с карточки, из меню и с главной'],
            [KEY.head, 'Шапка: сезон, озвучка, источник', 'Видимые кнопки с текущим значением вместо «Сортировать» и «Фильтр»'],
            [KEY.auto, 'Автоподбор источника', 'Пустой или зависший балансер — сам переключает на следующий, начиная с проверенных'],
            [KEY.chain, 'Цепочка модов', 'Если мод не нашёл фильм ни на одном балансере — открывает следующий мод'],
            [KEY.voice, 'Озвучка в плеере', 'Смена озвучки через кнопку звука во время просмотра'],
            [KEY.priority, 'Скрыть кнопку приоритетного источника', 'Убирает с карточки отдельную кнопку источника слева от «Смотреть»'],
            [KEY.smooth, 'Плавная прокрутка', 'Ленты тормозят мягче; больше ничего во внешнем виде не меняется'],
            [KEY.anchor, 'Якорь для пульта', 'Короткий свайп по сенсору — один шаг; фокус не проскакивает кнопки и не уходит в другой ряд']
        ].forEach(function (row) {
            Lampa.SettingsApi.addParam({
                component: 'easy_ui',
                param: { name: row[0], type: 'trigger', default: OFF_BY_DEFAULT.indexOf(row[0]) < 0 },
                field: { name: row[1], description: row[2] },
                onChange: function () { setTimeout(applyBodyClasses, 0); }
            });
        });
    }

    /* ---------- Запуск ---------- */

    var problems = [];

    function safe(name, fn) {
        try { fn(); } catch (e) { problems.push(name + ' (' + (e && e.message ? e.message : e) + ')'); }
    }

    function start() {
        safe('стили', function () { $('<style id="easy-ui-style"></style>').text(CSS).appendTo('head'); });
        safe('страница мода', wrapFilter);
        safe('кнопка «Смотреть»', wrapSelect);
        safe('пульт', wrapNavigator);
        safe('пульт', limitSteps);
        safe('плеер', watchPlayer);
        safe('серии', trackRows);
        safe('настройки', addSettings);
        safe('внешний вид', applyBodyClasses);
        safe('Shots', watchShots);

        safe('карточка', function () {
            Lampa.Listener.follow('full', function (e) {
                if (e.type !== 'complite') return;
                try { setupFull(e.object.activity.render()); } catch (err) {}
            });
        });

        // Видно, что плагин загрузился и какой он версии
        setTimeout(function () {
            if (problems.length) {
                Lampa.Noty.show('Удобный интерфейс ' + VERSION + ': не запустилось — ' + problems.join(', '));
                return;
            }

            if (Lampa.Storage.get('easy_ui_seen_version', '') + '' !== VERSION) {
                Lampa.Storage.set('easy_ui_seen_version', VERSION);
                Lampa.Noty.show('Удобный интерфейс ' + VERSION + ' включён');
            }
        }, 3000);
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
