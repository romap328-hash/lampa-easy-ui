/*
 * Easy UI — плагин интерфейса для Lampa (проверен на 3.4.7).
 * Механики не трогает: только внешний вид и то, как нажимаются кнопки.
 *
 *  1. Одна кнопка «Смотреть»: открывает источник, выбранный в прошлый раз.
 *     Остальные источники — в одном списке по кнопке «Источники».
 *  2. Shots убран с карточки, из бокового меню и с главной.
 *  3. Источник (балансер), озвучка и сезон — одна кнопка и одно меню вместо
 *     трёх. Работает с любым онлайн-плагином на стандартном фильтре Lampa
 *     (Online Mod, Z01 и т. п.), под конкретный плагин не заточено.
 *  4. Прокрутка мягче, а фокус пульта «якорится»: не проскакивает кнопки
 *     при быстром нажатии и не уходит по диагонали в другой ряд.
 *
 * Каждый пункт выключается в «Настройки → Удобный интерфейс».
 * Синтаксис ES5 — чтобы работало на старых телевизорах.
 */
(function () {
    'use strict';

    if (window.easy_ui_plugin) return;
    window.easy_ui_plugin = true;

    var KEY = {
        shots: 'easy_ui_hide_shots',
        play: 'easy_ui_direct_play',
        source: 'easy_ui_source_menu',
        smooth: 'easy_ui_smooth',
        anchor: 'easy_ui_anchor'
    };

    // Настройка «прилипания» фокуса, мс
    var BURST_GAP = 110;   // события чаще этого — один жест (свайп по сенсору или удержание кнопки)
    var HOLD_DELAY = 360;  // сколько длится жест, прежде чем фокус пойдёт дальше сам
    var HOLD_REPEAT = 150; // шаг при долгом свайпе или удержании

    function enabled(name) {
        var value = Lampa.Storage.get(name, 'true');
        return !(value === false || value === 'false');
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

        /* Кнопка выбора источника — заметнее соседних */
        '.easy-ui-source .filter--sort{background:rgba(255,255,255,.22);font-weight:600}',
        '.easy-ui-source .filter--sort.focus{background:#fff}',
        '.easy-ui-source .filter--filter{display:none!important}'
    ].join('');

    function applyBodyClasses() {
        $('body')
            .toggleClass('easy-ui--smooth', enabled(KEY.smooth))
            .toggleClass('easy-ui--noshots', enabled(KEY.shots));

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

    /* ---------- Карточка: одна кнопка «Смотреть» ---------- */

    // Lampa сама собирает все источники (онлайн-плагины, торренты, трейлеры)
    // в меню кнопки «Смотреть». Мы её обработчик не трогаем — Lampa всё равно
    // перевешивает его при каждом переключении, — а вмешиваемся в само меню:
    // убираем Shots и вместо списка сразу открываем источник, выбранный раньше.

    var LAST_SOURCE = 'easy_ui_last_source';
    var forceMenu = false;

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
            Lampa.Noty.show('Нет источника для просмотра: подключите онлайн-плагин или парсер торрентов');
            return null;
        }

        if (!enabled(KEY.play)) return params;

        var select = params.onSelect;
        var last = Lampa.Storage.get(LAST_SOURCE, '') + '';
        var sources = items.filter(function (item) {
            return isCardButton(item) && !item.btn.hasClass('view--trailer');
        });
        var remembered = null;

        sources.forEach(function (item) {
            if (!remembered && buttonKey(item.btn) === last) remembered = item;
        });

        if (!remembered && sources.length === 1) remembered = sources[0];

        if (remembered && !force) {
            select(remembered);
            return null;
        }

        if (remembered && !remembered.subtitle) remembered.subtitle = 'Открывается по кнопке «Смотреть»';

        // Что выбрали в списке — то и будет открываться в следующий раз
        params.onSelect = function (item) {
            if (isCardButton(item) && !item.btn.hasClass('view--trailer')) Lampa.Storage.set(LAST_SOURCE, buttonKey(item.btn));
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

        // Онлайн-плагины добавляют свои кнопки с задержкой — проверяем несколько раз
        [0, 600, 1500, 3000].forEach(function (delay) {
            setTimeout(refresh, delay);
        });
    }

    /* ---------- Источник, озвучка и сезон: одно меню ---------- */

    // Онлайн-плагины кладут балансеры в «sort», а озвучку и сезон — в «filter»
    // стандартного Lampa.Filter. Здесь оба списка собираются в одно меню.
    function enhanceFilter(filter) {
        var baseSet = filter.set;
        var baseShow = filter.show;
        var baseChosen = filter.chosen;
        var chosen = { sort: [], filter: [] };

        function read(type) {
            try { return filter.get(type) || []; } catch (e) { return []; }
        }

        // Список балансеров; у сортировки торрентов поля source нет — её не трогаем
        function sources() {
            var items = read('sort');

            return enabled(KEY.source) && items.length && items[0] && items[0].source !== undefined ? items : null;
        }

        // Меню с галочками и вложенные без пунктов оставляем плагину как есть
        function simple(groups) {
            return !groups.some(function (group) {
                return group.checkbox || (group.items || []).some(function (item) { return item.checkbox || item.items; });
            });
        }

        function refresh() {
            try {
                var root = filter.render();
                var on = !!sources() && simple(read('filter'));

                root.toggleClass('easy-ui-source', on);
                if (!on) return;

                var text = chosen.sort.concat(chosen.filter).join(' · ');

                root.find('.filter--filter').removeClass('selector');
                root.find('.filter--sort > span').text('Источник и озвучка');
                root.find('.filter--sort > div').text(text).toggleClass('hide', !text);
            } catch (e) {}
        }

        filter.set = function (type, items) {
            baseSet.call(filter, type, items);
            refresh();
        };

        filter.chosen = function (type, select) {
            baseChosen.call(filter, type, select);
            chosen[type] = select || [];
            refresh();
        };

        filter.show = function (title, type) {
            var list = sources();
            var groups = read('filter');

            if (!list || !simple(groups)) return baseShow.call(filter, title, type);

            var menu = [];
            var titles = list.map(function (item) { return item.title; });

            // Online Mod дублирует список балансеров ещё и внутри фильтра — второй раз не показываем
            function duplicatesSources(group) {
                if (group.stype === 'source') return true;

                return group.items.length === titles.length && group.items.every(function (item) {
                    return titles.indexOf(item.title) >= 0;
                });
            }

            // Сначала короткие списки — сезон и озвучка
            groups.forEach(function (group) {
                if (!group.items || !group.items.length || duplicatesSources(group)) return;

                menu.push({ title: group.title, separator: true });

                group.items.forEach(function (item) {
                    menu.push({
                        title: item.title,
                        subtitle: item.subtitle,
                        selected: !!item.selected || (group.subtitle && item.title === group.subtitle),
                        pick: { type: 'filter', group: group, item: item }
                    });
                });
            });

            // Затем балансеры. «Недоступен» сообщает сам онлайн-плагин (ghost)
            var checked = list.some(function (item) { return item.ghost; });

            menu.push({ title: 'Источник', separator: true });

            list.forEach(function (item) {
                menu.push({
                    title: item.title,
                    subtitle: item.selected ? 'Сейчас включён' : item.ghost ? 'Недоступен' : checked ? 'Доступен' : '',
                    selected: !!item.selected,
                    ghost: !!item.ghost,
                    pick: { type: 'sort', item: item }
                });
            });

            // Пункты без вложенного списка («Сбросить фильтр»)
            groups.forEach(function (group) {
                if (!group.items || !group.items.length) menu.push({ title: group.title, pick: { type: 'filter', group: group } });
            });

            Lampa.Select.show({
                title: 'Источник и озвучка',
                items: menu,
                onBack: filter.onBack,
                onSelect: function (picked) {
                    var pick = picked.pick;

                    if (pick.type === 'sort') {
                        filter.selected(list, pick.item);
                        filter.onSelect('sort', pick.item);
                    } else {
                        if (pick.item) filter.selected(pick.group.items, pick.item);
                        filter.onSelect('filter', pick.group, pick.item);
                    }

                    // Если плагин сам не вернул управление странице — возвращаем
                    try {
                        if (Lampa.Controller.enabled().name === 'select') Lampa.Select.close();
                    } catch (e) {}
                }
            });
        };
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

    // Решает, пропустить ли очередное нажатие стрелки.
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

    function wrapFilter() {
        var Original = Lampa.Filter;

        function Filter(params) {
            Original.call(this, params);
            try { enhanceFilter(this); } catch (e) {}
        }

        Filter.prototype = Original.prototype;
        Lampa.Filter = Filter;
    }

    /* ---------- Настройки ---------- */

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'easy_ui',
            name: 'Удобный интерфейс',
            icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="4" width="20" height="16" rx="3" stroke="currentColor" stroke-width="2"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>'
        });

        [
            [KEY.play, '«Смотреть» открывает сразу', 'Запускает источник, выбранный в прошлый раз; остальные — по кнопке «Источники»'],
            [KEY.shots, 'Скрыть Shots', 'Убирает нарезки с карточки, из меню и с главной'],
            [KEY.source, 'Источник и озвучка одним меню', 'Балансер, озвучка и сезон выбираются в одном списке вместо трёх'],
            [KEY.smooth, 'Плавная прокрутка', 'Ленты тормозят мягче; больше ничего во внешнем виде не меняется'],
            [KEY.anchor, 'Якорь для пульта', 'Короткий свайп по сенсору — один шаг; фокус не проскакивает кнопки и не уходит в другой ряд']
        ].forEach(function (row) {
            Lampa.SettingsApi.addParam({
                component: 'easy_ui',
                param: { name: row[0], type: 'trigger', default: true },
                field: { name: row[1], description: row[2] },
                onChange: function () { setTimeout(applyBodyClasses, 0); }
            });
        });
    }

    /* ---------- Запуск ---------- */

    function start() {
        $('<style id="easy-ui-style"></style>').text(CSS).appendTo('head');

        wrapFilter();
        wrapSelect();
        wrapNavigator();
        limitSteps();
        addSettings();
        applyBodyClasses();
        watchShots();

        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;
            try { setupFull(e.object.activity.render()); } catch (err) {}
        });
    }

    if (window.appready) start();
    else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') start();
        });
    }
})();
