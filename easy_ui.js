/*
 * Easy UI — плагин интерфейса для Lampa (проверен на 3.4.7).
 * Механики не трогает: только внешний вид и порядок действий.
 * Источники видео остаются в установленных онлайн-модах (Online Mod, моды на Lampac и др.).
 *
 *  1. Одна кнопка «Смотреть»: открывает мод, выбранный в прошлый раз.
 *     Остальные — по кнопке «Источники». Shots убран отовсюду.
 *  2. Шапка на странице мода: «Сезон», «Озвучка», «Сервер» — видимые кнопки
 *     с текущим значением вместо меню «Сортировать» и «Фильтр».
 *     Серии плиткой с кадрами из серии; «Назад» в списке — сразу к шапке.
 *  3. Автоподбор сервера (балансера): пустой или зависший — сам переключает
 *     на следующий, начиная с тех, что уже находили этот фильм или находят чаще.
 *     Сначала русская озвучка: только субтитры или оригинал — ищет дальше.
 *  4. Цепочка модов: если мод не нашёл фильм ни на одном сервере,
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

    var VERSION = '0.7.0';
    window.easy_ui_version = VERSION;

    var KEY = {
        play: 'easy_ui_direct_play',
        shots: 'easy_ui_hide_shots',
        head: 'easy_ui_source_menu',
        auto: 'easy_ui_auto_source',
        russian: 'easy_ui_russian',
        grid: 'easy_ui_grid',
        card: 'easy_ui_card',
        chain: 'easy_ui_chain',
        voice: 'easy_ui_player_voice',
        resume: 'easy_ui_resume',
        tracks: 'easy_ui_tracks',
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
    var FOREIGN_RECHECK = 86400000; // фильм только с субтитрами: снова ищем русскую озвучку через сутки

    // Озвучка не на русском: оригинал, субтитры, английская, украинская и т. п.
    var FOREIGN = /субтит|sub\b|subs\b|\bsub|оригинал|original|\borig\b|\beng\b|english|англ|укр|ukr|україн|\bua\b|japan|япон|корей|korea/i;
    // А это русская озвучка, даже если в названии есть «субтитры» («Дубляж + субтитры»)
    var RUSSIAN_VOICE = /дубл|многогол|двухгол|одногол|закадр|\bmvo\b|\bdvo\b/i;

    function foreign(title) {
        title = String(title || '');
        return FOREIGN.test(title) && !RUSSIAN_VOICE.test(title);
    }

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
        '.easy-ui-chip.hide{display:none!important}',

        /* Карточка: всё внизу поверх фона, без маленького постера, эмоции сразу под названием */
        'body.easy-ui--card .full-start-new{position:relative;display:-webkit-box;display:-webkit-flex;display:flex;',
        '-webkit-box-orient:vertical;-webkit-flex-direction:column;flex-direction:column;-webkit-box-pack:end;-webkit-justify-content:flex-end;justify-content:flex-end;',
        'min-height:-webkit-calc(100vh - 6.5em);min-height:calc(100vh - 6.5em);-webkit-box-sizing:border-box;box-sizing:border-box}',
        'body.easy-ui--card .full-start-new::before{content:"";position:absolute;left:0;right:0;bottom:0;height:75%;pointer-events:none;',
        'background:-webkit-linear-gradient(bottom,rgba(0,0,0,.75),rgba(0,0,0,0));background:linear-gradient(to top,rgba(0,0,0,.75),rgba(0,0,0,0))}',
        /* Размытый фон Lampa светит слева сверху (там, где обложка не закрывает) — слегка приглушаем угол, фон остаётся */
        'body.easy-ui--card .background::after{content:"";position:absolute;left:0;top:0;right:0;bottom:0;pointer-events:none;',
        'background:-webkit-radial-gradient(0 0,ellipse,rgba(0,0,0,.25) 0%,rgba(0,0,0,.15) 26%,rgba(0,0,0,0) 65%);',
        'background:radial-gradient(ellipse 65% 75% at 0 0,rgba(0,0,0,.25) 0%,rgba(0,0,0,.15) 40%,rgba(0,0,0,0) 100%)}',
        'body.easy-ui--card .full-start-new__body{position:relative}',
        'body.easy-ui--card .full-start-new__left{display:none}',
        'body.easy-ui--card .full-start-new__right{min-width:0}',
        // Эмоции переносятся под название самим плагином (setupFull), остальные блоки — где их поставили Lampa и другие плагины
        'body.easy-ui--card .full-start-new__reactions{min-height:0;margin:-.3em -.5em .5em}',
        'body.easy-ui--card .full-start-new__reactions>div{padding:.3em .5em}',
        'body.easy-ui--card .full-start-new__buttons{margin-top:.8em}',

        /* Кнопки: большая «Смотреть» акцентного цвета, остальные мельче и сбоку */
        'body.easy-ui--card .full-start-new__buttons .full-start__button{font-size:1.05em;height:2.5em;padding:.2em .75em;margin-right:.6em}',
        'body.easy-ui--card .full-start-new__buttons .button--play{-webkit-box-ordinal-group:0;-webkit-order:-1;order:-1;',
        'font-size:1.55em;height:2.6em;padding:.3em 1.6em .3em 1.3em;margin-right:1.2em;background-color:#1473e6;color:#fff}',
        'body.easy-ui--card .full-start-new__buttons .button--play span{display:block!important;font-weight:600}',
        'body.easy-ui--card .full-start-new__buttons .button--play.focus{background-color:#4b9cf5;color:#fff;box-shadow:0 0 0 .14em #fff}',

        /* Постер во весь экран */
        '.easy-ui-poster-view{position:fixed;left:0;top:0;right:0;bottom:0;z-index:9999;background:#000;',
        'display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-align:center;-webkit-align-items:center;align-items:center;',
        '-webkit-box-pack:center;-webkit-justify-content:center;justify-content:center}',
        '.easy-ui-poster-view img{max-width:100%;max-height:100%;display:block}',
        '.easy-ui-poster-view .selector{position:absolute;left:0;top:0;right:0;bottom:0}',

        /* Серии плиткой: по четыре в ряд, кадр из серии, номер и название */
        '.easy-ui-grid .explorer__files .scroll__body{display:-webkit-box;display:-webkit-flex;display:flex;',
        '-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-content:flex-start;align-content:flex-start;margin-right:-1em}',
        '.easy-ui-grid .explorer__files .scroll__body>*{width:100%;margin-right:1em}',
        '.easy-ui-grid .explorer__files .scroll__body>.online{width:-webkit-calc(25% - 1em);width:calc(25% - 1em);',
        'margin:0 1em 1.2em 0;padding:0;overflow:hidden;-webkit-box-sizing:border-box;box-sizing:border-box}',
        '.easy-ui-grid .online .online__body{padding:.7em .9em 1em}',
        '.easy-ui-grid .online .online__body>div:first-child{display:none}',
        '.easy-ui-grid .online .online__title,.easy-ui-grid .online .online__quality{padding-left:0!important}',
        '.easy-ui-grid .online .online__title{font-size:1.2em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.easy-ui-grid .online .online__quality{margin-top:.4em;font-size:.85em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.7}',
        '.easy-ui-thumb{display:none}',
        '.easy-ui-grid .easy-ui-thumb{display:block;position:relative;padding-top:56.25%;background-color:rgba(255,255,255,.06);',
        'background-position:50% 50%;background-repeat:no-repeat;-webkit-background-size:cover;background-size:cover}',
        '.easy-ui-grid .easy-ui-thumb--empty::after{content:attr(data-num);position:absolute;left:0;right:0;top:50%;margin-top:-.6em;',
        'font-size:2.6em;line-height:1.2;font-weight:600;text-align:center;opacity:.25}',
        '.easy-ui-thumb__num{position:absolute;left:.5em;top:.5em;padding:.1em .5em;border-radius:.3em;',
        'font-size:1.05em;font-weight:600;line-height:1.3;background:rgba(0,0,0,.65);color:#fff}',
        '.easy-ui-ep{display:none}',
        '.easy-ui-grid .easy-ui-ep{display:block;font-size:1.2em;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        '.easy-ui-grid .online.easy-ui-tile .online__title{display:none}',
        '.easy-ui-grid .online .easy-ui-stop{top:.5em;bottom:auto;right:.5em}',

        /* Где остановились: метка на серии и строка на карточке */
        '.easy-ui-last{position:relative}',
        '.easy-ui-stop{position:absolute;right:.7em;bottom:.7em;padding:.2em .6em;border-radius:.3em;',
        'font-size:.85em;line-height:1.3;white-space:nowrap;background:#1473e6;color:#fff}',
        '.easy-ui-resume{margin-top:.8em;font-size:1.25em;color:#fff}',
        'body.easy-ui--card .easy-ui-resume+.full-start-new__buttons{margin-top:.5em}'
    ].join('');

    function applyBodyClasses() {
        $('body')
            .toggleClass('easy-ui--smooth', enabled(KEY.smooth))
            .toggleClass('easy-ui--noshots', enabled(KEY.shots))
            .toggleClass('easy-ui--nopriority', enabled(KEY.priority))
            .toggleClass('easy-ui--card', enabled(KEY.card));

        $('.easy-ui-poster').toggleClass('hide', !enabled(KEY.card)).toggleClass('selector', enabled(KEY.card));

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

    // Имя мода из подсказки кнопки («Z01», «by Skaz», «online_mod 25.10.2026» → без версии и даты).
    // Нужно, потому что сами кнопки у разных модов называются одинаково — «Онлайн»
    function sourceName(btn) {
        var raw = String(btn.attr('data-subtitle') || '').replace(/<[^>]*>/g, ' ');

        return $.trim(raw.split(/\s+/).filter(function (word) {
            return word && !/^v?[\d.,:-]+$/i.test(word);
        }).join(' '));
    }

    function legacyKey(btn) {
        var skip = ['focus', 'hover', 'selector', 'hide', 'full-start__button'];
        var classes = (btn.attr('class') || '').split(/\s+/).filter(function (name) {
            return name && skip.indexOf(name) < 0;
        }).sort().join('.');

        return classes + '|' + $.trim(btn.text());
    }

    // По чему узнаём источник в следующий раз: его классы, подпись и имя мода
    function buttonKey(btn) {
        return legacyKey(btn) + '|' + sourceName(btn);
    }

    // Запомненный источник; ключи старого вида (без имени мода) тоже понимаем
    function sameSource(btn, saved) {
        return !!saved && (buttonKey(btn) === saved || legacyKey(btn) === saved);
    }

    function sourceTitle(btn) {
        var text = $.trim(btn.text()) || 'Источник';
        var name = sourceName(btn);

        return name && name.toLowerCase().indexOf(text.toLowerCase()) < 0 ? text + ' (' + name + ')' : text;
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
            titles[key] = sourceTitle(item.btn);
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
            if (!remembered && sameSource(item.btn, last)) remembered = item;
        });

        if (!remembered && sources.length === 1) remembered = sources[0];

        if (remembered && !force) {
            startChain(sources, remembered);
            select(remembered);
            return null;
        }

        if (remembered) {
            var mark = 'открывается по кнопке «Смотреть»';
            var had = String(remembered.subtitle || '');

            if (had.indexOf(mark) < 0) remembered.subtitle = had ? $.trim(had) + ' · ' + mark : 'Открывается по кнопке «Смотреть»';
        }

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

    var POSTER_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="2.5" width="14" height="19" rx="2.5" stroke="currentColor" stroke-width="2"/><path d="M5 17l4.5-4.5 3.5 3.5 2-2 4 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="14.5" cy="8" r="1.8" fill="currentColor"/></svg>';

    function posterUrl(render) {
        var src = render.find('.full--poster').attr('src') || '';

        if (src) return src.replace(/\/w\d+\//, '/w780/');

        try {
            var card = Lampa.Activity.active().card;
            if (card && card.poster_path) return Lampa.TMDB.image('t/p/w780' + card.poster_path);
        } catch (e) {}

        return '';
    }

    function showPoster(render, button) {
        var url = posterUrl(render);

        if (!url) return Lampa.Noty.show('У этого фильма нет постера');

        var previous = Lampa.Controller.enabled().name;
        var small = render.find('.full--poster').attr('src') || '';
        var view = $('<div class="easy-ui-poster-view"><img><div class="selector"></div></div>');
        var img = view.find('img');

        // Большой не загрузился — показываем тот, что был
        img.on('error', function () {
            if (small && img.attr('src') !== small) img.attr('src', small);
        });
        img.attr('src', url);

        function close() {
            view.remove();
            Lampa.Controller.toggle(previous);

            // Фокус обратно на кнопку «Постер», а не туда, где Lampa была раньше
            try {
                if (button && document.body.contains(button[0])) Lampa.Controller.collectionFocus(button[0], render);
            } catch (e) {}
        }

        view.find('.selector').on('hover:enter', close);
        $('body').append(view);

        Lampa.Controller.add('easy_ui_poster', {
            toggle: function () {
                Lampa.Controller.collectionSet(view);
                Lampa.Controller.collectionFocus(view.find('.selector')[0], view);
            },
            back: close,
            up: function () {},
            down: function () {},
            left: function () {},
            right: function () {}
        });

        Lampa.Controller.toggle('easy_ui_poster');
    }

    function countSources(render) {
        return render.find('.buttons--container > .full-start__button').not('.hide').not('.view--trailer').length;
    }

    function setupFull(render, movie) {
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

        // Эмоции — сразу под названием. Другие плагины вставляют свои блоки после названия позже
        // (оригинальные названия), поэтому место проверяем ещё раз в refresh()
        function placeReactions() {
            if (!enabled(KEY.card)) return;

            var title = render.find('.full-start-new__title').first();
            var reactions = render.find('.full-start-new__reactions').first();

            if (title.length && reactions.length && title.next()[0] !== reactions[0]) title.after(reactions);
        }

        placeReactions();

        // Где остановились в прошлый раз
        render.data('easy-ui-movie', movie || null);
        resumeLine(render);

        // Маленький постер убран — смотреть его во весь экран по отдельной кнопке
        if (!row.find('.easy-ui-poster').length) {
            var poster = $('<div class="full-start__button selector easy-ui-poster">' + POSTER_ICON + '<span>Постер</span></div>');

            poster.on('hover:enter', function () { showPoster(render, poster); });
            poster.toggleClass('hide', !enabled(KEY.card)).toggleClass('selector', enabled(KEY.card));
            row.append(poster);
        }

        var shown = null;

        function refresh() {
            if (!document.body.contains(render[0])) return;

            // Класс hide убирает Shots из родного меню Lampa
            if (enabled(KEY.shots)) render.find('.buttons--container .shots-view-button').addClass('hide');

            placeReactions();

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
        if (!h.voices || typeof h.voices !== 'object') h.voices = {};   // фильм → озвучка, выбранная руками
        if (!h.foreign || typeof h.foreign !== 'object') h.foreign = {}; // фильм → когда русской озвучки не нашлось
        if (!(h.likes instanceof Array)) h.likes = [];                    // любимые озвучки, последние сверху
        if (!(h.order instanceof Array)) h.order = [];
        if (!h.tracks || typeof h.tracks !== 'object') h.tracks = {};   // сервер → озвучки и субтитры внутри видео

        return h;
    }

    // Фильм в конец очереди; самые старые забываем
    function touchMovie(h, movieKey) {
        h.order = h.order.filter(function (key) { return key !== movieKey; });
        h.order.push(movieKey);

        while (h.order.length > HISTORY_LIMIT) {
            var old = h.order.shift();
            delete h.movies[old];
            delete h.voices[old];
            delete h.foreign[old];
        }
    }

    function rememberFound(mod, movieKey, source, onlyForeign) {
        var h = loadHistory();
        var mark = onlyForeign ? Date.now() : 0;

        if (h.movies[movieKey] === source && !!h.foreign[movieKey] === !!mark) return;

        if (h.movies[movieKey] !== source) h.wins[mod + ':' + source] = (h.wins[mod + ':' + source] || 0) + 1;

        h.movies[movieKey] = source;

        if (mark) h.foreign[movieKey] = mark;
        else delete h.foreign[movieKey];

        touchMovie(h, movieKey);
        Lampa.Storage.set(HISTORY_KEY, h);
    }

    // Озвучку выбрали руками: для этого фильма больше не трогаем,
    // а русскую запоминаем как любимую — её автоподбор ставит первой
    function rememberVoice(movieKey, title) {
        var h = loadHistory();

        h.voices[movieKey] = title;

        if (!foreign(title)) {
            h.likes = [title].concat(h.likes.filter(function (t) { return t !== title; })).slice(0, 10);
        }

        touchMovie(h, movieKey);
        Lampa.Storage.set(HISTORY_KEY, h);
    }

    // Лучшая русская озвучка из списка или null
    function bestVoice(items, h) {
        var best = null;
        var bestRank = Infinity;

        items.forEach(function (item, index) {
            if (foreign(item.title)) return;

            var like = h.likes.indexOf(item.title);
            var rank = (like >= 0 ? like : 100) * 1000 + index;

            if (rank < bestRank) {
                bestRank = rank;
                best = item;
            }
        });

        return best;
    }

    /* ---------- Страница мода: шапка, автоподбор, озвучка ---------- */

    // Моды кладут балансеры в «sort», а сезон, озвучку и качество — в «filter»
    // стандартного Lampa.Filter. Через него плагин работает с любым модом.

    var attempts = {}; // movieKey → { touched, names, manual, finished, found }
    var pages = [];    // открытые страницы модов — для озвучки в плеере

    // Каждый заход на страницу мода начинается заново
    function freshAttempts(movieKey) {
        // names — не нашли фильм или только субтитры; subs — только субтитры
        var record = { touched: Date.now(), names: [], subs: [], manual: false, finished: false, found: false };

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
                var label = kind === 'season' ? 'Сезон' : kind === 'voice' ? 'Озвучка' : /качеств/i.test(group.title) ? 'Качество' : short(group.title, 18);
                var elem = chip(key, label, function () { openGroup(key); });

                elem.data('group', group);
                elem.find('div').text(short(groupValue(group), 22));
                (lists[kind] || lists.other).push(key);
            });

            // Порядок: сезон, озвучка, источник, остальное (качество)
            var inside = lists.voice.length ? null : tracksNow();

            if (inside) {
                chip('tracks', 'Озвучка', openTracks).find('div').text('в плеере · ' + inside.a.length);
                lists.voice.push('tracks');
            }

            var wanted = lists.season.concat(lists.voice, ['source'], lists.other);

            chip('source', 'Сервер', openSource).find('div').text(short(sourceLabel(), 26));

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
                    if (groupKind(group) === 'voice') {
                        attemptsFor(movieKey).voiceManual = true;
                        rememberVoice(movieKey, picked.item.title);
                    }

                    applyGroup(group, picked.item);
                    closeMenuIfOpen();
                    refreshHead();
                }
            });
        }

        // Озвучки и субтитры внутри видео у сервера, который сейчас включён
        function tracksOf(item) {
            var known = enabled(KEY.tracks) && item ? loadHistory().tracks[mod + ':' + item.source] : null;

            return known && known.a && known.a.length > 1 ? known : null;
        }

        function tracksNow() {
            var list = sources();

            return list ? tracksOf(selectedOf(list)) : null;
        }

        // Список только для сведения: переключают их в самом плеере
        function openTracks() {
            var inside = tracksNow();

            if (!inside) return;

            var menu = [{ title: 'Переключаются в плеере, в меню звука', separator: true }];

            inside.a.forEach(function (name) { menu.push({ title: name }); });

            if (inside.s && inside.s.length) {
                menu.push({ title: 'Субтитры', separator: true });
                inside.s.forEach(function (name) { menu.push({ title: name }); });
            }

            Lampa.Select.show({
                title: 'Озвучки внутри видео',
                items: menu,
                onBack: back,
                onSelect: function () {
                    closeMenuIfOpen();
                    back();
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
                // Серверы, у которых все озвучки внутри видео, — выше
                if (!!tracksOf(a) !== !!tracksOf(b)) return tracksOf(a) ? -1 : 1;
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
                else if (record.subs.indexOf(item.source) >= 0) note = 'Только оригинал или субтитры';
                else if (record.names.indexOf(item.source) >= 0) note = 'Не нашёл этот фильм';
                else if (item.source === known) note = 'Уже находил этот фильм';
                else if (isManaged) note = 'Доступен';

                var inside = item.ghost ? null : tracksOf(item);

                if (inside) note = (note ? note + ' · ' : '') + 'озвучек в плеере: ' + inside.a.length + (inside.s && inside.s.length ? ', есть субтитры' : '');

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
                title: 'Сервер',
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
            updateGrid();
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

        // Следующий сервер после неудачного: сначала те, что находили этот фильм или находят чаще
        function tryNext(list, current, record, reason) {
            var h = loadHistory();
            var known = h.movies[movieKey];

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

            if (next) {
                Lampa.Noty.show(current.title + ': ' + reason + '. Пробую ' + next.title);
                watched = next.source;
                since = Date.now();
                switchTo(list, next);
                return;
            }

            // Русской озвучки нет ни у кого — возвращаемся к первому, где есть хотя бы субтитры
            if (record.subs.length) {
                var fallback = null;

                list.forEach(function (item) {
                    if (!fallback && item.source === record.subs[0]) fallback = item;
                });

                if (fallback) {
                    record.acceptForeign = true;
                    Lampa.Noty.show('Русской озвучки нет ни на одном сервере. Включил ' + fallback.title + ' — оригинал или субтитры');

                    if (fallback !== current) {
                        watched = fallback.source;
                        since = Date.now();
                        switchTo(list, fallback);
                    }

                    return;
                }
            }

            giveUp(record);
        }

        // Строки, которые видит человек: для фильма это часто варианты озвучки
        function rowTitles() {
            return rows().map(function () { return rowText($(this)); }).get();
        }

        // Есть ли тут русская озвучка. Возвращает true, если что-то переключили
        function russianStep(list, current, record) {
            if (!enabled(KEY.russian) || record.acceptForeign || record.voiceManual) return false;

            var h = loadHistory();

            // Для этого фильма человек сам выбрал оригинал — не спорим
            if (h.voices[movieKey] && foreign(h.voices[movieKey])) return false;

            var group = api.voiceGroup();
            var onlyForeign;

            if (group) {
                if (!foreign(groupValue(group))) return false;

                var best = bestVoice(group.items, h);

                if (best) {
                    if (record.voiceTried === best.title) return false;

                    record.voiceTried = best.title;
                    Lampa.Noty.show('Включил русскую озвучку: ' + best.title);
                    api.applyVoice(best.title, false);

                    return true;
                }

                onlyForeign = true;
            } else {
                var titles = rowTitles();

                onlyForeign = titles.length > 0 && titles.every(foreign);

                // Фильм: строки — это озвучки. Ставим фокус на первую русскую
                if (!onlyForeign && !record.rowFocused && titles.length > 1 && foreign(titles[0])) {
                    record.rowFocused = true;

                    for (var i = 0; i < titles.length; i++) {
                        if (!foreign(titles[i])) {
                            focusRow(rows().eq(i));
                            break;
                        }
                    }
                }
            }

            if (!onlyForeign || !current) return false;

            if (record.subs.indexOf(current.source) < 0) record.subs.push(current.source);

            // Недавно уже проверяли все серверы — не перебираем заново
            var checked = h.foreign[movieKey] && Date.now() - h.foreign[movieKey] < FOREIGN_RECHECK && h.movies[movieKey] === current.source;

            if (checked || record.manual || managed(list) || !enabled(KEY.auto)) {
                record.acceptForeign = true;

                if (!checked) Lampa.Noty.show('У ' + current.title + ' только оригинал или субтитры. Сменить — кнопка «Сервер» вверху');

                return false;
            }

            tryNext(list, current, record, 'только оригинал или субтитры');

            return true;
        }

        function focusRow(row) {
            if (!row || !row.length) return;

            try {
                if (Lampa.Controller.enabled().name === 'content') Lampa.Controller.collectionFocus(row[0], page()[0]);
            } catch (e) {}
        }

        // Серия, на которой остановились: метка и фокус. Повторяем, когда мод перестроил список
        var resumeFirst = null;
        var resumeCount = 0;

        function markResume() {
            if (!enabled(KEY.resume) || !movie.id || api.isMovie()) return;

            var list = rows();

            if (!list.length || (list[0] === resumeFirst && list.length === resumeCount)) return;

            resumeFirst = list[0];
            resumeCount = list.length;
            page().find('.easy-ui-stop').remove();
            page().find('.easy-ui-last').removeClass('easy-ui-last');

            var last = progress().last[cardKey(movie)];
            if (!last) return;

            var row = list.filter(function () {
                return $(this).find('.time-line[data-hash="' + last.hash + '"]').length > 0;
            }).first();

            if (!row.length) return;

            var spot = spotOf(last.hash);
            var done = spot.p >= DONE_PERCENT;

            row.addClass('easy-ui-last');
            $('<div class="easy-ui-stop"></div>').text(!done && spot.t > 0 ? 'Остановились на ' + clock(spot.t) : 'Смотрели последней').appendTo(row);

            // Досмотренная серия — фокус на следующую
            var next = done ? list.eq(list.index(row) + 1) : $();

            focusRow(next.length ? next : row);
        }

        function updateGrid() {
            var p = page();

            if (!p.length) return;

            var on = enabled(KEY.grid) && !api.isMovie();

            p.toggleClass('easy-ui-grid', on);

            if (on) dressTiles(p);
        }

        // Сезон и серия плитки: из подписи мода («Сезон 2 / Серия 5», «S2 / Серия 5»), сезон — ещё и по хэшу
        function tileEpisode(row) {
            var title = $.trim(row.find('.online__title').first().text());
            var s = +((title.match(/сезон\s*(\d+)/i) || title.match(/(\d+)\s*сезон/i) || title.match(/\bS(\d+)\b/) || [])[1] || 0);
            var e = +((title.match(/серия\s*(\d+)/i) || title.match(/(\d+)\s*серия/i) || title.match(/\bE(\d+)\b/) || [])[1] || 0);
            var hash = row.find('.time-line[data-hash]').attr('data-hash');

            if (!e) return null;

            if (!s && hash) {
                [movie.original_title, movie.original_name].forEach(function (name) {
                    for (var i = 1; name && !s && i <= 50; i++) {
                        if (String(Lampa.Utils.hash([i, i > 10 ? ':' : '', e, name].join(''))) === hash) s = i;
                    }
                });
            }

            return { s: s || 1, e: e };
        }

        function dressTiles(p) {
            p.find('.explorer__files .online.selector').not('.easy-ui-tile').each(function () {
                var row = $(this);
                var ep = tileEpisode(row);

                if (!ep) return;

                var thumb = $('<div class="easy-ui-thumb easy-ui-thumb--empty"><div class="easy-ui-thumb__num"></div></div>');

                thumb.attr('data-num', ep.e).find('.easy-ui-thumb__num').text(ep.e);
                row.addClass('easy-ui-tile').prepend(thumb);
                row.find('.online__title').first().before($('<div class="easy-ui-ep"></div>').text('Серия ' + ep.e));

                seasonInfo(movie, ep.s, function (episodes) {
                    var info = episodes[ep.e];

                    if (!info) return;
                    if (info.name) row.find('.easy-ui-ep').text(ep.e + '. ' + info.name);
                    if (info.still) {
                        var img = new Image();

                        img.onload = function () {
                            thumb.removeClass('easy-ui-thumb--empty').css('background-image', 'url("' + info.still + '")');
                        };
                        img.src = info.still;
                    }
                });
            });
        }

        function check() {
            var state = pageState();

            if (state === 'gone') {
                clearInterval(timer);
                pages = pages.filter(function (p) { return p !== api; });
                return;
            }

            updateGrid();

            var list = sources();
            if (!list) return;

            var current = selectedOf(list);
            var record = attemptsFor(movieKey);

            record.touched = Date.now();
            refreshSourceChip();

            if (state === 'found') {
                if (record.found) {
                    markResume();
                    return;
                }

                // Нашёл, но без русской озвучки — переключаем озвучку или сервер
                if (current && current.source !== watched) {
                    watched = current.source;
                    since = Date.now();
                }

                if (Date.now() - since < AUTO_SETTLE && !record.manual) return;
                if (russianStep(list, current, record)) return;

                if (current) {
                    record.found = true;
                    rememberFound(mod, movieKey, current.source, record.acceptForeign && record.subs.indexOf(current.source) >= 0);
                }

                record.finished = true;
                markResume();
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

            // Сервер ничего не нашёл или завис — пробуем следующий
            tryNext(list, current, record, 'не найдено');
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
            mod: mod,
            refreshHead: refreshHead,
            currentSource: function () {
                var list = sources();

                return list ? selectedOf(list) : null;
            },
            // Место просмотра изменилось — обновить метку на серии
            remark: function () {
                resumeFirst = null;
            },
            // Кнопки шапки, которые сейчас видны
            chips: function () {
                var list = [];

                order.forEach(function (key) {
                    var elem = chips[key];
                    if (elem && !elem.hasClass('hide') && elem.parent().length) list.push(elem[0]);
                });

                return list;
            },
            voiceGroup: function () {
                var found = null;

                groups().forEach(function (group) {
                    if (!found && groupKind(group) === 'voice') found = group;
                });

                return found;
            },
            // manual = false — переключил сам плагин (автоподбор русской озвучки)
            applyVoice: function (title, manual) {
                var group = api.voiceGroup();
                var item = null;

                if (!group) return false;

                group.items.forEach(function (it) {
                    if (!item && it.title === title) item = it;
                });

                if (!item) return false;

                if (manual !== false) {
                    attemptsFor(movieKey).voiceManual = true;
                    rememberVoice(movieKey, title);
                }

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
        Lampa.Player.close();
        replayInVoice(p, title, previous, p.lastRow, 300);
    }

    // Переключить озвучку в моде и снова включить ту же серию (wanted — запомненная строка)
    function replayInVoice(p, title, previous, wanted, delay) {
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
        }, delay);
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

        watchNativeReturn();
    }

    // Системный плеер Apple TV (через LUXO) меню звука Lampa не показывает. Поэтому при
    // выходе из него сразу предлагаем озвучки мода: выбор включает ту же серию в другой
    // озвучке, место просмотра восстанавливается. «Назад» или «Продолжить в …» — закрыть.
    var nativeRun = null;      // { p, wanted, u, hidden }
    var NATIVE_MIN_WATCH = 15000; // меньше — случайное открытие, меню не показываем

    function watchNativeReturn() {
        Lampa.Player.listener.follow('create', function (e) {
            nativeRun = null;

            var data = e && e.data;

            if (!enabled(KEY.voice) || !data || data.iptv || data.torrent_hash || !nativePlayer()) return;

            var p = activePage();
            if (!p) return;

            var group = p.voiceGroup();
            if (!group || group.items.length < 2) return;

            // Строку серии ловит trackRows на том же нажатии; берём её чуть позже
            nativeRun = { p: p, u: Date.now(), hidden: false, wanted: null };
            setTimeout(function () { if (nativeRun && nativeRun.p === p) nativeRun.wanted = p.lastRow; }, 0);
        });

        document.addEventListener('visibilitychange', function () {
            if (!nativeRun) return;

            if (document.visibilityState === 'hidden') {
                nativeRun.hidden = true;
                return;
            }

            var run = nativeRun;

            if (!run.hidden) return;

            nativeRun = null;

            if (Date.now() - run.u < NATIVE_MIN_WATCH) return;

            // Дать Lampa проснуться и вернуть фокус, потом показать меню
            setTimeout(function () {
                try { offerVoices(run); } catch (err) {}
            }, 600);
        });
    }

    function offerVoices(run) {
        var p = run.p;

        if (!p.page().length || !$.contains(document.body, p.page()[0]) || activePage() !== p) return;

        var group = p.voiceGroup();
        if (!group || group.items.length < 2) return;

        var current = groupValue(group);
        var wanted = run.wanted || p.lastRow;
        var items = [{ title: 'Продолжить в «' + short(current, 30) + '»', easyKeep: true, selected: true }];

        group.items.forEach(function (item) {
            if (item.title !== current) items.push({ title: item.title, easyVoice: item.title });
        });

        var back = Lampa.Controller.enabled().name;

        Lampa.Select.show({
            title: 'Сменить озвучку?',
            items: items,
            onBack: function () {
                Lampa.Controller.toggle(back);
            },
            onSelect: function (item) {
                closeMenuIfOpen();
                Lampa.Controller.toggle(back);

                if (item.easyVoice && wanted) replayInVoice(p, item.easyVoice, current, wanted, 200);
                else if (item.easyVoice) p.applyVoice(item.easyVoice);
            }
        });
    }

    /* ---------- Место просмотра и последняя серия ---------- */

    // Online Mod отдаёт системному плееру Apple TV только адрес видео. Плеер не знает,
    // что это за серия, поэтому не продолжает с места остановки и не сохраняет его.
    // Плагин дописывает к запуску то, что мод уже подготовил: название, место просмотра
    // и субтитры. И ведёт свою запись: последняя серия каждого сериала и минута.

    var PROGRESS_KEY = 'easy_ui_progress';
    var PROGRESS_LIMIT = 600; // сколько серий и фильмов помнить
    var LAST_LIMIT = 200;     // сколько сериалов помнить
    var DONE_PERCENT = 90;    // с какого процента серия считается досмотренной
    var NATIVE_PLAYERS = ['tvos', 'tvospro', 'tvosl', 'tvosSelect'];

    var progressData = null;
    var progressTimer = null;

    // {items: хэш → {t, d, p, u}, order: хэши по давности, last: карточка → {hash, s, e, u}}
    function progress() {
        if (progressData) return progressData;

        var p = Lampa.Storage.get(PROGRESS_KEY, '{}');

        if (typeof p === 'string') {
            try { p = JSON.parse(p); } catch (e) { p = {}; }
        }

        if (!p || typeof p !== 'object') p = {};
        if (!p.items || typeof p.items !== 'object') p.items = {};
        if (!p.last || typeof p.last !== 'object') p.last = {};
        if (!(p.order instanceof Array)) p.order = [];

        progressData = p;

        return p;
    }

    // Записи приходят пачками (синхронизация) — пишем в хранилище не чаще раза в секунду
    function saveProgressSoon() {
        if (progressTimer) return;

        progressTimer = setTimeout(function () {
            progressTimer = null;

            var p = progress();

            while (p.order.length > PROGRESS_LIMIT) delete p.items[p.order.shift()];

            var cards = Object.keys(p.last);

            if (cards.length > LAST_LIMIT) {
                cards.sort(function (a, b) { return (p.last[a].u || 0) - (p.last[b].u || 0); });
                cards.slice(0, cards.length - LAST_LIMIT).forEach(function (key) { delete p.last[key]; });
            }

            Lampa.Storage.set(PROGRESS_KEY, p);
        }, 1000);
    }

    function clock(sec) {
        sec = Math.max(0, Math.round(sec || 0));

        var h = Math.floor(sec / 3600);
        var m = Math.floor(sec % 3600 / 60);
        var s = sec % 60;

        return (h ? h + ':' + (m < 10 ? '0' : '') : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function cardKey(movie) {
        return (movie.name || movie.original_name || movie.number_of_seasons ? 'tv' : 'movie') + ':' + movie.id;
    }

    function saveSpot(hash, time, duration, percent) {
        hash = String(hash || '');
        time = Math.round(time || 0);
        duration = Math.round(duration || 0);
        percent = Math.round(percent || 0);

        if (!hash || hash === '0') return;

        var p = progress();

        // Пустую запись о том, чего не смотрели, не храним
        if (!time && !percent && !p.items[hash]) return;
        if (!percent && duration) percent = Math.round(time / duration * 100);

        p.items[hash] = { t: time, d: duration, p: percent, u: Date.now() };
        p.order = p.order.filter(function (key) { return key !== hash; });
        p.order.push(hash);

        saveProgressSoon();
    }

    // Место просмотра: запись Lampa, а если в ней пусто или она старее — своя
    function spotOf(hash) {
        var own = progress().items[String(hash)];
        var view = null;

        try { view = Lampa.Timeline.view(hash); } catch (e) {}

        var spot = { t: 0, d: 0, p: 0 };

        if (view) {
            spot.t = Math.round(view.time || 0);
            spot.d = Math.round(view.duration || 0);
            spot.p = Math.round(view.percent || 0);
        }

        if (own && own.t && (!spot.t || own.u > (view && view.updated ? view.updated : 0))) {
            spot.t = own.t;
            spot.d = own.d || spot.d;
            spot.p = own.p || spot.p;
        }

        if (!spot.p && spot.d) spot.p = Math.round(spot.t / spot.d * 100);

        return spot;
    }

    // Кадры и названия серий из TMDB: один запрос на сезон, ответ хранится в памяти
    var seasonCache = {};

    function tmdbId(movie) {
        if (!movie || !movie.name) return 0;
        if (['cub', 'tmdb'].indexOf(movie.source || 'tmdb') < 0) return +movie.tmdb_id || 0;

        return +movie.id || 0;
    }

    function stillUrl(path) {
        if (!path) return '';

        try { return Lampa.TMDB.image('t/p/w300' + path); } catch (e) {}
        try { return Lampa.Api.img(path, 'w300'); } catch (e) {}

        return '';
    }

    function seasonInfo(movie, season, call) {
        var id = tmdbId(movie);

        if (!id || !season) return;

        var key = id + ':' + season;
        var entry = seasonCache[key];

        if (!entry) {
            entry = seasonCache[key] = { ready: false, map: {}, calls: [] };

            var finish = function (data) {
                (data && data.episodes || []).forEach(function (item) {
                    entry.map[item.episode_number] = { name: $.trim(item.name || ''), still: stillUrl(item.still_path) };
                });
                entry.ready = true;
                entry.calls.forEach(function (fn) { try { fn(entry.map); } catch (e) {} });
                entry.calls = [];
            };

            try {
                Lampa.Api.sources.tmdb.get('tv/' + id + '/season/' + season, {}, finish, function () { finish(null); });
            } catch (e) {
                finish(null);
            }
        }

        if (entry.ready) call(entry.map);
        else entry.calls.push(call);
    }

    // Сезон и серия по хэшу: моды считают его как Lampa — сезон, серия, оригинальное название
    function episodeOf(movie, hash) {
        var names = [];

        [movie.original_title, movie.original_name].forEach(function (name) {
            if (name && names.indexOf(name) < 0) names.push(name);
        });

        for (var n = 0; n < names.length; n++) {
            for (var s = 1; s <= 50; s++) {
                for (var e = 1; e <= 400; e++) {
                    if (String(Lampa.Utils.hash([s, s > 10 ? ':' : '', e, names[n]].join(''))) === hash) return { s: s, e: e };
                }
            }
        }

        return null;
    }

    function remarkPages() {
        pages.forEach(function (p) { p.remark(); });
    }

    // Запомнить, что запустили: последняя серия сериала
    function noteLaunch(data) {
        if (!data || data.iptv || !data.timeline || !data.timeline.hash) return;

        var p = activePage();
        var movie = p ? p.movie : null;

        if (!movie || !movie.id) return;

        var hash = String(data.timeline.hash);
        var store = progress();
        var key = cardKey(movie);
        var old = store.last[key];
        var ep = old && old.hash === hash ? old : (p.isMovie() ? null : episodeOf(movie, hash));

        store.last[key] = { hash: hash, s: ep ? ep.s : 0, e: ep ? ep.e : 0, u: Date.now() };

        saveProgressSoon();
        remarkPages();
    }

    function nativePlayer() {
        try {
            return Lampa.Platform.is('apple_tv') && NATIVE_PLAYERS.indexOf(Lampa.Storage.field('player')) >= 0;
        } catch (e) {
            return false;
        }
    }

    var handed = null; // наша добавка к запуску — убираем после него

    // Системному плееру Apple TV: название, место просмотра и субтитры текущего видео
    function handoff(data) {
        if (!data || data.iptv || data.torrent_hash || !data.url || !nativePlayer()) return;
        if (data.playlist && data.playlist.length) return; // мод всё передал сам

        // Трейлерам и прочему без места просмотра и субтитров передавать нечего
        if (!(data.timeline && data.timeline.hash) && !(data.subtitles && data.subtitles.length)) return;

        var cell = { title: data.title, url: data.url, timeline: data.timeline, subtitles: data.subtitles };

        // Адрес видео Lampa ещё может заменить под выбранное качество — собираем в момент запуска
        cell.toJSON = function () {
            var out = { title: $.trim(String(data.title || '').replace(/<[^>]*>/g, ' ')), url: data.url };
            var timeline = data.timeline;

            if (timeline && timeline.hash) {
                var spot = spotOf(timeline.hash);

                out.timeline = { hash: timeline.hash, percent: spot.p, time: spot.t, duration: spot.d, profile: timeline.profile };
            }

            if (data.subtitles && data.subtitles.length) out.subtitles = data.subtitles;

            return out;
        };

        data.playlist = [cell];
        handed = { data: data, cell: cell };
    }

    function takeBack() {
        if (handed && handed.data.playlist && handed.data.playlist[0] === handed.cell) delete handed.data.playlist;

        handed = null;
    }

    // LUXO пишет место просмотра под своим ключом, а не под ключом серии, и отметки Lampa не обновляются.
    // Первый чужой ключ после запуска — это запущенная серия: копируем её место на ключ серии.
    var LUXO_ALIAS_TTL = 12 * 3600 * 1000;
    var luxoLaunch = null;

    function noteLuxoLaunch(data) {
        luxoLaunch = null;

        if (!data || data.iptv || !data.timeline || !data.timeline.hash || !nativePlayer()) return;

        luxoLaunch = { hash: String(data.timeline.hash), profile: data.timeline.profile, u: Date.now(), alias: '' };
    }

    function luxoUpdate(info) {
        if (typeof info === 'string') info = JSON.parse(info);
        if (!info || !luxoLaunch || Date.now() - luxoLaunch.u > LUXO_ALIAS_TTL) return;

        var hash = String(info.hash || '');

        if (!hash || hash === luxoLaunch.hash || !(info.time > 0)) return;

        // Первый чужой ключ после запуска — запущенная серия. Другой ключ — в плеере перешли
        // на другую серию списка; какую, не известно, поэтому её не трогаем.
        if (!luxoLaunch.alias) luxoLaunch.alias = hash;
        if (hash !== luxoLaunch.alias) return;

        var params = { hash: luxoLaunch.hash, time: info.time, duration: info.duration, percent: info.percent };

        if (!params.percent && info.duration) params.percent = Math.round(info.time / info.duration * 100);
        if (typeof luxoLaunch.profile !== 'undefined') params.profile = luxoLaunch.profile;

        Lampa.Timeline.update(params);
    }

    function hookLuxo() {
        var bridge = window.LuxoBridge;

        if (!bridge || typeof bridge.applyTimelineUpdate !== 'function' || bridge.applyTimelineUpdate.easyUi) return !!bridge;

        var orig = bridge.applyTimelineUpdate;
        var wrap = function (info) {
            var result = orig.apply(this, arguments);

            try { luxoUpdate(info); } catch (e) {}

            return result;
        };

        wrap.easyUi = true;
        bridge.applyTimelineUpdate = wrap;

        return true;
    }

    // Строка на карточке: где остановились в прошлый раз
    function resumeLine(render) {
        var movie = render.data('easy-ui-movie');
        var play = render.find('.full-start-new__buttons .button--play span').first();

        render.find('.easy-ui-resume').remove();

        if (play.data('easy-ui-text')) play.text(play.data('easy-ui-text'));
        if (!enabled(KEY.resume) || !movie || !movie.id) return;

        var last = progress().last[cardKey(movie)];
        if (!last) return;

        var spot = spotOf(last.hash);
        var done = spot.p >= DONE_PERCENT;
        var where = last.s && last.e ? 'сезон ' + last.s + ', серия ' + last.e : '';
        var time = !done && spot.t > 0 ? clock(spot.t) + (spot.d ? ' из ' + clock(spot.d) : '') : '';
        var text = '';

        if (where) text = (done ? 'Последняя просмотренная: ' : 'Остановились: ') + where + (time ? ' · ' + time : '');
        else if (time) text = 'Остановились на ' + time;

        if (!text) return;

        $('<div class="easy-ui-resume"></div>').text(text).insertBefore(render.find('.full-start-new__buttons').first());

        if (play.length) {
            if (!play.data('easy-ui-text')) play.data('easy-ui-text', play.text());
            play.text('Продолжить');
        }
    }

    function watchProgress() {
        // Всё, что записали Lampa, плеер или синхронизация, — в свою запись
        Lampa.Timeline.listener.follow('update', function (e) {
            var data = e && e.data;

            if (!data || !data.road) return;

            saveSpot(data.hash, data.road.time, data.road.duration, data.road.percent);
            remarkPages();
        });

        Lampa.Player.listener.follow('create', function (e) {
            if (!enabled(KEY.resume) || !e || !e.data) return;

            try { noteLaunch(e.data); } catch (err) {}
            try { noteLuxoLaunch(e.data); } catch (err) {}
            try { handoff(e.data); } catch (err) {}
            try { hookLuxo(); } catch (err) {}
        });

        try { hookLuxo(); } catch (err) {}

        // Ссылка для системного плеера к этому моменту уже собрана
        Lampa.Player.listener.follow('external', takeBack);
        Lampa.Player.listener.follow('start', takeBack);

        // Вернулись на карточку из мода — обновить строку «Остановились»
        Lampa.Listener.follow('activity', function (e) {
            if (e.type !== 'start' || e.component !== 'full') return;

            try { resumeLine(e.object.activity.render()); } catch (err) {}
        });
    }

    /* ---------- Озвучки внутри видео ---------- */

    // Плеер Apple показывает только те дорожки, что есть в самом видео, добавить их снаружи нельзя.
    // Но у части серверов видео идёт сразу со всеми озвучками и субтитрами (один плейлист HLS
    // с несколькими дорожками). Плагин после запуска читает этот плейлист, запоминает сервер
    // и показывает это в шапке и в списке серверов. Само видео и его адрес не меняются.

    var PROBE_DELAY = 2500; // плеер забирает плейлист первым
    var probeJob = null;

    function parseTracks(text) {
        var audio = [];
        var subs = [];

        String(text || '').split(/\r?\n/).forEach(function (line) {
            if (line.indexOf('#EXT-X-MEDIA') !== 0) return;

            var list = /TYPE=AUDIO/.test(line) ? audio : /TYPE=SUBTITLES/.test(line) ? subs : null;
            var name = (line.match(/NAME="([^"]*)"/) || [])[1] || (line.match(/LANGUAGE="([^"]*)"/) || [])[1] || '';

            name = $.trim(name.replace(/^\d+\.\s*/, ''));

            if (list && name && list.indexOf(name) < 0 && list.length < 12) list.push(name);
        });

        return { a: audio, s: subs };
    }

    function planProbe(data) {
        probeJob = null;

        if (!enabled(KEY.tracks) || !data || data.iptv || data.torrent_hash || data.headers || typeof data.url !== 'string') return;

        var p = activePage();
        var source = p ? p.currentSource() : null;

        if (source) probeJob = { data: data, key: p.mod + ':' + source.source, page: p };
    }

    function runProbe() {
        var job = probeJob;

        probeJob = null;

        if (!job) return;

        setTimeout(function () {
            var url = String(job.data.url || '');

            if (!/^https?:\/\//i.test(url) || !/\.m3u8$/i.test(url.split(/[?#]/)[0])) return;
            if (location.protocol === 'https:' && /^http:/i.test(url)) return;

            var xhr = new XMLHttpRequest();

            xhr.open('GET', url, true);
            xhr.timeout = 10000;
            xhr.onload = function () {
                if (xhr.status < 200 || xhr.status >= 300) return;

                var found = parseTracks(xhr.responseText);
                var h = loadHistory();

                h.tracks[job.key] = { a: found.a, s: found.s, u: Date.now() };
                Lampa.Storage.set(HISTORY_KEY, h);

                try { job.page.refreshHead(); } catch (e) {}
            };

            try { xhr.send(); } catch (e) {}
        }, PROBE_DELAY);
    }

    function watchTracks() {
        Lampa.Player.listener.follow('create', function (e) {
            try { planProbe(e && e.data); } catch (err) {}
        });

        Lampa.Player.listener.follow('external', runProbe);
        Lampa.Player.listener.follow('start', runProbe);
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

    // «Назад» в списке серий сначала поднимает фокус в шапку, второе «Назад» — выход.
    // Так до сезона и озвучки один шаг, сколько бы серий ни было
    function backToHead() {
        if (!enabled(KEY.head)) return false;

        var p = activePage();
        if (!p) return false;

        var list = p.chips();
        if (!list.length) return false;

        var focused = p.page().find('.selector.focus')[0];
        if (!focused || list.indexOf(focused) >= 0) return false;

        // Фокус уже в шапке или на родных кнопках над списком
        if ($(focused).closest('.torrent-filter').length) return false;

        try {
            Lampa.Controller.collectionFocus(list[0], p.page()[0]);
            return true;
        } catch (e) {
            return false;
        }
    }

    function wrapController() {
        var base = Lampa.Controller.add;

        Lampa.Controller.add = function (name, obj) {
            if (name === 'content' && obj && typeof obj.back === 'function' && !obj.easy_ui_back) {
                var back = obj.back;

                obj.back = function () {
                    if (backToHead()) return;
                    return back.apply(this, arguments);
                };
                obj.easy_ui_back = true;
            }

            return base.apply(this, arguments);
        };
    }

    /* ---------- «Сервер» вместо «балансер» ---------- */

    // Слово «балансер» в интерфейсе модов меняем на понятное «сервер»: склоняется так же,
    // поэтому фразы модов («Сменить балансер», «балансеры не ответили») остаются грамотными
    var BALANCER = /([Бб])алансер(ами|ах|ам|ов|ом|ы|а|у|е)?/g;

    function balancerWord(match, first, ending) {
        return (first === 'Б' ? 'С' : 'с') + 'ервер' + (ending || '');
    }

    function renameIn(root) {
        if (!root || root.nodeType !== 1 && root.nodeType !== 3) return;

        if (root.nodeType === 3) {
            if (root.nodeValue.indexOf('алансер') >= 0) root.nodeValue = root.nodeValue.replace(BALANCER, balancerWord);
            return;
        }

        if ((root.textContent || '').indexOf('алансер') < 0) return;
        if (root.tagName === 'SCRIPT' || root.tagName === 'STYLE' || root.tagName === 'INPUT' || root.tagName === 'TEXTAREA') return;

        var walker = document.createTreeWalker(root, 4, null, false);
        var node;

        while ((node = walker.nextNode())) {
            if (node.nodeValue.indexOf('алансер') >= 0) node.nodeValue = node.nodeValue.replace(BALANCER, balancerWord);
        }
    }

    function watchWords() {
        if (typeof MutationObserver === 'undefined') return;

        new MutationObserver(function (records) {
            records.forEach(function (r) {
                if (r.type === 'characterData') renameIn(r.target);
                else for (var i = 0; i < r.addedNodes.length; i++) renameIn(r.addedNodes[i]);
            });
        }).observe(document.body, { childList: true, subtree: true, characterData: true });
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
            [KEY.head, 'Шапка: сезон, озвучка, сервер', 'Видимые кнопки с текущим значением. «Назад» в списке серий — сразу к шапке'],
            [KEY.auto, 'Автоподбор сервера', 'Пустой или зависший сервер — сам переключает на следующий, начиная с проверенных'],
            [KEY.russian, 'Сначала русская озвучка', 'Если включились субтитры или оригинал — ищет русскую озвучку, а затем другой сервер'],
            [KEY.grid, 'Серии плиткой', 'Серии по четыре в ряд: кадр из серии, номер и название вместо длинного списка'],
            [KEY.chain, 'Цепочка модов', 'Если мод не нашёл фильм ни на одном сервере — открывает следующий мод'],
            [KEY.voice, 'Озвучка в плеере', 'Смена озвучки через кнопку звука во время просмотра; в плеере Apple TV — меню при выходе из него'],
            [KEY.tracks, 'Озвучки внутри видео', 'Запоминает серверы, у которых все озвучки и субтитры переключаются прямо в плеере, и показывает это в шапке и в списке серверов'],
            [KEY.resume, 'Место просмотра и последняя серия', 'Помнит серию и минуту, показывает их на карточке и в списке серий; передаёт место и субтитры плееру Apple TV'],
            [KEY.card, 'Новая карточка фильма', 'Всё внизу поверх фона, большая «Смотреть», эмоции под названием, постер — отдельной кнопкой'],
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
        safe('«Назад» к шапке', wrapController);
        safe('названия', watchWords);
        safe('плеер', watchPlayer);
        safe('место просмотра', watchProgress);
        safe('озвучки в видео', watchTracks);
        safe('серии', trackRows);
        safe('настройки', addSettings);
        safe('внешний вид', applyBodyClasses);
        safe('Shots', watchShots);

        safe('карточка', function () {
            Lampa.Listener.follow('full', function (e) {
                if (e.type !== 'complite') return;
                try { setupFull(e.object.activity.render(), (e.data && e.data.movie) || e.object.card); } catch (err) {}
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
