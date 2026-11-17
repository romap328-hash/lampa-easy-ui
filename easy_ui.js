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

    var VERSION = '0.9.3';
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
        anchor: 'easy_ui_anchor',
        home: 'easy_ui_home',
        look: 'easy_ui_look',
        large: 'easy_ui_large',
        dim: 'easy_ui_dim',
        sound: 'easy_ui_sound',
        quiet: 'easy_ui_quiet',
        voices: 'easy_ui_all_voices'
    };

    // Всё включено, кроме перечисленного здесь
    var OFF_BY_DEFAULT = [KEY.priority, KEY.large, KEY.dim, KEY.sound, KEY.quiet];

    // «Прилипание» фокуса, мс
    var BURST_GAP = 110;   // события чаще этого — один жест (свайп по сенсору или удержание кнопки)
    var HOLD_DELAY = 360;  // сколько длится жест, прежде чем фокус пойдёт дальше сам
    var HOLD_REPEAT = 150; // шаг при долгом свайпе или удержании
    var HOLD_DELAY_MENU = 520;  // в меню выбора (сервер, озвучка, сезон) — спокойнее, чтобы не проскакивать
    var HOLD_REPEAT_MENU = 230;

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

    // Сообщения плагина. В тихом режиме не показываются
    function say(text) {
        if (!enabled(KEY.quiet)) Lampa.Noty.show(text);
    }

    // Если одна часть плагина сломалась (три ошибки подряд), выключаем только её до перезапуска
    var broken = {};
    var failures = {};

    function guard(name, fn) {
        return function () {
            if (broken[name]) return;

            try {
                var result = fn.apply(this, arguments);
                failures[name] = 0;
                return result;
            } catch (e) {
                failures[name] = (failures[name] || 0) + 1;

                if (failures[name] >= 3) {
                    broken[name] = String(e && e.message || e);
                    try { console.log('Easy UI', 'выключено до перезапуска:', name, broken[name]); } catch (err) {}
                }
            }
        };
    }

    // Короткие имена: «CDNVideoHub (4K)» → «VideoHub», «LostFilm (многоголосый)» → «LostFilm»
    function withoutBrackets(text) {
        var clean = $.trim(String(text || '').replace(/\s*[\(\[][^\)\]]*[\)\]]\s*/g, ' ').replace(/\s+/g, ' '));
        return clean || $.trim(String(text || ''));
    }

    function shortServer(name) {
        var clean = withoutBrackets(name).replace(/^cdn[\s_-]*/i, '');
        return clean || withoutBrackets(name);
    }

    function shortVoice(title) {
        return withoutBrackets(String(title || '').replace(/^\d+\.\s*/, ''));
    }

    // Вид озвучки по названию
    function voiceKind(title) {
        title = String(title || '');

        if (foreign(title)) return 'Оригинал';
        if (/автор|одногол|\bavo\b/i.test(title)) return 'Авторская';
        if (/дубл|многогол|двухгол|проф|\bmvo\b|\bdvo\b/i.test(title)) return 'Проф.';

        return '';
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

        /* Шапка на странице мода: родные кнопки (и поиск) прячем, свои показываем */
        '.easy-ui-head .filter--sort,.easy-ui-head .filter--filter,.easy-ui-head .filter--search{display:none!important}',
        '.easy-ui-chip.hide{display:none!important}',
        /* Кнопка шапки в два этажа: сверху что это («Озвучка»), снизу выбранное */
        '.easy-ui-head .easy-ui-chip{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-orient:vertical;-webkit-flex-direction:column;flex-direction:column;',
        '-webkit-box-align:start;-webkit-align-items:flex-start;align-items:flex-start;-webkit-box-pack:center;-webkit-justify-content:center;justify-content:center;',
        'height:auto!important;min-height:3.2em;padding-top:.45em;padding-bottom:.45em;line-height:1.25}',
        '.easy-ui-head .easy-ui-chip>span{font-size:.8em;opacity:.65;margin:0!important}',
        '.easy-ui-head .easy-ui-chip>div{margin:.1em 0 0!important;padding:0!important;background:none!important;font-weight:600;line-height:1.25}',

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

        /* Серии плиткой: по три в ряд, кадр из серии, номер и название */
        '.easy-ui-grid .explorer__files .scroll__body{display:-webkit-box;display:-webkit-flex;display:flex;',
        '-webkit-flex-wrap:wrap;flex-wrap:wrap;-webkit-align-content:flex-start;align-content:flex-start;margin-right:-1em}',
        '.easy-ui-grid .explorer__files .scroll__body>*{width:100%;margin-right:1em}',
        '.easy-ui-grid .explorer__files .scroll__body>.online{width:-webkit-calc(33.333% - 1em);width:calc(33.333% - 1em);',
        'margin:0 1em 1.2em 0;padding:0;overflow:hidden;-webkit-box-sizing:border-box;box-sizing:border-box;',
        'background-color:rgba(18,18,18,.88);-webkit-border-radius:.5em;border-radius:.5em}',
        '.easy-ui-grid .explorer__files .scroll__body>.online.focus{margin:0 1em 1.2em 0;padding:0}',
        '.easy-ui-grid .online .online__body{padding:.7em .9em 1em}',
        '.easy-ui-grid .online .online__body>div:first-child{display:none}',
        '.easy-ui-grid .online .online__title,.easy-ui-grid .online .online__quality{padding-left:0!important}',
        '.easy-ui-grid .online .online__title{font-size:1.2em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
        // Строку «360p ~ 1080p / озвучка» на плитке не показываем: озвучка и так видна в шапке
        '.easy-ui-grid .online .online__quality{display:none!important}',
        '.easy-ui-grid .online .time-line-details,.easy-ui-grid .online .torrent-item__viewed{display:none!important}',
        '.easy-ui-grid .online .time-line{left:0;right:0;bottom:0;margin:0;-webkit-border-radius:0;border-radius:0;background-color:rgba(255,255,255,.15)}',
        '.easy-ui-grid .online .time-line>div{height:.25em;-webkit-border-radius:0;border-radius:0;background-color:#1473e6}',
        '.easy-ui-thumb{display:none}',
        '.easy-ui-grid .easy-ui-thumb{display:block;position:relative;padding-top:56.25%;background-color:rgba(255,255,255,.06);',
        'background-position:50% 50%;background-repeat:no-repeat;-webkit-background-size:cover;background-size:cover}',
        '.easy-ui-grid .easy-ui-thumb--empty::after{content:attr(data-num);position:absolute;left:0;right:0;top:50%;margin-top:-.6em;',
        'font-size:2.6em;line-height:1.2;font-weight:600;text-align:center;opacity:.25}',
        '.easy-ui-thumb__num{position:absolute;left:.5em;top:.5em;padding:.1em .5em;border-radius:.3em;',
        'font-size:1.05em;font-weight:600;line-height:1.3;background:rgba(0,0,0,.65);color:#fff}',
        '.easy-ui-ep{display:none}',
        '.easy-ui-grid .easy-ui-ep{display:block;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;',
        'font-size:1.25em;line-height:1.3;max-height:2.6em;min-height:2.6em;font-weight:600;color:#fff;overflow:hidden}',
        '.easy-ui-done .easy-ui-thumb::before{content:"";position:absolute;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.45)}',
        '.easy-ui-mark{position:absolute;right:.5em;bottom:.5em;padding:.15em .55em;border-radius:.3em;',
        'font-size:.9em;font-weight:600;line-height:1.3;white-space:nowrap;background:rgba(0,0,0,.7);color:#fff}',
        '.easy-ui-mark--done{width:1.5em;height:1.5em;padding:0;border-radius:50%;text-align:center;line-height:1.5em;background:#fff;color:#000}',
        '.easy-ui-grid .online.easy-ui-tile .online__title{display:none}',
        '.easy-ui-grid .online .easy-ui-stop{top:.5em;bottom:auto;right:.5em}',

        /* Где остановились: метка на серии и строка на карточке */
        '.easy-ui-last{position:relative}',
        '.easy-ui-stop{position:absolute;right:.7em;bottom:.7em;padding:.2em .6em;border-radius:.3em;',
        'font-size:.85em;line-height:1.3;white-space:nowrap;background:#1473e6;color:#fff}',
        '.easy-ui-resume{margin-top:.8em;font-size:1.25em;color:#fff}',
        '.easy-ui-airs{margin-top:.4em;font-size:1.05em;color:rgba(255,255,255,.7)}',
        'body.easy-ui--card .easy-ui-resume+.full-start-new__buttons,body.easy-ui--card .easy-ui-airs+.full-start-new__buttons{margin-top:.5em}',

        /* Крупный номер серии; плитка без кадра — размытый фон сериала */
        '.easy-ui-thumb{overflow:hidden}',
        '.easy-ui-thumb__num{font-size:1.7em;z-index:2}',
        '.easy-ui-thumb__bg{position:absolute;left:-8%;top:-8%;right:-8%;bottom:-8%;background-position:50% 50%;',
        '-webkit-background-size:cover;background-size:cover;-webkit-filter:blur(.5em) brightness(.55);filter:blur(.5em) brightness(.55)}',
        '.easy-ui-grid .easy-ui-thumb--empty::after{z-index:1;opacity:.55}',
        '.easy-ui-mark{z-index:2}',

        /* Одна анимация загрузки: и у Lampa, и у модов, и у плагина */
        '@-webkit-keyframes easyUiSpin{to{-webkit-transform:rotate(360deg)}}',
        '@keyframes easyUiSpin{to{transform:rotate(360deg)}}',
        '.easy-ui-spinner,body.easy-ui--look .activity__loader::after{content:"";display:block;width:2.6em;height:2.6em;',
        'border:.28em solid rgba(255,255,255,.2);border-top-color:#fff;border-radius:50%;',
        '-webkit-animation:easyUiSpin .8s linear infinite;animation:easyUiSpin .8s linear infinite}',
        'body.easy-ui--look .activity__loader{background-image:none!important}',
        'body.easy-ui--look .activity__loader::after{position:absolute;left:50%;top:50%;margin:-1.3em 0 0 -1.3em}',

        /* «Смотреть» открывает мод — крутится значок */
        '.easy-ui-busy::after{content:"";display:inline-block;vertical-align:middle;width:.8em;height:.8em;margin-left:.6em;',
        'border:.15em solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;',
        '-webkit-animation:easyUiSpin .8s linear infinite;animation:easyUiSpin .8s linear infinite}',

        /* Поиск сервера: одна заставка вместо мелькающих списков */
        '.easy-ui-searching-host{position:relative}',
        '.easy-ui-searching{position:absolute;left:0;top:0;right:0;bottom:0;z-index:20;background:rgba(0,0,0,.88);',
        'display:-webkit-box;display:-webkit-flex;display:flex;-webkit-box-orient:vertical;-webkit-flex-direction:column;flex-direction:column;',
        '-webkit-box-align:center;-webkit-align-items:center;align-items:center;padding-top:6em;font-size:1.3em;color:#fff;text-align:center}',
        '.easy-ui-searching .easy-ui-spinner{margin-bottom:1em}',
        '.easy-ui-searching__note{margin-top:.4em;font-size:.8em;opacity:.6}',

        /* Плавное появление страниц */
        '@-webkit-keyframes easyUiFade{from{opacity:0}to{opacity:1}}',
        '@keyframes easyUiFade{from{opacity:0}to{opacity:1}}',
        'body.easy-ui--smooth .activity.activity--active{-webkit-animation:easyUiFade .22s ease-out;animation:easyUiFade .22s ease-out}',

        /* Единый вид: закруглённые кнопки, заметный фокус, мягкие плашки, без лишнего */
        'body.easy-ui--look .simple-button,body.easy-ui--look .full-start__button{-webkit-border-radius:.6em;border-radius:.6em}',
        'body.easy-ui--look .easy-ui-chip.focus,body.easy-ui--look .full-start__button.focus{box-shadow:0 0 0 .18em #fff}',
        'body.easy-ui--look .easy-ui-grid .explorer__files .scroll__body>.online.focus{box-shadow:0 0 0 .22em #fff;',
        '-webkit-transform:scale(1.04);transform:scale(1.04);z-index:1}',
        'body.easy-ui--look .card__vote,body.easy-ui--look .card__type,body.easy-ui--look .card__quality>div{',
        'background:rgba(0,0,0,.55)!important;color:#fff;border:0!important;-webkit-border-radius:.4em;border-radius:.4em}',
        'body.easy-ui--look .card__quality{background:none!important;border:0!important}',
        'body.easy-ui--look .full-start-new__tagline{display:none}',
        '.easy-ui-altname{-webkit-filter:opacity(.75);filter:opacity(.75);font-size:.85em;margin-top:.6em}',
        // Фон карточки лишь чуть притемняем: Lampa делает его вдвое тусклее, и картинка хуже видна
        'body.easy-ui--card .full-start__background.loaded{opacity:.85}',
        '.easy-ui-chip span svg{width:1.2em;height:1.2em;vertical-align:middle}',
        '.easy-ui-chip,.easy-ui-chip>*{max-width:none!important;text-overflow:clip!important}',

        /* Все озвучки сразу: окно вариантов */
        // На карточке остаётся только наша «Смотреть» (плюс «Источники» про запас): кнопки модов
        // (BWA, MODS's, Онлайн и др.) и «Серии» прячем — их заменяет окно со всеми серверами
        'body.easy-ui--voices .full-start-new__buttons>.full-start__button:not(.button--play):not(.button--book):not(.button--reaction):not(.button--subscribe):not(.button--options):not(.view--trailer):not(.easy-ui-sources):not(.easy-ui-poster),body.easy-ui--voices .full-start__button.view--bwa,body.easy-ui--voices .full-start__button.view--modss_online{display:none!important}',
        '.easy-voices__status{opacity:.75;margin:0 0 1em;font-size:1.2em;position:relative}',
        '.easy-voices__status--busy{padding-left:1.8em}',
        '.easy-voices__status--busy:before{content:"";position:absolute;left:0;top:.1em;width:1em;height:1em;border:.15em solid rgba(255,255,255,.3);border-top-color:#fff;-webkit-border-radius:50%;border-radius:50%;-webkit-animation:easyVoicesSpin .8s linear infinite;animation:easyVoicesSpin .8s linear infinite}',
        '.easy-voices__list{padding-bottom:3em}',
        '.easy-voices-row{background:rgba(255,255,255,.07);-webkit-border-radius:1em;border-radius:1em;padding:1em 1.4em;margin-bottom:.8em}',
        '.easy-voices-row.focus{background:#fff;color:#000}',
        '.easy-voices-row__title{font-size:1.6em;font-weight:600}',
        '.easy-voices-row__meta{margin-top:.4em;font-size:1.1em}',
        '.easy-voices-q{display:inline-block;padding:.1em .5em;-webkit-border-radius:.4em;border-radius:.4em;margin-right:.5em;font-weight:600;background:rgba(255,255,255,.2)}',
        '.easy-voices-row.focus .easy-voices-q{background:rgba(0,0,0,.12)}',
        '.easy-voices-q.cam,.easy-voices-row.focus .easy-voices-q.cam{background:#b33;color:#fff}',
        '.easy-voices-tags{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;margin-top:.5em}',
        '.easy-voices-tag{padding:.15em .6em;margin:0 .4em .4em 0;-webkit-border-radius:.4em;border-radius:.4em;background:rgba(255,255,255,.12);font-size:.9em;white-space:nowrap}',
        '.easy-voices-row.focus .easy-voices-tag{background:rgba(0,0,0,.1)}',
        '.easy-voices-new{position:relative;z-index:2;-webkit-animation:easyVoicesUp .45s ease-out both;animation:easyVoicesUp .45s ease-out both}',
        '@-webkit-keyframes easyVoicesSpin{to{-webkit-transform:rotate(360deg)}}',
        '@keyframes easyVoicesSpin{to{transform:rotate(360deg)}}',
        '@-webkit-keyframes easyVoicesUp{from{opacity:0;-webkit-transform:translateY(-1.2em) scale(.97)}to{opacity:1;-webkit-transform:none}}',
        '@keyframes easyVoicesUp{from{opacity:0;transform:translateY(-1.2em) scale(.97)}to{opacity:1;transform:none}}',

        /* Окно сериала: шапка «Сезон» и «Источник», под ней серии плиткой */
        '.easy-series__head{display:-webkit-box;display:-webkit-flex;display:flex;-webkit-flex-wrap:wrap;flex-wrap:wrap;padding:0 0 1em}',
        '.easy-series__head .easy-ui-chip{margin:0 1em 0 0}',
        '.easy-series .easy-voices__status{margin:0 0 1em}',
        '.easy-series .easy-voices__status.hide{display:none}',
        '.easy-series .easy-series__tile{position:relative}',
        '.easy-series .easy-series__tile--wait{visibility:hidden}',
        '.easy-series .easy-series__source{margin:0 0 1.2em;width:100%!important}',
        '.easy-series .easy-series__source.hide{display:none}',
        '.easy-series .explorer__files .scroll__body>.online{-webkit-border-radius:1em;border-radius:1em;overflow:hidden;background:rgba(255,255,255,.07)}',
        '.easy-series .easy-series__tile .time-line{position:absolute;height:.25em}',

        /* Открытие карточки: фон подъезжает, потом кнопки. Обычное появление страницы в это время выключено */
        '@-webkit-keyframes easyVoicesBg{from{opacity:0;-webkit-transform:scale(1.08)}to{opacity:1;-webkit-transform:none}}',
        '@keyframes easyVoicesBg{from{opacity:0;transform:scale(1.08)}to{opacity:1;transform:none}}',
        '@-webkit-keyframes easyVoicesFade{from{opacity:0;-webkit-transform:translateY(.6em)}to{opacity:1;-webkit-transform:none}}',
        '@keyframes easyVoicesFade{from{opacity:0;transform:translateY(.6em)}to{opacity:1;transform:none}}',
        '.activity.easy-voices-enter{-webkit-animation:none!important;animation:none!important}',
        '.easy-voices-enter .full-start__background{-webkit-transition:none!important;transition:none!important}',
        '.easy-voices-enter--full .full-start__background{-webkit-animation:easyVoicesBg .8s cubic-bezier(.2,.7,.2,1) both;animation:easyVoicesBg .8s cubic-bezier(.2,.7,.2,1) both}',
        '.easy-voices-enter--full .full-start-new__right>*{-webkit-animation:easyVoicesFade .5s ease-out .3s both;animation:easyVoicesFade .5s ease-out .3s both}',
        '.easy-voices-enter--full .full-start-new__right>:nth-child(2){-webkit-animation-delay:.38s;animation-delay:.38s}',
        '.easy-voices-enter--full .full-start-new__right>:nth-child(3){-webkit-animation-delay:.46s;animation-delay:.46s}',
        '.easy-voices-enter--full .full-start-new__right>:nth-child(4){-webkit-animation-delay:.54s;animation-delay:.54s}',
        '.easy-voices-enter--full .full-start-new__right>:nth-child(5){-webkit-animation-delay:.62s;animation-delay:.62s}',
        '.easy-voices-enter--full .full-start-new__right>:nth-child(n+6){-webkit-animation-delay:.7s;animation-delay:.7s}',
        '.easy-voices-enter--full .full-start-new__right>.full-start-new__buttons{-webkit-animation:easyVoicesFade .5s ease-out .8s both;animation:easyVoicesFade .5s ease-out .8s both}',
        '.easy-voices-enter--light .full-start__background{-webkit-animation:easyVoicesBg .5s ease-out both;animation:easyVoicesBg .5s ease-out both}',
        '.easy-voices-enter--light .full-start-new__right>*{-webkit-animation:easyVoicesFade .3s ease-out .1s both;animation:easyVoicesFade .3s ease-out .1s both}',
        '.easy-voices-enter--light .full-start-new__right>.full-start-new__buttons{-webkit-animation-delay:.25s;animation-delay:.25s}',

        /* «Смотреть»: кружок на месте значка, затем карточка улетает вперёд, а мы «влетаем» в постер */
        '.easy-voices-hidden{display:none!important}',
        '.easy-voices-spin{display:inline-block;-webkit-flex-shrink:0;flex-shrink:0;width:1.3em;height:1.3em;-webkit-box-sizing:border-box;box-sizing:border-box;border:.2em solid rgba(128,128,128,.35);border-top-color:currentColor;-webkit-border-radius:50%;border-radius:50%;-webkit-animation:easyVoicesSpin .5s linear infinite;animation:easyVoicesSpin .5s linear infinite}',
        '@-webkit-keyframes easyVoicesDiveFg{0%{opacity:1;-webkit-transform:none}60%{opacity:.75}100%{opacity:0;-webkit-transform:scale(1.7)}}',
        '@keyframes easyVoicesDiveFg{0%{opacity:1;transform:none}60%{opacity:.75}100%{opacity:0;transform:scale(1.7)}}',
        '@-webkit-keyframes easyVoicesDiveBg{from{-webkit-transform:none}to{-webkit-transform:scale(1.3)}}',
        '@keyframes easyVoicesDiveBg{from{transform:none}to{transform:scale(1.3)}}',
        '@-webkit-keyframes easyVoicesDiveFgLight{from{opacity:1;-webkit-transform:none}to{opacity:0;-webkit-transform:scale(1.2)}}',
        '@keyframes easyVoicesDiveFgLight{from{opacity:1;transform:none}to{opacity:0;transform:scale(1.2)}}',
        '@-webkit-keyframes easyVoicesDiveBgLight{from{-webkit-transform:none}to{-webkit-transform:scale(1.08)}}',
        '@keyframes easyVoicesDiveBgLight{from{transform:none}to{transform:scale(1.08)}}',
        '.easy-voices-dive .layer--wheight>.scroll{-webkit-transform-origin:50% 55%;transform-origin:50% 55%}',
        '.easy-voices-dive--full .layer--wheight>.scroll{-webkit-animation:easyVoicesDiveFg .4s cubic-bezier(.45,0,.75,.4) forwards;animation:easyVoicesDiveFg .4s cubic-bezier(.45,0,.75,.4) forwards}',
        '.easy-voices-dive--full .full-start__background{-webkit-animation:easyVoicesDiveBg .4s cubic-bezier(.45,.05,.55,.95) forwards;animation:easyVoicesDiveBg .4s cubic-bezier(.45,.05,.55,.95) forwards}',
        '.easy-voices-dive--light .layer--wheight>.scroll{-webkit-animation:easyVoicesDiveFgLight .15s ease-in forwards;animation:easyVoicesDiveFgLight .15s ease-in forwards}',
        '.easy-voices-dive--light .full-start__background{-webkit-animation:easyVoicesDiveBgLight .15s ease-in forwards;animation:easyVoicesDiveBgLight .15s ease-in forwards}',
        '.easy-voices-press .easy-voices-spin+span{margin-left:0!important}',

        /* Вечерний режим: экран чуть темнее, кроме видео */
        '.easy-ui-dim{position:fixed;left:0;top:0;right:0;bottom:0;z-index:9990;pointer-events:none;background:rgba(0,0,0,.22);display:none}',
        'body.easy-ui--dim .easy-ui-dim{display:block}',
        'body.easy-ui--dim.easy-ui--playing .easy-ui-dim{display:none}'
    ].join('');

    function applyBodyClasses() {
        $('body')
            .toggleClass('easy-ui--smooth', enabled(KEY.smooth))
            .toggleClass('easy-ui--noshots', enabled(KEY.shots))
            .toggleClass('easy-ui--nopriority', enabled(KEY.priority))
            .toggleClass('easy-ui--card', enabled(KEY.card))
            .toggleClass('easy-ui--look', enabled(KEY.look))
            .toggleClass('easy-ui--voices', enabled(KEY.voices));

        applyLarge();
        applyDim();

        $('.easy-ui-poster').toggleClass('hide', !enabled(KEY.card)).toggleClass('selector', enabled(KEY.card));

        markShots();
    }

    // Крупный режим: Lampa сама задаёт размер шрифта по ширине экрана — увеличиваем его на 15 %
    var largeOn = false;

    function applyLarge() {
        var on = enabled(KEY.large);

        if (!on && !largeOn) return;

        largeOn = on;

        var sizes = { normal: 1, small: 0.9, bigger: 1.05 };
        var fs = sizes[Lampa.Storage.field('interface_size')] || 1;
        var px = Math.max(window.innerWidth / 84.17 * fs, 10.6) * (on ? 1.15 : 1);

        $('body').css('font-size', px + 'px');
    }

    // Вечерний режим: с 21:00 до 7:00 экран чуть темнее (видео не затемняется)
    function applyDim() {
        var hour = new Date().getHours();
        var on = enabled(KEY.dim) && (hour >= 21 || hour < 7);

        if (on && !$('.easy-ui-dim').length) $('body').append('<div class="easy-ui-dim"></div>');

        $('body').toggleClass('easy-ui--dim', on);
    }

    function watchLook() {
        Lampa.Storage.listener.follow('change', function (e) {
            if (e && e.name === 'interface_size') setTimeout(applyLarge, 50);
        });

        Lampa.Listener.follow('resize_end', function () { setTimeout(applyLarge, 50); });

        setInterval(applyDim, 60000);

        Lampa.Player.listener.follow('start', function () { $('body').addClass('easy-ui--playing'); });
        Lampa.Player.listener.follow('destroy', function () { $('body').removeClass('easy-ui--playing'); });
    }

    // Тихий щелчок при нажатии (своя настройка, по умолчанию выключен)
    var audio = null;

    function click() {
        if (!enabled(KEY.sound)) return;

        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;

            if (!Ctx) return;
            if (!audio) audio = new Ctx();
            if (audio.state === 'suspended' && audio.resume) audio.resume();

            var osc = audio.createOscillator();
            var gain = audio.createGain();
            var now = audio.currentTime;

            osc.frequency.value = 1400;
            gain.gain.setValueAtTime(0.05, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
            osc.connect(gain);
            gain.connect(audio.destination);
            osc.start(now);
            osc.stop(now + 0.05);
        } catch (e) {}
    }

    function watchClicks() {
        document.addEventListener('hover:enter', click, true);
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
            card: active.card && active.card.id ? cardKey(active.card) : '',
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

        say(failed + ' не нашёл фильм. Открываю ' + (chain.titles[nextKey] || $.trim(next.text())));
        Lampa.Activity.back();

        setTimeout(function () {
            next.trigger('hover:enter');
        }, 500);

        return true;
    }

    var OPEN_GUARD = 2500; // столько после нажатия «Смотреть» повторное нажатие не считается
    var opening = 0;

    // Значок загрузки на «Смотреть», пока открывается мод
    function busy(active) {
        try {
            var button = active.activity.render().find('.full-start-new__buttons .button--play').first();

            button.addClass('easy-ui-busy');
            setTimeout(function () { button.removeClass('easy-ui-busy'); }, 4000);
        } catch (e) {}
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
        var active = Lampa.Activity.active();
        var card = active && active.card && active.card.id ? active.card : null;
        var ownRecord = card ? loadHistory().mods[cardKey(card)] : null;
        var own = ownRecord && ownRecord.key ? ownRecord.key : '';

        // Сначала мод, в котором этот фильм уже смотрели, потом выбранный в прошлый раз
        sources.forEach(function (item) {
            if (!remembered && own && sameSource(item.btn, own)) remembered = item;
        });
        sources.forEach(function (item) {
            if (!remembered && sameSource(item.btn, last)) remembered = item;
        });

        if (!remembered && sources.length === 1) remembered = sources[0];

        if (remembered && !force) {
            // Повторное нажатие, пока мод открывается, — не считаем
            if (Date.now() - opening < OPEN_GUARD) return null;

            opening = Date.now();
            busy(active);
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

    var EPISODES_ICON = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="2.5" y="3.5" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="3.5" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="2.5" y="13.5" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13.5" y="13.5" width="8" height="7" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>';

    var SERVER_ICON = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="18" height="6" rx="1.5" stroke="currentColor" stroke-width="2"/><circle cx="7" cy="7" r="1.2" fill="currentColor"/><circle cx="7" cy="17" r="1.2" fill="currentColor"/></svg>';


    function isSeries(movie) {
        return !!(movie && (movie.name || movie.original_name || movie.number_of_seasons));
    }

    var POSTER_ICON ='<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="2.5" width="14" height="19" rx="2.5" stroke="currentColor" stroke-width="2"/><path d="M5 17l4.5-4.5 3.5 3.5 2-2 4 4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="14.5" cy="8" r="1.8" fill="currentColor"/></svg>';

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

        // Сериал: кнопка «Серии» — тот же мод, фокус сразу на списке серий
        if (movie && isSeries(movie) && !row.find('.easy-ui-episodes').length) {
            var episodes = $('<div class="full-start__button selector easy-ui-episodes">' + EPISODES_ICON + '<span>Серии</span></div>');

            episodes.on('hover:enter', function () { play.trigger('hover:enter'); });
            list.after(episodes);
        }

        row.find('.easy-ui-episodes').toggleClass('hide', !enabled(KEY.play)).toggleClass('selector', enabled(KEY.play));

        // Эмоции — сразу под названием. Другие плагины вставляют свои блоки после названия позже
        // (оригинальные названия), поэтому место проверяем ещё раз в refresh()
        // Названия на других языках, которые плагины ставят под заголовком, делаем тише:
        // всё чужое между названием и строкой оценок
        function dimAltNames() {
            var title = render.find('.full-start-new__title').first();
            if (!title.length) return;
            var known = /full-start-new__|full-start__|easy-ui-/;
            var el = title.next();
            for (var i = 0; i < 6 && el.length; i++, el = el.next()) {
                if (/full-start-new__(rate-line|details|buttons|body)/.test(el.attr('class') || '')) break;
                if (!known.test(el.attr('class') || '') && $.trim(el.text())) el.addClass('easy-ui-altname');
            }
            // Ставим их ниже — прямо над кнопками (и над строкой «Остановились»)
            var buttons = render.find('.full-start-new__buttons').first();
            var before = buttons.prevAll('.easy-ui-resume, .easy-ui-airs').last();
            if (!before.length) before = buttons;
            // Переносим один раз: перенос заново запустил бы анимацию появления
            var alt = render.find('.easy-ui-altname');
            if (alt.length && !before.prev().hasClass('easy-ui-altname')) alt.insertBefore(before);
        }

        function placeReactions() {
            if (!enabled(KEY.card)) return;

            var title = render.find('.full-start-new__title').first();
            var reactions = render.find('.full-start-new__reactions').first();

            if (title.length && reactions.length && title.next()[0] !== reactions[0]) title.after(reactions);
        }

        placeReactions();
        dimAltNames();

        // Где остановились в прошлый раз
        render.data('easy-ui-movie', movie || null);
        resumeLine(render);
        prefetchStills(movie);

        // Маленький постер убран — смотреть его во весь экран по отдельной кнопке
        if (!row.find('.easy-ui-poster').length) {
            var poster = $('<div class="full-start__button selector easy-ui-poster">' + POSTER_ICON + '<span>Постер</span></div>');

            poster.on('hover:enter', function () { showPoster(render, poster); });
            poster.toggleClass('hide', !enabled(KEY.card)).toggleClass('selector', enabled(KEY.card));
            row.append(poster);
        }

        var shown = null;

        // Фильм уже начат — фокус сразу на «Смотреть»
        function focusResume() {
            if (!render.find('.easy-ui-resume').length || !document.body.contains(render[0])) return;

            try {
                var focused = render.find('.selector.focus')[0];
                var playButton = render.find('.full-start-new__buttons .button--play')[0];

                if (Lampa.Controller.enabled().name !== 'full_start' || !playButton || focused === playButton) return;
                if (focused && !$(focused).closest('.full-start-new__buttons').length) return;

                Lampa.Controller.collectionFocus(playButton, render[0]);
            } catch (e) {}
        }

        [50, 400].forEach(function (delay) { setTimeout(focusResume, delay); });

        function refresh() {
            if (!document.body.contains(render[0])) return;

            // Класс hide убирает Shots из родного меню Lampa
            if (enabled(KEY.shots)) render.find('.buttons--container .shots-view-button').addClass('hide');

            placeReactions();
            dimAltNames();

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
        if (!h.mods || typeof h.mods !== 'object') h.mods = {};         // карточка → мод, в котором смотрели
        if (!h.seen || typeof h.seen !== 'object') h.seen = {};         // карточка → озвучка, в которой смотрели
        if (!(h.stars instanceof Array)) h.stars = [];                    // любимые озвучки (звёздочка)

        return h;
    }

    // Самые старые записи «карточка → …» забываем
    function trimCards(map) {
        var keys = Object.keys(map);

        if (keys.length <= HISTORY_LIMIT) return;

        keys.sort(function (a, b) { return (map[a].u || 0) - (map[b].u || 0); });
        keys.slice(0, keys.length - HISTORY_LIMIT).forEach(function (key) { delete map[key]; });
    }

    // Что реально запустили: мод, сервер и озвучку — чтобы в следующий раз открыть их сразу
    function rememberLaunch() {
        var p = activePage();
        if (!p || !p.movie || !p.movie.id) return;

        var h = loadHistory();
        var card = cardKey(p.movie);
        var source = p.currentSource();
        var group = p.voiceGroup();
        var voice = group ? groupValue(group) : '';

        if (source && !source.ghost && h.movies[p.movieKey] !== source.source) {
            h.movies[p.movieKey] = source.source;
            touchMovie(h, p.movieKey);
        }

        if (chain && chain.card === card && chain.current) {
            h.mods[card] = { key: chain.current, u: Date.now() };
            trimCards(h.mods);
        }

        if (voice && voice !== '—' && (!foreign(voice) || attemptsFor(p.movieKey).voiceManual)) {
            h.seen[card] = { v: voice, u: Date.now() };
            trimCards(h.seen);
        }

        Lampa.Storage.set(HISTORY_KEY, h);
    }

    // Порядок озвучек: со звёздочкой, потом выбранные недавно, потом остальные
    function voiceRank(title, h) {
        var star = h.stars.indexOf(title);
        var like = h.likes.indexOf(title);

        if (star >= 0) return star;
        if (like >= 0) return 100 + like;

        return 1000;
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

            var rank = voiceRank(item.title, h) * 1000 + index;

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

            if (label.charAt(0) === '<') {
                if (elem.data('label') !== label) elem.find('span').html(label);
            } else {
                elem.find('span').text(label);
            }

            elem.data('label', label);

            return elem;
        }

        function sourceLabel() {
            var list = sources();
            var current = list ? selectedOf(list) : null;
            var name = current ? shortServer(current.title) : '—';
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
                // Качество в шапке не показываем: плеер сам берёт лучшее
                if (/качеств/i.test(group.title)) return;

                var label = kind === 'season' ? 'Сезон' : kind === 'voice' ? 'Озвучка' : short(group.title, 18);
                var elem = chip(key, label, function () { openGroup(key); });
                var value = groupValue(group);

                elem.data('group', group);
                elem.find('div').text(short(kind === 'voice' ? shortVoice(value) : value, 40));
                (lists[kind] || lists.other).push(key);
            });

            // Порядок: сезон, озвучка, источник, остальное (качество)
            var inside = lists.voice.length ? null : tracksNow();

            if (inside) {
                chip('tracks', 'Озвучка', openTracks).find('div').text('в плеере · ' + inside.a.length);
                lists.voice.push('tracks');
            }

            var wanted = lists.season.concat(lists.voice, ['source'], lists.other);

            chip('source', SERVER_ICON, openSource).find('div').text(short(sourceLabel(), 40));

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
            var label = String(elem.data('label') || '');
            var isVoice = groupKind(group) === 'voice';
            var h = loadHistory();
            var items = group.items.slice();

            // Озвучки: со звёздочкой и недавние — сверху, короткие имена и вид озвучки
            if (isVoice) {
                items.sort(function (a, b) {
                    var ra = voiceRank(a.title, h);
                    var rb = voiceRank(b.title, h);
                    return ra !== rb ? ra - rb : group.items.indexOf(a) - group.items.indexOf(b);
                });
            }

            var menu = items.map(function (item) {
                var entry = {
                    title: item.title,
                    subtitle: item.subtitle,
                    selected: !!item.selected || item.title === value,
                    item: item
                };

                if (isVoice) {
                    var name = shortVoice(item.title);
                    var notes = [voiceKind(item.title), name !== $.trim(item.title) ? item.title : '', item.subtitle || ''].filter(Boolean);

                    entry.title = (h.stars.indexOf(item.title) >= 0 ? '★ ' : '') + name;
                    entry.subtitle = notes.join(' · ');
                }

                return entry;
            });

            if (isVoice && value && value !== '—') {
                var starred = h.stars.indexOf(value) >= 0;

                menu.push({
                    title: starred ? 'Убрать звёздочку у «' + shortVoice(value) + '»' : '★ Любимая: «' + shortVoice(value) + '»',
                    subtitle: starred ? '' : 'Любимые озвучки всегда сверху и включаются первыми',
                    star: value
                });
            }

            Lampa.Select.show({
                title: label.charAt(0) === '<' ? group.title : elem.find('span').text(),
                items: menu,
                onBack: back,
                onSelect: function (picked) {
                    if (picked.star) {
                        var store = loadHistory();
                        var at = store.stars.indexOf(picked.star);

                        if (at >= 0) store.stars.splice(at, 1);
                        else store.stars.unshift(picked.star);

                        store.stars = store.stars.slice(0, 20);
                        Lampa.Storage.set(HISTORY_KEY, store);
                        say(at >= 0 ? 'Звёздочка убрана' : 'Озвучка «' + shortVoice(picked.star) + '» теперь любимая');
                        closeMenuIfOpen();
                        back();
                        return;
                    }

                    if (isVoice) {
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

            // Серверы, которые этот фильм не нашли, — в конце и серым
            function missed(item) {
                return !item.selected && (record.names.indexOf(item.source) >= 0 || record.subs.indexOf(item.source) >= 0);
            }

            var sorted = list.slice().sort(function (a, b) {
                if (!!a.ghost !== !!b.ghost) return a.ghost ? 1 : -1;
                if (missed(a) !== missed(b)) return missed(a) ? 1 : -1;
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
                else if (record.names.indexOf(item.source) >= 0) note = 'Не нашёл';
                else if (item.source === known) note = 'Уже находил этот фильм';
                else if (isManaged) note = 'Доступен';

                var inside = item.ghost ? null : tracksOf(item);

                if (inside) note = (note ? note + ' · ' : '') + 'озвучек в плеере: ' + inside.a.length + (inside.s && inside.s.length ? ', есть субтитры' : '');

                return {
                    title: item.title,
                    subtitle: note,
                    selected: !!item.selected,
                    ghost: !!item.ghost || missed(item),
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

        // Первая проверка — сразу: запомненный сервер включается без лишнего ожидания
        setTimeout(check, 150);

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
            searching(null);
            if (!chainNext()) offerOtherMod();
        }

        // Ни один сервер не нашёл: предложить открыть другой мод из карточки
        function offerOtherMod() {
            var all = Lampa.Activity.all ? Lampa.Activity.all() : [];
            var previous = all.length > 1 ? all[all.length - 2] : null;

            if (!previous || previous.component !== 'full' || !document.body.contains(page()[0])) {
                say('Ни один сервер не нашёл это видео');
                return;
            }

            Lampa.Select.show({
                title: 'Ни один сервер не нашёл это видео',
                items: [
                    { title: 'Открыть другой мод', subtitle: 'Список всех источников этого фильма', other: true },
                    { title: 'Остаться здесь' }
                ],
                onBack: function () {
                    closeMenuIfOpen();
                    Lampa.Controller.toggle('content');
                },
                onSelect: function (picked) {
                    closeMenuIfOpen();

                    if (!picked.other) return Lampa.Controller.toggle('content');

                    Lampa.Activity.back();

                    setTimeout(function () {
                        try {
                            var render = Lampa.Activity.active().activity.render();
                            var listButton = render.find('.easy-ui-sources').not('.hide').first();

                            if (listButton.length) listButton.trigger('hover:enter');
                            else {
                                forceMenu = true;
                                render.find('.button--play').first().trigger('hover:enter');
                                forceMenu = false;
                            }
                        } catch (e) {}
                    }, 500);
                }
            });
        }

        // Заставка поверх списка, пока автоподбор перебирает серверы. null — убрать
        function searching(text) {
            var p = page();
            var host = p.find('.explorer__files').first();

            if (!host.length) host = p;

            var view = p.find('.easy-ui-searching');

            if (text === null) {
                view.remove();
                return;
            }

            if (!host.length) return;

            if (!view.length) {
                view = $('<div class="easy-ui-searching"><div class="easy-ui-spinner"></div><div class="easy-ui-searching__text"></div><div class="easy-ui-searching__note">«Назад» — выйти, кнопка сервера вверху — выбрать самому</div></div>');
                host.addClass('easy-ui-searching-host').append(view);
            }

            view.find('.easy-ui-searching__text').text(text);
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
                var total = list.filter(function (item) { return !item.ghost; }).length;
                var step = Math.min(total, record.names.length + 1);

                say('Сервер ' + shortServer(current.title) + ' ' + reason + ', пробую следующий (' + step + ' из ' + total + ')');
                searching('Ищу, где посмотреть… сервер ' + step + ' из ' + total + ': ' + shortServer(next.title));
                record.searching = true;
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
                    searching(null);
                    say('Русской озвучки нет ни на одном сервере. Включил ' + shortServer(fallback.title) + ' — оригинал или субтитры');

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
            if (!enabled(KEY.russian) || record.acceptForeign || record.voiceManual || record.voiceOwn) return false;

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
                    say('Включил русскую озвучку: ' + shortVoice(best.title));
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

                if (!checked) say('У ' + shortServer(current.title) + ' только оригинал или субтитры. Сменить — кнопка сервера вверху');

                return false;
            }

            tryNext(list, current, record, 'нашёл только оригинал или субтитры');

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

            // Досмотренная серия — фокус на следующую непросмотренную
            var next = $();

            if (done) {
                for (var i = list.index(row) + 1; i < list.length; i++) {
                    var hash = list.eq(i).find('.time-line[data-hash]').attr('data-hash');

                    if (!hash || spotOf(hash).p < DONE_PERCENT) {
                        next = list.eq(i);
                        break;
                    }
                }
            }

            focusRow(next.length ? next : row);
        }

        // Какой сезон открыть: где остановились, а если досмотрели его последнюю серию — следующий
        function wantedSeason() {
            var last = progress().last[cardKey(movie)];

            if (!last || !last.s) return 0;

            var entry = seasonCache[tmdbId(movie) + ':' + last.s];
            var count = entry && entry.ready ? Object.keys(entry.map).length : 0;

            if (count && last.e >= count && spotOf(last.hash).p >= DONE_PERCENT) return last.s + 1;

            return last.s;
        }

        function seasonNumber(title) {
            return +((String(title || '').match(/\d+/) || [])[0] || 0);
        }

        // Открыть сезон, где остановились. Один раз за заход. Возвращает true, если переключили
        function seasonStep(record) {
            if (record.seasonDone || !enabled(KEY.resume) || api.isMovie()) return false;

            record.seasonDone = true;

            var group = null;

            groups().forEach(function (g) {
                if (!group && groupKind(g) === 'season') group = g;
            });

            if (!group) return false;

            var want = wantedSeason();
            var now = seasonNumber(groupValue(group));
            var target = null;

            if (!want || want === now) return false;

            group.items.forEach(function (item) {
                if (!target && seasonNumber(item.title) === want) target = item;
            });

            // Следующего сезона ещё нет — остаёмся
            if (!target) return false;

            withoutMenuClose(function () { applyGroup(group, target); });
            refreshHead();
            since = Date.now();

            return true;
        }

        // Озвучка, в которой этот фильм уже смотрели. Возвращает true, если переключили
        function ownVoiceStep(record) {
            if (record.voiceManual || record.ownVoiceDone) return false;

            var group = api.voiceGroup();
            if (!group) return false;

            record.ownVoiceDone = true;

            var h = loadHistory();
            var seen = h.seen[cardKey(movie)];
            var want = h.voices[movieKey] || (seen && seen.v) || '';

            if (!want) return false;

            var has = group.items.some(function (item) { return item.title === want; });

            // Такой озвучки у этого сервера нет — дальше как обычно (русская по любимым)
            if (!has) return false;

            record.voiceOwn = true;

            if (groupValue(group) === want) return false;

            say('Включил озвучку, в которой смотрели: ' + shortVoice(want));
            api.applyVoice(want, false);
            since = Date.now();

            return true;
        }

        function updateGrid() {
            var p = page();

            if (!p.length) return;

            var on = enabled(KEY.grid) && !api.isMovie();

            p.toggleClass('easy-ui-grid', on);

            if (on) {
                dressTiles(p);
                tileMarks(p);
            }
        }

        // На кадре: галочка у досмотренной серии, «осталось N мин» у начатой
        function tileMarks(p) {
            p.find('.online.easy-ui-tile').each(function () {
                var row = $(this);
                var hash = row.find('.time-line[data-hash]').attr('data-hash');
                var spot = hash ? spotOf(hash) : { t: 0, d: 0, p: 0 };
                var done = spot.p >= DONE_PERCENT;
                var text = '';

                if (done) text = '✓';
                else if (spot.t > 0 && spot.d > spot.t) text = 'осталось ' + Math.max(1, Math.round((spot.d - spot.t) / 60)) + ' мин';

                var key = (done ? 'd' : 'p') + text;

                if (row.data('easy-ui-mark') === key) return;

                row.data('easy-ui-mark', key).toggleClass('easy-ui-done', done);
                row.find('.easy-ui-mark').remove();

                if (text) {
                    $('<div class="easy-ui-mark"></div>').toggleClass('easy-ui-mark--done', done).text(text).appendTo(row.find('.easy-ui-thumb').first());
                }
            });
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

                // Пока кадра нет (или его нет совсем) — размытый фон сериала
                var backdrop = movie.backdrop_path ? stillUrl(movie.backdrop_path) : '';

                if (backdrop) $('<div class="easy-ui-thumb__bg"></div>').css('background-image', 'url("' + backdrop + '")').prependTo(thumb);
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
                            thumb.find('.easy-ui-thumb__bg').remove();
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

            if (record.found || record.finished || record.manual) searching(null);

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
                if (seasonStep(record)) return;
                if (ownVoiceStep(record)) return;
                if (russianStep(list, current, record)) return;

                searching(null);

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
                        say('Открываю ' + shortServer(target.title) + ': на нём уже смотрели этот фильм');
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
            tryNext(list, current, record, 'не нашёл фильм');
        }

        function refreshSourceChip() {
            var elem = chips.source;
            if (!elem || elem.hasClass('hide')) return;

            var text = short(sourceLabel(), 40);
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
            movieKey: movieKey,
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
            // Невидимый экран Online Mod для нашего окна — его фильтр не трогаем
            if (omHidden) return;
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
            if (!p.applyVoice(title)) return say('Не удалось переключить озвучку');
            if (!wanted) return;

            waitForRow(p, wanted, function (row) {
                if (row) {
                    row.trigger('hover:enter');
                    return;
                }

                say('В озвучке «' + title + '» нет этой серии — вернул «' + previous + '»');

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

    }

    /* ---------- Место просмотра и последняя серия ---------- */

    // Online Mod отдаёт системному плееру Apple TV только адрес видео. Плеер не знает,
    // что это за серия, поэтому не продолжает с места остановки и не сохраняет его.
    // Плагин дописывает к запуску то, что мод уже подготовил: название, место просмотра
    // и субтитры. И ведёт свою запись: последняя серия каждого сериала и минута.

    var PROGRESS_KEY = 'easy_ui_progress';
    var PROGRESS_LIMIT = 600; // сколько серий и фильмов помнить
    var LAST_LIMIT = 200;     // сколько сериалов помнить
    var DONE_PERCENT = 95;    // с какого процента серия считается досмотренной (титры не мешают)
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

    // Кадры загружаем заранее, пока человек смотрит на карточку: сезон, где остановились, иначе первый
    function prefetchStills(movie) {
        if (!enabled(KEY.grid) || !tmdbId(movie)) return;

        var last = progress().last[cardKey(movie)];
        var season = last && last.s ? last.s : 1;

        seasonInfo(movie, season, function (episodes) {
            Object.keys(episodes).forEach(function (num) {
                if (episodes[num].still) new Image().src = episodes[num].still;
            });
        });
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

        primeLuxoShared(luxoLaunch);
    }

    // Серию, которую LUXO не узнал, он считает «сезон 0, серия 1» и хранит её место в одной ячейке
    // на весь сериал. Перед запуском кладём туда место именно этой серии, иначе он предложит
    // минуту прошлой серии. Ни разу не начатая серия — ячейку обнуляем, начнёт сначала.
    function primeLuxoShared(launch) {
        var p = activePage();
        var movie = p ? p.movie : null;

        if (!movie || p.isMovie()) return;

        var spot = spotOf(launch.hash);
        var done = spot.p >= DONE_PERCENT;
        var names = [];

        [movie.original_name, movie.original_title].forEach(function (name) {
            if (name && names.indexOf(name) < 0) names.push(name);
        });

        names.forEach(function (name) {
            var shared = String(Lampa.Utils.hash('01' + name));

            // Сама первая серия первого сезона — тот же ключ, её место и так верное
            if (shared === launch.hash) return;

            var params = { hash: shared, time: done ? 0 : spot.t, duration: spot.d, percent: done ? 0 : spot.p };

            if (typeof launch.profile !== 'undefined') params.profile = launch.profile;

            Lampa.Timeline.update(params);
        });
    }

    // Что ушло плееру Apple TV при запуске — без адресов видео. Только в памяти, для проверки.
    var luxoSent = window.easy_ui_luxo_sent = [];

    function stripUrls(value) {
        if (Array.isArray(value)) return value.map(stripUrls);
        if (!value || typeof value !== 'object') return value;

        var out = {};

        Object.keys(value).forEach(function (key) {
            if (/^(url|src|stream|link|file)$/i.test(key)) out[key] = value[key] ? '…' : value[key];
            else if (key !== 'subtitles') out[key] = stripUrls(value[key]);
        });

        return out;
    }

    function noteLuxoSent(kind, payload) {
        var item = { kind: kind, u: Date.now(), launch: luxoLaunch ? luxoLaunch.hash : '' };

        try {
            var data = typeof payload === 'string' ? { url: payload } : payload || {};
            var raw = String(data.url || data.playlist || '');
            var list = data.playlist;

            // Ссылка lampa://video?…&playlist=… — достаём список из неё
            if (!list && /playlist=/.test(raw)) list = decodeURIComponent(raw.split('playlist=')[1].split('&')[0]);
            if (typeof list === 'string') list = JSON.parse(list);

            item.player = data.player || (/player=([^&]*)/.exec(raw) || [])[1] || '';
            item.playlist = stripUrls(list || null);
        } catch (e) {
            item.error = String(e && e.message || e);
        }

        luxoSent.push(item);
        if (luxoSent.length > 5) luxoSent.shift();
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

        ['openVideo', 'legacyURL', 'legacyOpen'].forEach(function (name) {
            var fn = bridge[name];

            if (typeof fn !== 'function' || fn.easyUi) return;

            var sent = function (payload) {
                try { noteLuxoSent(name, payload); } catch (e) {}

                return fn.apply(this, arguments);
            };

            sent.easyUi = true;
            bridge[name] = sent;
        });

        return true;
    }

    // Строка на карточке: где остановились в прошлый раз
    function resumeLine(render) {
        var movie = render.data('easy-ui-movie');

        render.find('.easy-ui-resume, .easy-ui-airs').remove();

        airsLine(render, movie);

        if (!enabled(KEY.resume) || !movie || !movie.id) return;

        var last = progress().last[cardKey(movie)];
        if (!last) return;

        var spot = spotOf(last.hash);
        var done = spot.p >= DONE_PERCENT;
        var where = last.s && last.e ? 'сезон ' + last.s + ', серия ' + last.e : '';
        var time = !done && spot.t > 0 ? clock(spot.t) + (spot.d ? ' из ' + clock(spot.d) : '') : '';
        var text = '';
        var seen = loadHistory().seen[cardKey(movie)];
        var voice = seen && seen.v ? ' · ' + shortVoice(seen.v) : '';

        if (where) text = (done ? 'Последняя просмотренная: ' : 'Остановились: ') + where + (time ? ' · ' + time : '');
        else if (time) text = 'Остановились на ' + time;

        if (!text) return;

        var line = $('<div class="easy-ui-resume"></div>').text(text + voice).insertBefore(render.find('.full-start-new__buttons').first());

        // Серия досмотрена — показываем, какая дальше (последняя в сезоне — первая следующего сезона)
        if (done && last.s && last.e) {
            seasonInfo(movie, last.s, function (episodes) {
                var count = Object.keys(episodes).length;
                var next = null;

                if (count && last.e < count) next = { s: last.s, e: last.e + 1 };
                else if (count && (movie.number_of_seasons || 0) > last.s) next = { s: last.s + 1, e: 1 };

                if (next && document.body.contains(line[0])) line.text('Дальше: сезон ' + next.s + ', серия ' + next.e + voice);
            });
        }
    }

    var MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

    // Сериал ещё выходит: когда следующая серия
    function airsLine(render, movie) {
        if (!enabled(KEY.resume) || !movie || !isSeries(movie)) return;

        var next = movie.next_episode_to_air;
        var going = movie.in_production || /returning|production|planned/i.test(String(movie.status || ''));
        var text = '';

        if (next && next.air_date) {
            var parts = String(next.air_date).split('-');
            var date = parts.length === 3 ? +parts[2] + ' ' + MONTHS[+parts[1] - 1] : next.air_date;
            var which = next.season_number && next.episode_number ? ' (сезон ' + next.season_number + ', серия ' + next.episode_number + ')' : '';

            text = 'Сериал ещё выходит · следующая серия ' + date + which;
        } else if (going) {
            text = 'Сериал ещё выходит';
        }

        if (text) $('<div class="easy-ui-airs"></div>').text(text).insertBefore(render.find('.full-start-new__buttons').first());
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
            if (!e || !e.data) return;

            try { rememberLaunch(); } catch (err) {}

            if (!enabled(KEY.resume)) return;

            try { noteLaunch(e.data); } catch (err) {}
            try { noteLuxoLaunch(e.data); } catch (err) {}
            try { handoff(e.data); } catch (err) {}
            try { hookLuxo(); } catch (err) {}
        });

        try { hookLuxo(); } catch (err) {}

        // Плеер Lampa сам сохраняет место раз в 2 минуты — своя запись каждые 5 секунд
        var playing = null;
        var savedAt = 0;

        Lampa.Player.listener.follow('start', guard('место каждые 5 с', function (data) {
            playing = data && data.timeline && data.timeline.hash ? String(data.timeline.hash) : null;
            savedAt = 0;
        }));

        Lampa.PlayerVideo.listener.follow('timeupdate', guard('место каждые 5 с', function (e) {
            if (!playing || !enabled(KEY.resume) || !e || !(e.duration > 0) || !(e.current > 0)) return;
            if (Date.now() - savedAt < 5000) return;

            savedAt = Date.now();
            saveSpot(playing, e.current, e.duration, Math.round(e.current / e.duration * 100));
        }));

        // После плеера — метка и фокус на серии, которую смотрели (или на следующей)
        function afterPlayer() {
            playing = null;
            setTimeout(function () {
                try { remarkPages(); } catch (err) {}
            }, 600);
        }

        Lampa.Player.listener.follow('destroy', afterPlayer);

        document.addEventListener('visibilitychange', function () {
            if (!document.hidden) afterPlayer();
        });

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
    // Первое «Назад» на странице мода — в шапку, второе — сразу на карточку фильма.
    // Не полагаемся на «Назад» самого мода: у части модов из шапки он ничего не делает
    function backToHead() {
        if (!enabled(KEY.head)) return false;

        var p = activePage();
        if (!p) return false;

        var page = p.page();
        var focused = page.find('.selector.focus')[0];

        if (!focused) return false;

        var list = p.chips();
        var inHead = list.indexOf(focused) >= 0 || $(focused).closest('.torrent-filter').length > 0;

        try {
            if (inHead) {
                Lampa.Activity.backward();
                return true;
            }

            if (!list.length) return false;

            Lampa.Controller.collectionFocus(list[0], page[0]);
            return true;
        } catch (e) {
            return false;
        }
    }

    // Окна поверх страницы со своим «Назад» — их не трогаем
    var OWN_BACK = ['select', 'modal', 'player', 'player_panel', 'head', 'menu', 'settings', 'settings_component', 'keyboard', 'easy_ui_poster'];

    function wrapController() {
        var base = Lampa.Controller.add;

        Lampa.Controller.add = function (name, obj) {
            if (OWN_BACK.indexOf(name) < 0 && obj && typeof obj.back === 'function' && !obj.easy_ui_back) {
                var back = obj.back;

                obj.back = function () {
                    var handled = false;

                    try { handled = Lampa.Controller.enabled().name === name && backToHead(); } catch (e) {}

                    if (handled) return;
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
    function allowStep(direction, now, menu) {
        var gap = now - gesture.last;
        var holdDelay = menu ? HOLD_DELAY_MENU : HOLD_DELAY;
        var holdRepeat = menu ? HOLD_REPEAT_MENU : HOLD_REPEAT;

        gesture.last = now;

        if (gap > BURST_GAP || gap < 0) {
            gesture.start = now;
            gesture.step = now;
            gesture.direction = direction;
            return true;
        }

        if (direction !== gesture.direction) return false;
        if (now - gesture.start < holdDelay) return false;
        if (now - gesture.step < holdRepeat) return false;

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

            var menu = false;

            try { menu = Lampa.Controller.enabled().name === 'select'; } catch (err) {}

            if (!allowStep(direction, Date.now(), menu)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }, true);
    }

    /* ---------- Главная: сначала история ---------- */

    // Lampa собирает главную из рядов, которые регистрируют плагины (ContentRows).
    // Добавляем свой ряд с историей и ставим его первым; ряд плиток-кнопок
    // другого плагина (он помечен __surs_nav) на главной пропускаем.
    var HOME_ROW = 'easy_ui_history';
    var HOME_TITLE = 'История просмотра';

    function historyRow() {
        var list = [];
        try { list = Lampa.Favorite.get({ type: 'history' }) || []; } catch (e) {}
        if (!list.length) return null;

        var row = function (call) {
            call({
                results: list.slice(0, 20),
                title: HOME_TITLE,
                total_pages: Math.ceil(list.length / 20),
                page: 1,
                params: {
                    emit: {
                        onlyMore: function () {
                            Lampa.Activity.push({ url: '', title: HOME_TITLE, component: 'favorite', type: 'history', page: 1 });
                        }
                    }
                }
            });
        };
        row.easyUiHistory = true;
        return row;
    }

    function setupHome() {
        var rows = Lampa.ContentRows;
        if (!rows || typeof rows.add !== 'function' || typeof rows.call !== 'function' || rows.call.easyUi) return;

        rows.add({
            name: HOME_ROW,
            title: HOME_TITLE,
            index: 0,
            screen: ['main'],
            call: function () {
                return enabled(KEY.home) ? historyRow() : null;
            }
        });

        var original = rows.call;
        var wrapped = function (screen, params, calls) {
            var result = original.apply(this, arguments);

            try {
                if (screen === 'main' && enabled(KEY.home) && calls && calls.splice) {
                    var mine = null;
                    for (var i = calls.length - 1; i >= 0; i--) {
                        var item = calls[i];
                        if (item && item.__surs_nav) calls.splice(i, 1);
                        else if (item && item.easyUiHistory) { mine = item; calls.splice(i, 1); }
                    }
                    if (mine) calls.unshift(mine);
                }
            } catch (e) {}

            return result;
        };
        wrapped.easyUi = true;
        rows.call = wrapped;
    }

    // Возврат с карточки на главную — фокус на том же постере
    var mainFocus = null;

    function watchMainFocus() {
        document.addEventListener('hover:focus', function (e) {
            try {
                var card = e.target && e.target.closest ? e.target.closest('.card') : null;
                var active = Lampa.Activity.active();

                if (card && active && active.component === 'main') mainFocus = card;
            } catch (err) {}
        }, true);

        Lampa.Listener.follow('activity', guard('фокус на главной', function (e) {
            if (e.type !== 'start' || e.component !== 'main' || !mainFocus) return;

            var target = mainFocus;

            setTimeout(function () {
                try {
                    if (!document.body.contains(target) || $(target).hasClass('focus')) return;
                    if (Lampa.Activity.active().component !== 'main') return;

                    Lampa.Controller.collectionFocus(target, e.object.activity.render()[0]);
                } catch (err) {}
            }, 300);
        }));
    }

    /* ---------- Все озвучки сразу (фильмы) ---------- */

    // «Смотреть» у фильма → окно вариантов: «Фильм — поставщик», качество, озвучки тегами.
    // Сверху — хорошее качество с наибольшим числом русских озвучек внутри одного видео:
    // их потом можно переключать прямо в меню звука плеера. Поиск начинается при открытии карточки.
    var VOICES_SERVERS = ['https://lam.akter-black.com/', 'http://smotret24.ru/'];
    // Торренты (MKV плеер не играет), иностранные и закрытые балансеры не берём
    var VOICES_SKIP = /torr|pidt|eng\)|украин|грузин|geosait|uakino|vidsrc|vidlink|videasy|movpi|smashy|kinogo/i;
    var VOICES_NOT_RU = /\b(eng|ukr|укр|por|spa|fre|ger|ita|jpn|kor|chi|tur|kaz|geo)\b|original|оригинал|украин|англ/i;
    var VOICES_CAM = /\b(ts|tc|cam|camrip|telesync|hdts|hdcam)\b|экранк/i;
    var VOICES_KIND = /(^|\s)(авторский|авторская|многоголосый|многоголосая|одноголосый|одноголосая|двухголосый|двухголосая|закадровый|профессиональный|любительский|студия|озвучка|перевод|лицензия|blu-?ray|official)(?=[\s.,]|$)\.?/gi;

    var voicesStore = {};
    var voicesUid = 'eu' + Math.random().toString(36).slice(2, 10);

    function motion() {
        var m = Lampa.Storage.get('easy_ui_motion', 'full') + '';
        return m === 'light' || m === 'off' ? m : 'full';
    }

    function voicesQuery(m) {
        return [
            'id=' + encodeURIComponent(m.id),
            m.imdb_id ? 'imdb_id=' + m.imdb_id : '',
            m.kinopoisk_id ? 'kinopoisk_id=' + m.kinopoisk_id : '',
            'title=' + encodeURIComponent(m.title || m.name || ''),
            'original_title=' + encodeURIComponent(m.original_title || m.original_name || ''),
            'serial=0',
            'original_language=' + (m.original_language || ''),
            'year=' + ((m.release_date || '0000') + '').slice(0, 4),
            'source=tmdb', 'clarification=0', 'similar=false', 'rchtype=web', 'uid=' + voicesUid
        ].filter(Boolean).join('&');
    }

    function xget(url, done) {
        var x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.timeout = 7000;
        x.onload = function () { done(x.status === 200 ? x.responseText : null); };
        x.onerror = x.ontimeout = function () { done(null); };
        try { x.send(); } catch (e) { done(null); }
    }

    // Начало ответа: HLS-список или сам видеофайл (тогда сразу обрываем)
    function xprobe(url, done) {
        var x = new XMLHttpRequest(), fin = false;
        function end(r) { if (!fin) { fin = true; done(r); } }
        x.open('GET', url, true);
        x.timeout = 5000;
        x.onreadystatechange = function () {
            if (x.readyState >= 2 && !fin) {
                var ct = (x.getResponseHeader('content-type') || '') + '';
                if (/video|octet/i.test(ct)) { end({ file: true }); try { x.abort(); } catch (e) {} }
            }
        };
        x.onload = function () {
            var t = x.responseText || '';
            end(t.indexOf('#EXTM3U') === 0 ? { m3u: t, base: x.responseURL || url } : { file: true });
        };
        x.onerror = x.ontimeout = function () { end(null); };
        try { x.send(); } catch (e) { end(null); }
    }

    function parseJson(text) { try { return JSON.parse(text); } catch (e) { return null; } }

    function addQuery(url, q) { return url + (url.indexOf('?') < 0 ? '?' : '&') + q; }

    function videoHeight(q) {
        q = (q || '') + '';
        if (/2160|4k|uhd/i.test(q)) return 2160;
        if (/1440/.test(q)) return 1440;
        if (/1080|fhd/i.test(q)) return 1080;
        if (/720|hd/i.test(q)) return 720;
        if (/480/.test(q)) return 480;
        if (/360/.test(q)) return 360;
        return 0;
    }

    function heightLabel(h) { return h >= 2160 ? '4K' : h ? h + 'p' : ''; }

    function balancerName(name) {
        return (name || '').replace(/<[^>]+>/g, '').replace(/\s*[~\-–].*$/, '').replace(/\s*\(.*\)\s*$/, '').trim();
    }

    function cleanVoice(v) {
        return (v || '').replace(/^\s*\d+\.\s*/, '').replace(/\s*\((rus|ru|рус)\)(\s*(ac3|aac|5\.1|2\.0|dts))*\s*$/i, '').replace(/\s+/g, ' ').trim();
    }

    function escapeHtml(s) { return (s + '').replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    // «Авторский. Ю. Сербин» → «Сербин», «Многоголосый. Омикрон» → «Омикрон», дубляжи — «Дубляж #1», «#2»
    function shortVoice(v) {
        var src = (v || '').replace(/\([^)]*\)/g, ' ').replace(/[«»"]/g, '').trim();
        if (/^ещё \d+/.test(src)) return src;
        if (/дубл|dub/i.test(src)) return 'Дубляж';
        var rest = src.replace(VOICES_KIND, ' ').replace(/^[\s.,:-]+|[\s.,:-]+$/g, '').replace(/\s+/g, ' ');
        if (!rest) return (src.split(/[\s.]/)[0] || 'Озвучка').replace(/^./, function (c) { return c.toUpperCase(); });
        var words = rest.split(' ');
        if (words.length === 2 && (/^[А-ЯЁA-Z]\.$/.test(words[0]) || /^[А-ЯЁ][а-яё]+$/.test(words[0]) && /^[А-ЯЁ][а-яё]+$/.test(words[1]))) return words[1];
        if (words.length === 3 && /^[А-ЯЁA-Z]\.$/.test(words[0]) && /^[А-ЯЁA-Z]\.$/.test(words[1])) return words[2];
        return rest.length > 22 ? rest.slice(0, 21) + '…' : rest;
    }

    function shortVoices(list) {
        var names = list.map(shortVoice), total = {}, n = {};
        names.forEach(function (x) { total[x] = (total[x] || 0) + 1; });
        return names.map(function (x) {
            if (total[x] < 2) return x;
            n[x] = (n[x] || 0) + 1;
            return x + ' #' + n[x];
        });
    }

    function voicesPlural(n) {
        var a = n % 10, b = n % 100;
        if (a === 1 && b !== 11) return 'озвучка';
        if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return 'озвучки';
        return 'озвучек';
    }

    function voicesDone(rec) {
        rec.pending--;
        rec.listeners.forEach(function (l) { try { l(); } catch (e) {} });
    }

    function russianTrack(name, lang) {
        if (lang && !/^ru/i.test(lang)) return false;
        return !(VOICES_NOT_RU.test(name) && !/рус|rus/i.test(name));
    }

    // Разбор ответа балансера: строки .videos__item с data-json
    function parseVoices(html, src, rec, depth) {
        var rows = [];
        try {
            $('<div>' + html + '</div>').find('.videos__item').each(function () {
                var d = parseJson($(this).attr('data-json') || '') || {};
                rows.push({ d: d, text: ($(this).find('.videos__item-title').text() || $(this).text() || '').replace(/\s+/g, ' ').trim() });
            });
        } catch (e) {}

        rows.forEach(function (r) {
            var d = r.d;
            if (!d.url || d.similar) return;

            if (d.method === 'link') {
                if (depth < 1) {
                    rec.pending++;
                    xget(d.url, function (t) { if (t) parseVoices(t, src, rec, depth + 1); voicesDone(rec); });
                }
                return;
            }
            if (d.method !== 'play' && d.method !== 'call') return;

            var voice = cleanVoice(d.translate || d.voice_name || r.text || 'Озвучка');
            if (/украин|ukr|субтитр/i.test(voice)) return;

            // VK и Rutube — ролики пользователей: берём по одному
            if (/vk|rutube/i.test(src)) {
                if (rec.items.some(function (i) { return i.src === src; })) return;
                voice = 'ролик';
            }

            var keys = d.quality ? Object.keys(d.quality) : [];
            keys.sort(function (a, b) { return videoHeight(b) - videoHeight(a); });
            var quality = d.maxquality || keys[0] || '';
            if (/\b4k\b|2160/i.test(voice + ' ' + r.text) && videoHeight(quality) < 2160) quality = '2160p';
            voice = voice.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim() || 'Озвучка';

            var key = src + '|' + voice;
            if (rec.items.some(function (i) { return i.key === key; })) return;

            var item = {
                key: key, src: src, voice: voice, quality: quality,
                cam: VOICES_CAM.test(voice + ' ' + quality + ' ' + r.text),
                method: d.method, url: d.url, qualities: d.quality || null, subtitles: d.subtitles || null
            };
            rec.items.push(item);
            inspectVoices(item, rec);
        });
    }

    function resolveVoice(item, cb) {
        if (item.method === 'play') return cb({ url: item.url, quality: item.qualities, subtitles: item.subtitles });
        xget(item.url, function (text) {
            var j = parseJson(text);
            cb(j && j.url ? { url: j.url, quality: j.quality || null, subtitles: j.subtitles || null } : null);
        });
    }

    // Что внутри видео: сколько русских озвучек и какое качество
    function inspectVoices(item, rec) {
        rec.pending++;
        resolveVoice(item, function (link) {
            if (!link) return voicesDone(rec);
            xprobe(link.url, function (p) {
                if (!p) return voicesDone(rec);

                var v = { src: item.src, item: item, link: link, cam: item.cam, voices: [], h: videoHeight(item.quality), count: 0, named: 0 };

                if (p.m3u) {
                    var n = 0, unnamed = 0;
                    v.m3u = p.m3u;
                    v.base = p.base;
                    p.m3u.split('\n').forEach(function (line) {
                        if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/.test(line)) {
                            var name = (line.match(/NAME="([^"]*)"/) || [])[1] || '';
                            var lang = (line.match(/LANGUAGE="([^"]*)"/) || [])[1] || '';
                            if (!russianTrack(name, lang)) return;
                            n++;
                            if (/^rus?\d*$/i.test(name.trim())) {
                                // Безымянные дорожки (rus0, rus1…): первая — та, что назвал сервер
                                if (n === 1) name = item.voice;
                                else { unnamed++; return; }
                            } else name = cleanVoice(name);
                            if (v.voices.indexOf(name) < 0) v.voices.push(name);
                        }
                        var res = line.match(/RESOLUTION=\d+x(\d+)/);
                        if (res && +res[1] > v.h) v.h = +res[1];
                    });
                    v.named = v.voices.length;
                    v.count = v.voices.length + unnamed;
                    if (unnamed) v.voices.push('ещё ' + unnamed + ' без названия');
                    if (VOICES_CAM.test(p.m3u.slice(0, 3000))) v.cam = true;
                }
                if (!v.voices.length) {
                    if (VOICES_NOT_RU.test(item.voice) && !/рус/i.test(item.voice)) return voicesDone(rec);
                    v.voices.push(item.voice);
                }
                if (!v.count) v.count = v.voices.length;
                if (!v.named) v.named = v.voices.length;

                // Одно и то же видео с двух серверов — оставляем лучшее
                var sig = v.src + '|' + v.voices.join(',');
                var same = rec.variants.filter(function (o) { return o.src + '|' + o.voices.join(',') === sig; })[0];
                if (!same) rec.variants.push(v);
                else if (v.h > same.h) rec.variants[rec.variants.indexOf(same)] = v;

                rec.variants.sort(function (a, b) { return (a.cam - b.cam) || (b.named - a.named) || (b.h - a.h); });
                voicesDone(rec);
            });
        });
    }

    // Список балансеров сервера. Просим «живой» режим: сервер отдаёт балансеры по мере проверки,
    // и мы сразу берём каждый новый, а не ждём 8–10 секунд, пока сервер проверит все.
    // each(b) вызывается один раз на балансер (вернуть true — взят), end() — когда сервер закончил.
    function voicesBalancers(host, q, each, end) {
        var taken = {}, finished = false;
        function feed(list) {
            (list || []).forEach(function (b) {
                if (!b || !b.url || taken[b.url]) return;
                if (b.show === false || VOICES_SKIP.test((b.name || '').replace(/<[^>]+>/g, ''))) return;
                taken[b.url] = true;
                each(b);
            });
        }
        function done() { if (!finished) { finished = true; end(); } }

        xget(host + 'lite/events?' + q + '&life=true', function (text) {
            var j = parseJson(text);
            if (!j) return done();
            if (Array.isArray(j)) { feed(j); return done(); }
            feed(j.online);
            if (!j.life || !j.memkey) return done();

            var n = 0;
            (function poll() {
                xget(host + 'lifeevents?memkey=' + encodeURIComponent(j.memkey) + '&' + q, function (t) {
                    var k = parseJson(t);
                    n++;
                    if (k) feed(k.online);
                    if ((k && k.ready) || n >= 20) return done();
                    setTimeout(poll, 600);
                });
            })();
        });
    }

    function collectVoices(movie) {
        var id = movie.id;
        var old = voicesStore[id];
        // Ссылки на видео живут недолго: через 20 минут ищем заново
        if (old && !omGone(old) && (old.pending > 0 || Date.now() - old.started < 1200000)) return old;

        var rec = voicesStore[id] = { items: [], variants: [], pending: VOICES_SERVERS.length, listeners: [], started: Date.now() };
        var q = voicesQuery(movie);

        VOICES_SERVERS.forEach(function (host) {
            voicesBalancers(host, q, function (b) {
                rec.pending++;
                xget(addQuery(b.url, q), function (html) {
                    if (html) parseVoices(html, balancerName(b.name), rec, 0);
                    voicesDone(rec);
                });
            }, function () { voicesDone(rec); });
        });
        omCollect(movie, rec, false);

        return rec;
    }

    // Список дорожек с короткими названиями озвучек — через свой сервер Cloudflare (если указан
    // в настройках). Сервер только отдаёт этот список обратно; видео идёт напрямую.
    // Без сервера плеер покажет названия, записанные в самом видео.
    function relayPlaylist(v) {
        var relay = (Lampa.Storage.get('easy_ui_relay', '') + '').trim();
        if (!relay || !v.m3u) return '';
        if (!/\/$/.test(relay)) relay += '/';

        var names = shortVoices(v.voices.filter(function (x) { return !/^ещё \d+/.test(x); }));
        var i = 0, kept = 0, hadDefault = false;
        function abs(u) { try { return new URL(u, v.base).toString(); } catch (e) { return u; } }

        var lines = v.m3u.split('\n').map(function (line) {
            line = line.replace(/\r$/, '');
            if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/.test(line)) {
                var name = (line.match(/NAME="([^"]*)"/) || [])[1] || '';
                var lang = (line.match(/LANGUAGE="([^"]*)"/) || [])[1] || '';
                if (russianTrack(name, lang)) {
                    kept++;
                    var plain = /^rus?\d*$/i.test(name.trim());
                    // Безымянные дорожки, кроме первой, оставляем как есть
                    if ((!plain || i === 0) && i < names.length) line = line.replace(/NAME="[^"]*"/, 'NAME="' + names[i++].replace(/"/g, '') + '"');
                }
                if (/DEFAULT=YES/.test(line)) hadDefault = true;
            }
            line = line.replace(/URI="([^"]+)"/g, function (m, u) { return 'URI="' + abs(u) + '"'; });
            if (line && line.charAt(0) !== '#') line = abs(line.trim());
            return line;
        });
        if (!kept || !hadDefault) return '';

        var packed;
        try {
            packed = btoa(unescape(encodeURIComponent(lines.join('\n')))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        } catch (e) { return ''; }
        // Слишком длинный адрес сервер не примет — тогда как есть
        if (packed.length > 12000) return '';
        return relay + 'm3u/' + packed + '/index.m3u8';
    }

    // Сервер проверяем один раз: если он не отвечает как надо, играем без него
    var relayState = {};

    function relayWorks(relay, done) {
        if (relay in relayState) return done(relayState[relay]);
        var x = new XMLHttpRequest(), fin = false;
        function end(ok) { if (!fin) { fin = true; relayState[relay] = ok; done(ok); } }
        x.open('GET', relay + (/\/$/.test(relay) ? '' : '/') + 'm3u/I0VYVE0zVQo/index.m3u8', true);
        x.timeout = 4000;
        x.onload = function () { end(x.status === 200 && (x.responseText || '').indexOf('#EXTM3U') === 0); };
        x.onerror = x.ontimeout = function () { end(false); };
        try { x.send(); } catch (e) { end(false); }
    }

    function playVariant(movie, v) {
        if (v.om) return omPlayVariant(v);
        var data = { title: (movie.title || movie.name) + ' — ' + v.src, url: v.link.url };
        // Для HLS отдаём весь список: в нём озвучки, их покажет меню звука плеера
        if (!v.m3u && v.link.quality && typeof v.link.quality === 'object') data.quality = v.link.quality;
        if (v.link.subtitles) data.subtitles = v.link.subtitles;

        var renamed = relayPlaylist(v);
        if (!renamed) return Lampa.Player.play(data);

        relayWorks((Lampa.Storage.get('easy_ui_relay', '') + '').trim(), function (ok) {
            if (ok) data.url = renamed;
            Lampa.Player.play(data);
        });
    }

    // Строка варианта: «Название — поставщик», плашка качества, число озвучек, озвучки плашками.
    // Одна и та же у фильма и у сериала, чтобы окна выглядели одинаково
    function fillVariant(el, title, v, extra) {
        var q = heightLabel(v.h);
        el.empty();
        el.append($('<div class="easy-voices-row__title"></div>').text(title));
        el.append('<div class="easy-voices-row__meta"><span class="easy-voices-q' + (v.cam ? ' cam' : '') + '">' + (v.cam ? 'Экранка' : 'Хорошее') + (q ? ' · ' + q : '') + '</span>' + v.count + ' ' + voicesPlural(v.count) + (extra ? ' · ' + escapeHtml(extra) : '') + '</div>');
        el.append('<div class="easy-voices-tags">' + shortVoices(v.voices).map(function (t) { return '<span class="easy-voices-tag">' + escapeHtml(t) + '</span>'; }).join('') + '</div>');
    }

    // Окно вариантов — как список серий: слева сводка о фильме, справа варианты
    function VoicesComponent(object) {
        var movie = object.movie;
        var rec = collectVoices(movie);
        var files = new Lampa.Explorer(object);
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var status = $('<div class="easy-voices__status"></div>');
        var body = $('<div class="easy-voices__list"></div>');
        var rows = [];       // { v, el } — строки не пересоздаём, чтобы ничего не мигало
        var focused = null;  // строка в фокусе
        var moved = false;   // пользователь уже листал — тогда порядок и фокус не трогаем
        var active = false;
        var timer = null;

        function row(v) {
            var el = $('<div class="easy-voices-row selector' + (motion() !== 'off' ? ' easy-voices-new' : '') + '"></div>');
            fillVariant(el, (movie.title || movie.name || '') + ' — ' + v.src, v, '');
            el.on('hover:focus', function () { focused = el[0]; scroll.update(el, true); });
            el.on('hover:enter', function () { playVariant(movie, v); });
            // Иначе при перестановке строк анимация появления повторится
            setTimeout(function () { el.removeClass('easy-voices-new'); }, 600);
            return el;
        }

        function draw() {
            // Убираем заменённые варианты (тот же, но в лучшем качестве)
            rows = rows.filter(function (r) {
                if (rec.variants.indexOf(r.v) >= 0) return true;
                if (focused === r.el[0]) focused = null;
                r.el.remove();
                return false;
            });
            var had = rows.length;
            rec.variants.forEach(function (v) {
                if (!rows.some(function (r) { return r.v === v; })) rows.push({ v: v, el: row(v) });
            });
            if (!moved) {
                // Пока не листали — лучшие сверху
                rows.sort(function (a, b) { return rec.variants.indexOf(a.v) - rec.variants.indexOf(b.v); });
                rows.forEach(function (r) { body.append(r.el); });
            } else {
                // Листают — новые только в конец, остальные стоят на месте
                rows.slice(had).forEach(function (r) { body.append(r.el); });
            }
            status.toggleClass('easy-voices__status--busy', rec.pending > 0);
            status.text(rec.pending > 0 ? 'Ищем на всех серверах… найдено: ' + rec.variants.length : (rec.variants.length ? 'Найдено вариантов: ' + rec.variants.length : 'Вариантов не нашлось — откройте «Источники»'));
            if (active && Lampa.Controller.enabled().name === 'content') focus();
        }

        function focus() {
            var target = moved && focused && document.body.contains(focused) ? focused : body.children()[0];
            Lampa.Controller.collectionSet(scroll.render(), files.render());
            Lampa.Controller.collectionFocus(target || false, scroll.render());
        }

        function changed() {
            // Реже перерисовываем, чтобы фокус не дёргался
            if (timer) return;
            timer = setTimeout(function () { timer = null; draw(); }, 700);
        }

        this.create = function () {
            scroll.append(status);
            scroll.append(body);
            files.appendFiles(scroll.render());
            files.render().addClass('easy-voices');
            rec.listeners.push(changed);
            draw();
            return this.render();
        };

        this.start = function () {
            active = true;
            Lampa.Controller.add('content', {
                toggle: focus,
                up: function () { moved = true; if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { moved = true; Navigator.move('down'); },
                left: function () { if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function () { Navigator.move('right'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () { active = false; };
        this.stop = function () { active = false; };
        this.render = function () { return files.render(); };
        this.destroy = function () {
            active = false;
            clearTimeout(timer);
            var i = rec.listeners.indexOf(changed);
            if (i >= 0) rec.listeners.splice(i, 1);
            scroll.destroy();
            files.destroy();
        };
    }

    function openVoices(movie) {
        Lampa.Activity.push({ url: '', title: movie.title || movie.name || '', component: 'easy_voices', movie: movie, page: 1 });
    }

    /* ---------- Все серверы в сериалах ---------- */

    // «Смотреть» у сериала → окно: слева сводка, сверху «Сезон» и «Источник — озвучка»,
    // ниже серии плиткой. Источники и озвучки — со всех бесплатных серверов сразу.
    var seriesStore = {};

    function seasonOf(text, url) {
        var m = (text || '').match(/(\d+)\s*сезон/i) || (text || '').match(/сезон\s*(\d+)/i) || (url || '').match(/[?&]s=(\d+)/);
        return m ? +m[1] : 0;
    }

    function seriesQuery(m) {
        return voicesQuery(m).replace('serial=0', 'serial=1')
            .replace(/year=[^&]*/, 'year=' + ((m.first_air_date || m.release_date || '0000') + '').slice(0, 4))
            .replace(/original_title=[^&]*/, 'original_title=' + encodeURIComponent(m.original_name || m.original_title || ''));
    }

    // Строки страницы балансера: сезоны, кнопки озвучек, серии
    function pageRows(html) {
        var out = { seasons: [], buttons: [], episodes: [] };
        try {
            $('<div>' + html + '</div>').find('.videos__item, .videos__button').each(function () {
                var el = $(this);
                var d = parseJson(el.attr('data-json') || '') || {};
                var text = (el.find('.videos__item-title').text() || el.text() || '').replace(/\s+/g, ' ').trim();
                if (!d.url) return;
                if (el.hasClass('videos__season')) out.seasons.push({ s: seasonOf(text, d.url), url: d.url });
                else if (el.hasClass('videos__button')) out.buttons.push({ text: text, url: d.url, active: el.hasClass('active') });
                else if (el.attr('e') && (d.method === 'play' || d.method === 'call')) {
                    out.episodes.push({ s: +el.attr('s') || 0, e: +el.attr('e'), d: d, text: text });
                }
            });
        } catch (e) {}
        return out;
    }

    function seriesDone(rec) {
        rec.pending--;
        rec.listeners.forEach(function (l) { try { l(); } catch (e) {} });
    }

    function collectSeries(movie) {
        var id = movie.id;
        var old = seriesStore[id];
        if (old && !omGone(old) && (old.pending > 0 || Date.now() - old.started < 1200000)) return old;

        var rec = seriesStore[id] = { started: Date.now(), pending: VOICES_SERVERS.length, listeners: [], sources: [], seasons: {}, data: {} };
        var q = seriesQuery(movie);

        VOICES_SERVERS.forEach(function (host) {
            voicesBalancers(host, q, function (b) {
                {
                    rec.pending++;
                    xget(addQuery(b.url, q), function (html) {
                        if (html) {
                            var rows = pageRows(html);
                            var src = { name: balancerName(b.name), seasons: {} };
                            rows.seasons.forEach(function (x) { if (x.s) src.seasons[x.s] = x.url; });
                            // Сезонов нет, а серии есть — это и есть сезон
                            if (!rows.seasons.length && rows.episodes.length) src.seasons[rows.episodes[0].s || 1] = { html: html };
                            if (Object.keys(src.seasons).length) {
                                rec.sources.push(src);
                                Object.keys(src.seasons).forEach(function (s) { rec.seasons[s] = true; });
                                // Если сезон уже открыт — догружаем и этот источник
                                Object.keys(rec.data).forEach(function (s) { if (src.seasons[s]) loadSeasonSource(rec, +s, src); });
                            }
                        }
                        seriesDone(rec);
                    });
                }
            }, function () { seriesDone(rec); });
        });
        omCollect(movie, rec, true);

        return rec;
    }

    // Варианты одного сезона: «источник — озвучка» со своим списком серий
    function seasonData(rec, s) {
        if (!rec.data[s]) {
            rec.data[s] = { variants: [] };
            rec.sources.forEach(function (src) { if (src.seasons[s]) loadSeasonSource(rec, s, src); });
        }
        return rec.data[s];
    }

    function loadSeasonSource(rec, s, src) {
        var link = src.seasons[s];
        var key = 'loaded_' + s;
        if (src[key]) return;
        src[key] = true;
        if (src.om) return omLoadSeason(rec, s, src);

        function take(html, voice) {
            var rows = pageRows(html);
            var eps = rows.episodes.filter(function (x) { return !x.s || x.s === s; });
            var active = rows.buttons.filter(function (b) { return b.active; })[0];

            if (!voice && rows.buttons.length) {
                // Кнопки озвучек: эта страница — для активной, остальные догружаем
                voice = active ? active.text : '';
                rows.buttons.forEach(function (b) {
                    if (b === active) return;
                    rec.pending++;
                    xget(b.url, function (t) { if (t) take(t, b.text || 'Озвучка'); seriesDone(rec); });
                });
            }
            if (eps.length) addSeasonVariant(rec, s, src.name, voice, eps);
        }

        if (link.html) return take(link.html, '');
        rec.pending++;
        xget(link, function (html) { if (html) take(html, ''); seriesDone(rec); });
    }

    function addSeasonVariant(rec, s, srcName, voice, eps) {
        var data = rec.data[s];
        var first = eps[0].d;
        voice = cleanVoice(voice || first.translate || first.voice_name || '');
        if (voice && /украин|ukr|субтитр/i.test(voice)) return;
        if (voice && VOICES_NOT_RU.test(voice) && !/рус/i.test(voice)) return;

        var keys = first.quality ? Object.keys(first.quality) : [];
        keys.sort(function (a, b) { return videoHeight(b) - videoHeight(a); });

        var v = {
            src: srcName, voices: voice ? [voice.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim()] : [], count: voice ? 1 : 0, named: voice ? 1 : 0,
            h: videoHeight(first.maxquality || keys[0] || ''), cam: VOICES_CAM.test(voice + ' ' + eps[0].text),
            episodes: {}
        };
        eps.forEach(function (x) { v.episodes[x.e] = x.d; });
        v.total = Object.keys(v.episodes).length;

        var sig = v.src + '|' + v.voices.join(',');
        if (data.variants.some(function (o) { return o.src + '|' + o.voices.join(',') === sig; })) return;
        data.variants.push(v);
        sortSeason(data);

        // Без названия озвучки — смотрим, что внутри первой серии (часто там все озвучки сразу)
        if (!v.voices.length || first.method === 'play') inspectEpisode(rec, data, v, eps[0].d);
    }

    function sortSeason(data) {
        data.variants.sort(function (a, b) {
            return (a.cam - b.cam) || (b.named - a.named) || (b.total - a.total) || (b.h - a.h);
        });
    }

    function inspectEpisode(rec, data, v, d) {
        rec.pending++;
        resolveVoice({ method: d.method, url: d.url, qualities: d.quality, subtitles: d.subtitles }, function (link) {
            if (!link) return seriesDone(rec);
            xprobe(link.url, function (p) {
                if (p && p.m3u) {
                    var names = [], unnamed = 0;
                    p.m3u.split('\n').forEach(function (line) {
                        if (/^#EXT-X-MEDIA:.*TYPE=AUDIO/.test(line)) {
                            var name = (line.match(/NAME="([^"]*)"/) || [])[1] || '';
                            var lang = (line.match(/LANGUAGE="([^"]*)"/) || [])[1] || '';
                            if (!russianTrack(name, lang)) return;
                            if (/^rus?\d*$/i.test(name.trim())) { if (names.length || unnamed) unnamed++; else names.push(v.voices[0] || 'Русская'); }
                            else { name = cleanVoice(name); if (names.indexOf(name) < 0) names.push(name); }
                        }
                        var res = line.match(/RESOLUTION=\d+x(\d+)/);
                        if (res && +res[1] > v.h) v.h = +res[1];
                    });
                    if (names.length > v.voices.length) {
                        v.voices = names;
                        v.named = names.length;
                    }
                    v.count = Math.max(v.count, names.length + unnamed);
                    if (unnamed) v.voices = v.voices.concat(['ещё ' + unnamed + ' без названия']);
                    v.multi = true;
                }
                if (!v.voices.length) { v.voices = ['Озвучка']; v.count = v.named = 1; }
                sortSeason(data);
                seriesDone(rec);
            });
        });
    }

    function episodeHash(movie, s, e) {
        return Lampa.Utils.hash([s, s > 10 ? ':' : '', e, movie.original_name || movie.original_title || ''].join(''));
    }

    function playEpisode(movie, s, e, v) {
        var d = v.episodes[e];
        if (!d) return;
        if (v.om) return omPlayEpisode(movie, s, e, v);
        resolveVoice({ method: d.method, url: d.url, qualities: d.quality, subtitles: d.subtitles }, function (link) {
            if (!link) return say('Серия не открылась — выберите другой источник');

            var data = {
                title: (movie.name || movie.title) + ' — ' + s + ' сезон, ' + e + ' серия · ' + v.src,
                url: link.url
            };
            try {
                progress().last[cardKey(movie)] = { hash: String(episodeHash(movie, s, e)), s: s, e: e, u: Date.now() };
                saveProgressSoon();
            } catch (err) {}
            try { data.timeline = Lampa.Timeline.view(episodeHash(movie, s, e)); } catch (err) {}
            if (link.subtitles) data.subtitles = link.subtitles;

            var relay = (Lampa.Storage.get('easy_ui_relay', '') + '').trim();
            if (!relay) {
                if (link.quality && typeof link.quality === 'object') data.quality = link.quality;
                return Lampa.Player.play(data);
            }
            // Короткие названия озвучек в меню плеера — как у фильмов
            xprobe(link.url, function (p) {
                if (!p || !p.m3u) {
                    if (link.quality && typeof link.quality === 'object') data.quality = link.quality;
                    return Lampa.Player.play(data);
                }
                var renamed = relayPlaylist({ m3u: p.m3u, base: p.base, voices: v.voices });
                if (!renamed) return Lampa.Player.play(data);
                relayWorks(relay, function (ok) {
                    if (ok) data.url = renamed;
                    Lampa.Player.play(data);
                });
            });
        });
    }

    function SeriesComponent(object) {
        var movie = object.movie;
        var rec = collectSeries(movie);
        var files = new Lampa.Explorer(object);
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var head = $('<div class="easy-ui-head easy-series__head"></div>');
        var seasonBtn = $('<div class="simple-button simple-button--filter selector easy-ui-chip"><span>Сезон</span><div class="easy-series__value"></div></div>');
        var voiceBtn = $('<div class="simple-button simple-button--filter selector easy-ui-chip"><span>Озвучка</span><div class="easy-series__value"></div></div>');
        var sourceBtn = $('<div class="easy-voices-row selector easy-series__source"></div>');
        var status = $('<div class="easy-voices__status"></div>');
        var tiles = [];
        var season = 0;
        var picked = null;     // выбранный вручную вариант (src|озвучки)
        var last = null;
        var active = false;
        var timer = null;
        var drawnKey = '';
        var moved = false;     // пользователь уже нажимал пульт — тогда источник и фокус не меняем

        head.append(seasonBtn).append(voiceBtn);

        function seasons() {
            var list = Object.keys(rec.seasons).map(Number).filter(Boolean);
            if (!list.length && movie.number_of_seasons) for (var i = 1; i <= movie.number_of_seasons; i++) list.push(i);
            return list.sort(function (a, b) { return a - b; });
        }

        // Где остановились: та же запись, что строка «Остановились / Дальше» на карточке
        function resumeSpot() {
            var last = progress().last[cardKey(movie)];
            if (!last || !last.s || !last.e) return null;
            return { s: last.s, e: last.e, done: spotOf(last.hash).p >= DONE_PERCENT };
        }

        function startSeason() {
            var list = seasons();
            if (!list.length) return 0;
            var spot = resumeSpot();
            if (spot && list.indexOf(spot.s) >= 0) return spot.s;
            // Сезон, где остановились: последний с начатой серией
            var best = list[0];
            list.forEach(function (s) {
                for (var e = 1; e <= 40; e++) {
                    try { if (Lampa.Timeline.view(episodeHash(movie, s, e)).percent > 0) best = s; } catch (err) {}
                }
            });
            return best;
        }

        function current() {
            var data = rec.data[season];
            if (!data || !data.variants.length) return null;
            if (picked) {
                var same = data.variants.filter(function (v) { return v.src + '|' + v.voices[0] === picked; })[0];
                if (same) return same;
            }
            return data.variants[0];
        }

        function chips() {
            seasonBtn.find('.easy-series__value').text(season ? season + ' сезон' : '…');
            var cur = current();
            voiceBtn.find('.easy-series__value').text(cur ? shortVoices(cur.voices.filter(function (x) { return !/^ещё \d+/.test(x); })).slice(0, 2).join(', ') + ' · ' + cur.src : '…');
            var v = current();
            var data = rec.data[season];
            var more = data && data.variants.length > 1 ? 'ещё вариантов: ' + (data.variants.length - 1) + ' — нажмите' : '';
            if (v) fillVariant(sourceBtn, (movie.name || movie.title || '') + ' — ' + v.src, v, more);
            else sourceBtn.empty().append($('<div class="easy-voices-row__title"></div>').text('Ищем источник…'));
            sourceBtn.toggleClass('hide', !v).toggleClass('selector', !!v);
        }

        function draw() {
            if (!season) season = startSeason();
            if (season) seasonData(rec, season);
            var v = current();
            // Пользователь уже смотрит на серии этого источника — не подменяем его найденным позже
            if (moved && v && !picked) picked = v.src + '|' + v.voices[0];
            chips();
            var data = rec.data[season];
            status.toggleClass('easy-voices__status--busy', rec.pending > 0);
            status.text(rec.pending > 0 ? 'Ищем на всех серверах… вариантов: ' + (data ? data.variants.length : 0) : (v ? '' : 'Серий не нашлось — откройте «Источники»'));
            status.toggleClass('hide', !status.text());

            var key = season + '|' + (v ? v.src + v.voices.join() + v.total : '');
            if (key === drawnKey) return;
            drawnKey = key;

            // Фокус был на серии — после перерисовки вернём на ту же серию
            var keepEp = 0;
            tiles.forEach(function (t) { if (t[0] === last) keepEp = +t.attr('data-ep'); });
            tiles.forEach(function (t) { t.remove(); });
            tiles = [];
            if (!v) { if (active) focus(); return; }

            var nums = Object.keys(v.episodes).map(Number).sort(function (a, b) { return a - b; });
            var target = null;
            var spot = resumeSpot();
            // Досмотрели серию — фокус на следующую, нет — на ту же
            var want = spot && spot.s === season ? (spot.done ? spot.e + 1 : spot.e) : 0;
            if (want && nums.indexOf(want) < 0) want = 0;
            nums.forEach(function (e) {
                var hash = episodeHash(movie, season, e);
                var view = spotOf(hash);
                var row = $('<div class="online selector easy-ui-tile easy-series__tile easy-series__tile--wait"><div class="online__body"></div></div>').attr('data-ep', e);
                var thumb = $('<div class="easy-ui-thumb easy-ui-thumb--empty"><div class="easy-ui-thumb__num"></div></div>');
                thumb.attr('data-num', e).find('.easy-ui-thumb__num').text(e);
                if (movie.backdrop_path) $('<div class="easy-ui-thumb__bg"></div>').css('background-image', 'url("' + stillUrl(movie.backdrop_path) + '")').prependTo(thumb);
                row.prepend(thumb);
                row.find('.online__body').append($('<div class="easy-ui-ep"></div>').text('Серия ' + e));

                var p = view ? view.percent || 0 : 0;
                if (p >= DONE_PERCENT) { row.addClass('easy-ui-done'); $('<div class="easy-ui-mark easy-ui-mark--done">✓</div>').appendTo(thumb); }
                else if (p > 0) {
                    $('<div class="easy-ui-mark"></div>').text('начата').appendTo(thumb);
                    $('<div class="time-line"><div style="width:' + p + '%"></div></div>').appendTo(row);
                }
                if (keepEp ? e === keepEp : want ? e === want : !target && p < DONE_PERCENT) target = row;

                row.on('hover:focus', function () { last = row[0]; scroll.update(row, true); });
                row.on('hover:enter', function () { playEpisode(movie, season, e, current() || v); });
                scroll.append(row);
                tiles.push(row);
            });

            seasonInfo(movie, season, function (episodes) {
                tiles.forEach(function (row, i) {
                    var info = episodes[nums[i]];
                    if (!info) return;
                    if (info.name) row.find('.easy-ui-ep').text(nums[i] + '. ' + info.name);
                    if (info.still) {
                        var img = new Image();
                        img.onload = function () {
                            row.find('.easy-ui-thumb').removeClass('easy-ui-thumb--empty').css('background-image', 'url("' + info.still + '")').find('.easy-ui-thumb__bg').remove();
                        };
                        img.src = info.still;
                    }
                });
            });

            // Фокус на шапке не трогаем; на сериях — та же или первая непросмотренная
            if (keepEp || !moved || !last || !document.body.contains(last)) last = (target || tiles[0])[0];
            if (active && Lampa.Controller.enabled().name === 'content') focus();
            // Серии показываем, когда список уже прокручен к нужной — без скачка
            if (active) reveal();
        }

        function reveal() {
            setTimeout(function () {
                tiles.forEach(function (t) { t.removeClass('easy-series__tile--wait'); });
            }, 60);
        }

        function focus() {
            Lampa.Controller.collectionSet(scroll.render(), files.render());
            Lampa.Controller.collectionFocus(last || seasonBtn[0], scroll.render());
            reveal();
        }

        function changed() {
            if (timer) return;
            timer = setTimeout(function () { timer = null; draw(); }, 700);
        }

        seasonBtn.on('hover:enter', function () {
            var list = seasons();
            if (!list.length) return;
            var ctrl = Lampa.Controller.enabled().name;
            Lampa.Select.show({
                title: 'Сезон',
                items: list.map(function (s) { return { title: s + ' сезон', selected: s === season, s: s }; }),
                onBack: function () { Lampa.Controller.toggle(ctrl); },
                onSelect: function (it) {
                    season = it.s;
                    drawnKey = '';
                    Lampa.Controller.toggle(ctrl);
                    draw();
                }
            });
        });

        function pickSource() {
            var data = rec.data[season];
            if (!data || !data.variants.length) return;
            var cur = current();
            var ctrl = Lampa.Controller.enabled().name;
            Lampa.Select.show({
                title: 'Источник и озвучка',
                items: data.variants.map(function (v) {
                    var q = heightLabel(v.h);
                    return {
                        title: escapeHtml(v.src) + ' — ' + v.count + ' ' + voicesPlural(v.count) + ' · ' + v.total + ' сер.',
                        subtitle: '<span class="easy-voices-q' + (v.cam ? ' cam' : '') + '">' + (v.cam ? 'Экранка' : 'Хорошее') + (q ? ' · ' + q : '') + '</span>' +
                            '<div class="easy-voices-tags">' + shortVoices(v.voices).map(function (t) { return '<span class="easy-voices-tag">' + escapeHtml(t) + '</span>'; }).join('') + '</div>',
                        selected: v === cur,
                        v: v
                    };
                }),
                onBack: function () { Lampa.Controller.toggle(ctrl); },
                onSelect: function (it) {
                    picked = it.v.src + '|' + it.v.voices[0];
                    drawnKey = '';
                    Lampa.Controller.toggle(ctrl);
                    draw();
                }
            });
        }

        sourceBtn.on('hover:enter', pickSource);
        voiceBtn.on('hover:enter', pickSource);

        seasonBtn.on('hover:focus', function () { last = seasonBtn[0]; scroll.update(seasonBtn, true); });
        sourceBtn.on('hover:focus', function () { last = sourceBtn[0]; scroll.update(sourceBtn, true); });
        voiceBtn.on('hover:focus', function () { last = voiceBtn[0]; scroll.update(voiceBtn, true); });

        this.create = function () {
            scroll.append(head);
            scroll.append(status);
            scroll.append(sourceBtn);
            files.appendFiles(scroll.render());
            files.render().addClass('easy-voices easy-ui-grid easy-series');
            rec.listeners.push(changed);
            draw();
            return this.render();
        };

        this.start = function () {
            active = true;
            Lampa.Controller.add('content', {
                toggle: focus,
                up: function () { moved = true; if (Navigator.canmove('up')) Navigator.move('up'); else Lampa.Controller.toggle('head'); },
                down: function () { moved = true; Navigator.move('down'); },
                left: function () { moved = true; if (Navigator.canmove('left')) Navigator.move('left'); else Lampa.Controller.toggle('menu'); },
                right: function () { moved = true; Navigator.move('right'); },
                back: function () { Lampa.Activity.backward(); }
            });
            Lampa.Controller.toggle('content');
        };

        this.pause = function () { active = false; };
        this.stop = function () { active = false; };
        this.render = function () { return files.render(); };
        this.destroy = function () {
            active = false;
            clearTimeout(timer);
            var i = rec.listeners.indexOf(changed);
            if (i >= 0) rec.listeners.splice(i, 1);
            scroll.destroy();
            files.destroy();
        };
    }

    function openSeries(movie) {
        Lampa.Activity.push({ url: '', title: movie.name || movie.title || '', component: 'easy_series', movie: movie, page: 1 });
    }

    /* ---------- Online Mod в нашем окне ---------- */

    // Online Mod ничего не отдаёт другим плагинам. Поэтому его экран запускаем невидимым —
    // по одному на каждый его балансер — и читаем строки, которые он рисует: озвучку, качество, серии.
    // Нажатие на нашу строку нажимает его строку, и видео открывает сам Online Mod, как обычно.
    var OM_FIRST_WAIT = 20000;   // первый поиск: Кинопоиск + балансер
    var OM_WAIT = 12000;         // смена сезона или озвучки
    var OM_VOICES = 12;          // сколько озвучек одного балансера смотреть
    var omHidden = false;        // идёт создание невидимого экрана
    var omLive = [];             // фильмы, для которых экраны ещё открыты (не больше двух)

    function omClass() {
        try {
            var c = Lampa.Component.get('online_mod');
            return typeof c === 'function' ? c : null;
        } catch (e) { return null; }
    }

    // Строки Online Mod рисуются через Lampa.Template.get — запоминаем на строке её данные (сезон, серия, название)
    function omTagTemplates() {
        if (omTagTemplates.done || !Lampa.Template || typeof Lampa.Template.get !== 'function') return;
        omTagTemplates.done = true;
        var get = Lampa.Template.get;
        Lampa.Template.get = function (name, params) {
            var r = get.apply(this, arguments);
            if ((name === 'online_mod' || name === 'online_mod_folder') && r && typeof r.data === 'function' && params && typeof params === 'object') {
                try { r.data('easyOm', { folder: name !== 'online_mod', d: params }); } catch (e) {}
            }
            return r;
        };
    }

    function omGone(rec) { return !!(rec.om && rec.om.dead); }

    function omItems(run) {
        var out = [];
        try {
            run.inst.render().find('.online').each(function () {
                var t = $(this).data('easyOm');
                if (t) out.push({ el: this, folder: t.folder, d: t.d });
            });
        } catch (e) {}
        return out;
    }

    function omRows(run) { return omItems(run).filter(function (x) { return !x.folder; }); }

    function omKill(run) {
        if (!run || run.dead) return;
        run.dead = true;
        clearTimeout(run.timer);
        clearInterval(run.poll);
        var q = run.queue.splice(0);
        try { run.inst.destroy(); } catch (e) {}
        q.forEach(function (t) { try { t.cb(null); } catch (e) {} });
    }

    function omStop(entry) {
        entry.dead = true;
        entry.runs.forEach(omKill);
    }

    // Невидимый экран Online Mod на балансере bal (пусто — тот, что выбран в самом моде).
    // first(run, rows) — когда он впервые что-то показал (или не нашёл)
    function omRun(movie, bal, first) {
        var Comp = omClass();
        if (!Comp) return null;
        var run = { bal: bal, title: bal, sort: null, filters: {}, choice: {}, queue: [], busy: true, dead: false, loading: false, first: first, folderTried: false };
        var S = Lampa.Storage, get = S.get, field = S.field, Filter = Lampa.Filter, caught = null, inst = null;
        // Копия карточки: у сериала нет title, и Lampa вписала бы туда «Фильм не найден» — по нему Online Mod и искал бы
        var film = Object.assign({}, movie);
        if (!film.title) film.title = film.name || '';
        if (!film.original_title) film.original_title = film.original_name || '';
        var object = {
            url: '', title: 'Online Mod', component: 'online_mod', page: 1, movie: film,
            search: film.title, search_one: film.title, search_two: film.original_title
        };

        // Балансер Online Mod читает из настроек один раз, при создании экрана — подсовываем свой
        omHidden = true;
        if (bal) {
            S.get = function (k) { return k === 'online_mod_balanser' ? bal : get.apply(this, arguments); };
            S.field = function (k) { return k === 'online_mod_save_last_balanser' ? false : field.apply(this, arguments); };
        }
        Lampa.Filter = function (o) { caught = new Filter(o); return caught; };
        try { inst = new Comp(object); } catch (e) { inst = null; }
        S.get = get;
        S.field = field;
        Lampa.Filter = Filter;
        omHidden = false;

        if (!inst || !caught) {
            try { if (inst) inst.destroy(); } catch (e) {}
            return null;
        }
        run.inst = inst;
        run.filter = caught;

        var set = caught.set;
        caught.set = function (type, items) {
            if (type === 'sort') run.sort = items;
            return set.apply(this, arguments);
        };
        var filt = inst.filter;
        inst.filter = function (items, choice) {
            run.filters = items || {};
            run.choice = choice || {};
            return filt.apply(this, arguments);
        };
        // Выбор озвучки в нашем окне не должен менять то, что запомнил сам Online Mod,
        // и не должен закрывать открытое у человека меню
        inst.saveChoice = function () {};
        inst.closeFilter = function () {};
        inst.activity = {
            loader: function (on) {
                if (on) { run.loading = true; return; }
                run.loading = false;
                setTimeout(function () { omSettle(run); }, 50);
            },
            toggle: function () {}
        };

        omWait(run, OM_FIRST_WAIT);
        try {
            inst.checkMyIp(function () {
                if (run.dead) return;
                try { inst.create(); } catch (e) { omSettle(run); }
            });
        } catch (e) {
            try { inst.create(); } catch (e2) { omSettle(run); }
        }
        return run;
    }

    // Список дорисован: мод сказал «готово», либо строки перестали меняться, либо вышло время
    function omWait(run, ms) {
        clearInterval(run.poll);
        var last = -1, still = 0, start = Date.now();
        run.poll = setInterval(function () {
            if (run.dead) return clearInterval(run.poll);
            var n = omItems(run).length + (run.inst.render().find('.empty').length ? 1000 : 0);
            if (n && n === last && !run.loading) still++;
            else still = 0;
            last = n;
            if (still >= 3 || Date.now() - start > ms) omSettle(run);
        }, 400);
    }

    function omSettle(run) {
        if (run.dead || !run.busy) return;
        clearInterval(run.poll);
        var items = omItems(run);
        var rows = items.filter(function (x) { return !x.folder; });

        // Вместо фильма — список похожих: открываем тот, у которого то же название и тот же год
        if (!rows.length && items.length && run.first && !run.folderTried) {
            var year = +(((run.year || '') + '').slice(0, 4));
            var names = (run.names || []).map(omPlain).filter(Boolean);
            var fit = items.filter(function (x) {
                var d = x.d || {};
                var y = +(((d.year || d.start_date || d.quality || '') + '').slice(0, 4));
                var same = [d.title, d.orig_title, d.en_title, d.ru_title, d.nameRu, d.nameEn, d.nameOriginal].some(function (t) {
                    return t && names.indexOf(omPlain(t)) >= 0;
                });
                return same && year && y === year;
            });
            if (items.length === 1) fit = items;
            if (fit.length === 1) {
                run.folderTried = true;
                run.loading = false;
                try { $(fit[0].el).trigger('hover:enter'); } catch (e) {}
                return omWait(run, OM_WAIT);
            }
        }

        run.busy = false;
        var first = run.first;
        run.first = null;
        if (first) {
            var sel = (run.sort || []).filter(function (s) { return s.selected; })[0];
            if (sel) { run.bal = sel.source; run.title = sel.title; }
            try { first(run, rows); } catch (e) {}
        }
        omNext(run);
    }

    // Показать в невидимом экране сезон si и озвучку vi (номера в его фильтре; null — как есть),
    // потом cb(строки) или cb(null), если не вышло. urgent — вперёд очереди (человек нажал «смотреть»)
    function omShow(run, si, vi, cb, urgent) {
        if (!run || run.dead) return cb(null);
        var t = { si: si, vi: vi, cb: cb, tries: 0 };
        if (urgent) run.queue.unshift(t);
        else run.queue.push(t);
        omNext(run);
    }

    function omNext(run) {
        if (run.dead || run.busy || !run.queue.length) return;
        var t = run.queue[0];
        var fi = run.filters || {}, ch = run.choice || {};
        var step = null;
        if (t.si != null && fi.season && fi.season.length > 1 && (+ch.season || 0) !== t.si) step = { stype: 'season', index: t.si };
        else if (t.vi != null && fi.voice && fi.voice.length > 1 && (+ch.voice || 0) !== t.vi) step = { stype: 'voice', index: t.vi };

        if (!step || t.tries >= 3) {
            run.queue.shift();
            try { t.cb(step ? null : omRows(run)); } catch (e) {}
            return omNext(run);
        }
        t.tries++;
        run.busy = true;
        run.loading = false;
        try { run.filter.onSelect('filter', { stype: step.stype }, { index: step.index }); } catch (e) {}
        omWait(run, OM_WAIT);
    }

    function omPlain(t) {
        return ((t || '') + '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, '');
    }

    // «Заблокировано правообладателем» — строка есть, видео нет
    function omBlocked(d) {
        return /заблокирован|blocked/i.test((d.title || '') + ' ' + (d.info || ''));
    }

    function omSkipVoice(voice) {
        return /украин|ukr|субтитр/i.test(voice) || (VOICES_NOT_RU.test(voice) && !/рус/i.test(voice));
    }

    function omSeasonNum(name, i) {
        name = (name || '') + '';
        return seasonOf(name, '') || +(name.match(/\d+/) || [])[0] || i + 1;
    }

    // Все балансеры Online Mod для фильма или сериала. Первым — тот, что выбран в самом моде:
    // от него узнаём список остальных
    function omCollect(movie, rec, series) {
        if (!omClass()) return;
        omTagTemplates();

        var entry = { id: movie.id, runs: [], dead: false };
        omLive = omLive.filter(function (x) {
            if (x.id !== movie.id) return true;
            omStop(x);
            return false;
        });
        omLive.push(entry);
        while (omLive.length > 2) omStop(omLive.shift());
        rec.om = entry;
        rec.movieTitle = movie.title || movie.name || '';

        var year = ((series ? movie.first_air_date || movie.release_date : movie.release_date || movie.first_air_date) || '') + '';
        var anime = movie.original_language === 'ja';
        var names = [movie.title, movie.name, movie.original_title, movie.original_name];
        var done = series ? seriesDone : voicesDone;

        function found(run, rows) {
            if (entry.dead) return done(rec);
            if (series) omSeriesFirst(rec, run, rows);
            else omMovieFirst(rec, run, rows);
            done(rec);
        }

        function start(bal, i) {
            rec.pending++;
            setTimeout(function () {
                if (entry.dead) return done(rec);
                var run = omRun(movie, bal, found);
                if (!run) return done(rec);
                run.year = year;
                run.names = names;
                entry.runs.push(run);
            }, i * 300);
        }

        rec.pending++;
        var lead = omRun(movie, '', function (run, rows) {
            var others = (run.sort || []).filter(function (s) {
                return s && s.source && s.source !== run.bal && (anime || !/anili|animelib/i.test(s.source));
            });
            others.forEach(function (s, i) { start(s.source, i + 1); });
            found(run, rows);
        });
        if (!lead) return done(rec);
        lead.year = year;
        lead.names = names;
        entry.runs.push(lead);
    }

    /* Фильм: каждая строка Online Mod — вариант в нашем окне */

    function omMovieView(rec, run, rows, vi) {
        var fi = run.filters || {}, ch = run.choice || {};
        if (vi == null) vi = fi.voice && fi.voice.length ? +ch.voice || 0 : null;
        var voiceName = vi != null && fi.voice ? fi.voice[vi] || '' : '';
        var title = ((rec.movieTitle || '') + '').toLowerCase();
        rows.forEach(function (x, i) {
            var d = x.d || {};
            if (d.episode || omBlocked(d)) return;
            var own = (d.title || '') + '';
            var voice = cleanVoice(voiceName || (own && own.toLowerCase() !== title ? own : '') || 'Озвучка');
            if (omSkipVoice(voice)) return;
            var text = own + ' ' + (d.quality || '') + ' ' + (d.info || '');
            var v = {
                src: run.title + ' · OM', item: null, link: null, voices: [voice], count: 1, named: 1,
                h: videoHeight((d.quality || '') + ''), cam: VOICES_CAM.test(text),
                om: { run: run, si: null, vi: vi, title: own, idx: i }
            };
            var sig = v.src + '|' + voice;
            if (rec.variants.some(function (o) { return o.src + '|' + o.voices.join(',') === sig; })) return;
            rec.variants.push(v);
        });
        rec.variants.sort(function (a, b) { return (a.cam - b.cam) || (b.named - a.named) || (b.h - a.h); });
    }

    function omMovieFirst(rec, run, rows) {
        if (!rows.length) return;
        omMovieView(rec, run, rows, null);
        var fi = run.filters || {}, ch = run.choice || {};
        (fi.voice || []).slice(0, OM_VOICES).forEach(function (name, vi) {
            if (vi === (+ch.voice || 0) || omSkipVoice(name || '')) return;
            rec.pending++;
            omShow(run, null, vi, function (r) {
                if (r) omMovieView(rec, run, r, vi);
                voicesDone(rec);
            });
        });
    }

    function omPlayVariant(v) {
        var o = v.om;
        omShow(o.run, o.si, o.vi, function (rows) {
            rows = rows || [];
            var hit = rows.filter(function (x) { return x.d && x.d.title === o.title; })[0] || rows[o.idx];
            if (!hit) return say('Online Mod не открыл видео — выберите другой вариант');
            $(hit.el).trigger('hover:enter');
        }, true);
    }

    /* Сериал: балансер Online Mod — источник, его озвучки — варианты сезона */

    function omSeriesFirst(rec, run, rows) {
        var eps = rows.filter(function (x) { return x.d && x.d.episode; });
        if (!eps.length) return;
        var fi = run.filters || {};
        var src = { name: run.title + ' · OM', om: run, seasons: {} };
        if (fi.season && fi.season.length) fi.season.forEach(function (n, i) { src.seasons[omSeasonNum(n, i)] = { si: i }; });
        else eps.forEach(function (x) { src.seasons[+x.d.season || 1] = { si: null }; });
        rec.sources.push(src);
        Object.keys(src.seasons).forEach(function (s) { rec.seasons[s] = true; });
        Object.keys(rec.data).forEach(function (s) { if (src.seasons[s]) loadSeasonSource(rec, +s, src); });
    }

    function omSeasonVariant(rec, s, src, rows, si, vi, voice) {
        var data = rec.data[s];
        if (!data) return;
        voice = cleanVoice(voice || '');
        if (voice && omSkipVoice(voice)) return;
        var v = {
            src: src.name, voices: [voice.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim() || 'Озвучка'], count: 1, named: 1,
            h: 0, cam: false, episodes: {}, om: { run: src.om, si: si, vi: vi }
        };
        rows.forEach(function (x) {
            var d = x.d || {};
            if (!d.episode || (d.season && +d.season !== s) || omBlocked(d)) return;
            v.episodes[+d.episode] = { om: true };
            var h = videoHeight((d.quality || '') + '');
            if (h > v.h) v.h = h;
            if (VOICES_CAM.test((d.title || '') + ' ' + (d.info || ''))) v.cam = true;
        });
        v.total = Object.keys(v.episodes).length;
        if (!v.total) return;
        var sig = v.src + '|' + v.voices.join(',');
        if (data.variants.some(function (o) { return o.src + '|' + o.voices.join(',') === sig; })) return;
        data.variants.push(v);
        sortSeason(data);
    }

    function omLoadSeason(rec, s, src) {
        var run = src.om;
        var si = src.seasons[s] ? src.seasons[s].si : null;
        rec.pending++;
        omShow(run, si, null, function (rows) {
            if (rows) {
                var fi = run.filters || {}, ch = run.choice || {};
                var voices = fi.voice || [];
                var cur = voices.length ? +ch.voice || 0 : null;
                omSeasonVariant(rec, s, src, rows, si, cur, cur != null ? voices[cur] : '');
                voices.slice(0, OM_VOICES).forEach(function (name, vi) {
                    if (vi === cur || omSkipVoice(name || '')) return;
                    rec.pending++;
                    omShow(run, si, vi, function (r) {
                        if (r) omSeasonVariant(rec, s, src, r, si, vi, name);
                        seriesDone(rec);
                    });
                });
            }
            seriesDone(rec);
        });
    }

    function omPlayEpisode(movie, s, e, v) {
        var o = v.om;
        try {
            progress().last[cardKey(movie)] = { hash: String(episodeHash(movie, s, e)), s: s, e: e, u: Date.now() };
            saveProgressSoon();
        } catch (err) {}
        omShow(o.run, o.si, o.vi, function (rows) {
            var hit = (rows || []).filter(function (x) { return x.d && +x.d.episode === e && (!x.d.season || +x.d.season === s); })[0];
            if (!hit) return say('Online Mod не открыл серию — выберите другой источник');
            $(hit.el).trigger('hover:enter');
        }, true);
    }

    // «Смотреть»: кружок вместо значка → «влетаем» в постер → окно фильма или сериала
    // со всеми бесплатными серверами. «Источники» открывают прежний список модов без анимации.
    function hookVoicesCard(render, movie) {
        if (!movie || !movie.id) return;
        var series = isSeries(movie);
        if (enabled(KEY.voices)) {
            if (series) collectSeries(movie);
            else collectVoices(movie);
        }

        var btn = render.find('.button--play').first();
        if (!btn.length) return;

        var originals = [];

        function press() {
            var self = this, args = arguments;
            function callOriginals() { originals.forEach(function (fn) { fn.apply(self, args); }); }

            if (forceMenu) return callOriginals();
            if (btn.hasClass('easy-voices-press')) return;

            var go = !enabled(KEY.voices) ? callOriginals : series ? function () { openSeries(movie); } : function () { openVoices(movie); };

            var mode = motion();
            if (mode === 'off') return go();

            // Кружок того же размера и с тем же отступом до текста, что и значок
            var icon = btn.find('svg').first();
            var label = icon.next('span');
            var spin = $('<span class="easy-voices-spin"></span>');
            var size = icon.outerWidth() || 0;
            if (size) spin.css({ width: size + 'px', height: size + 'px' });
            spin.css('margin-right', label.length ? label.css('margin-left') : '.5em');
            btn.addClass('easy-voices-press');
            icon.addClass('easy-voices-hidden').after(spin);

            var step = mode === 'light' ? 80 : 120;
            setTimeout(function () {
                render.addClass('easy-voices-dive easy-voices-dive--' + mode);
                setTimeout(function () {
                    go();
                    setTimeout(function () {
                        btn.removeClass('easy-voices-press').find('.easy-voices-spin').remove();
                        icon.removeClass('easy-voices-hidden');
                        render.removeClass('easy-voices-dive easy-voices-dive--full easy-voices-dive--light');
                    }, 500);
                }, mode === 'light' ? 150 : 380);
            }, step);
        }

        // При возврате на карточку Lampa заново вешает на кнопку свой обработчик и убирает наш.
        // Поэтому проверяем при каждом фокусе на кнопке и при возврате на карточку.
        function ensure() {
            var list = ($._data(btn[0], 'events') || {})['hover:enter'] || [];
            if (list.length === 1 && list[0].handler === press) return;
            originals = list.map(function (h) { return h.handler; }).filter(function (fn) { return fn !== press; });
            btn.off('hover:enter').on('hover:enter', press);
        }

        ensure();
        btn.on('hover:focus', ensure);
        render.data('easy-voices-ensure', ensure);
    }

    function hiddenCardButton(el) {
        return !!(el && el.classList && el.classList.contains('full-start__button') && el.offsetParent === null && el.parentNode && el.parentNode.offsetParent !== null);
    }

    function skipHiddenButtons() {
        if (typeof Navigator === 'undefined' || Navigator.easyUiSkip) return;
        Navigator.easyUiSkip = true;

        var navigable = Navigator._isNavigable;
        if (typeof navigable === 'function') {
            Navigator._isNavigable = function (el) {
                return hiddenCardButton(el) ? false : navigable.apply(this, arguments);
            };
        }

        var focus = Navigator.focus;
        if (typeof focus === 'function') {
            Navigator.focus = function (el) {
                // Lampa ставит фокус на первую кнопку, а она может быть спрятана — тогда на «Смотреть»
                if (hiddenCardButton(el)) {
                    var visible = [].filter.call(el.parentNode.querySelectorAll('.full-start__button.selector'), function (x) { return x.offsetParent !== null; });
                    var play = visible.filter(function (x) { return x.classList.contains('button--play'); })[0];
                    if (play || visible[0]) el = play || visible[0];
                }
                var args = [].slice.call(arguments);
                args[0] = el;
                return focus.apply(this, args);
            };
        }
    }

    function setupVoices() {
        Lampa.Component.add('easy_voices', VoicesComponent);
        Lampa.Component.add('easy_series', SeriesComponent);
        skipHiddenButtons();

        Lampa.Listener.follow('full', guard('все озвучки', function (e) {
            if (e.type !== 'complite') return;
            var movie = (e.data && e.data.movie) || e.object.card;
            var render = e.object.activity.render();

            // Открытие карточки: фон подъезжает, потом появляются кнопки
            var mode = motion();
            if (mode !== 'off') {
                render.addClass('easy-voices-enter easy-voices-enter--' + mode);
                // Класс easy-voices-enter не снимаем: он держит выключенным «проявление» страницы.
                // Если его снять, страница проявится ещё раз — всё мигнёт
                setTimeout(function () { render.removeClass('easy-voices-enter--full easy-voices-enter--light'); }, 2500);
            }

            // Сразу и ещё раз, когда плагины дорисуют кнопки
            function hook() {
                var ensure = render.data('easy-voices-ensure');
                if (ensure) ensure();
                else hookVoicesCard(render, movie);
            }
            guard('все озвучки', hook)();
            [300, 800, 2000].forEach(function (delay) { setTimeout(guard('все озвучки', hook), delay); });
        }));

        // Возврат на карточку (из окна вариантов, мода или плеера)
        Lampa.Listener.follow('activity', guard('все озвучки', function (e) {
            if (e.type !== 'start' || e.component !== 'full' || !e.object || !e.object.activity) return;
            setTimeout(function () {
                try {
                    var ensure = e.object.activity.render().data('easy-voices-ensure');
                    if (ensure) ensure();
                } catch (err) {}
            }, 300);
        }));
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
            [KEY.voices, 'Все озвучки сразу', '«Смотреть» открывает окно со всеми бесплатными серверами: у фильма — варианты с качеством и озвучками, у сериала — серии плиткой, сверху выбор сезона и источника с озвучкой. Кнопки BWA и MODS’s на карточке скрыты, прежний список модов — в «Источниках»'],
            [KEY.play, '«Смотреть» открывает сразу', 'Запускает мод, выбранный в прошлый раз; остальные — по кнопке «Источники»'],
            [KEY.shots, 'Скрыть Shots', 'Убирает нарезки с карточки, из меню и с главной'],
            [KEY.head, 'Шапка: сезон, озвучка, сервер', 'Видимые кнопки с текущим значением. «Назад» в списке серий — сразу к шапке'],
            [KEY.auto, 'Автоподбор сервера', 'Пустой или зависший сервер — сам переключает на следующий, начиная с проверенных'],
            [KEY.russian, 'Сначала русская озвучка', 'Если включились субтитры или оригинал — ищет русскую озвучку, а затем другой сервер'],
            [KEY.grid, 'Серии плиткой', 'Серии по три в ряд: кадр из серии, номер и название вместо длинного списка'],
            [KEY.chain, 'Цепочка модов', 'Если мод не нашёл фильм ни на одном сервере — открывает следующий мод'],
            [KEY.voice, 'Озвучка в плеере', 'Смена озвучки через кнопку звука во время просмотра'],
            [KEY.tracks, 'Озвучки внутри видео', 'Запоминает серверы, у которых все озвучки и субтитры переключаются прямо в плеере, и показывает это в шапке и в списке серверов'],
            [KEY.resume, 'Место просмотра и последняя серия', 'Помнит серию и минуту, показывает их на карточке и в списке серий; передаёт место и субтитры плееру Apple TV'],
            [KEY.card, 'Новая карточка фильма', 'Всё внизу поверх фона, большая «Смотреть», эмоции под названием, постер — отдельной кнопкой'],
            [KEY.priority, 'Скрыть кнопку приоритетного источника', 'Убирает с карточки отдельную кнопку источника слева от «Смотреть»'],
            [KEY.home, 'Главная: сначала история', 'Первым рядом — фильмы и сериалы, которые смотрели последними; ряд плиток «Главная, Избранное, История…» убран'],
            [KEY.smooth, 'Плавность', 'Ленты тормозят мягче, страницы появляются плавно'],
            [KEY.anchor, 'Якорь для пульта', 'Короткий свайп по сенсору — один шаг; фокус не проскакивает кнопки и не уходит в другой ряд; в меню выбора — ещё спокойнее'],
            [KEY.look, 'Единый вид', 'Закруглённые кнопки во всех модах, заметный фокус, мягкие плашки на постерах, одна анимация загрузки, без лишних надписей'],
            [KEY.large, 'Крупный режим', 'Всё на 15 % больше — для дальнего дивана'],
            [KEY.dim, 'Вечерний режим', 'С 21:00 до 7:00 экран чуть темнее; видео не затемняется'],
            [KEY.sound, 'Звук нажатия', 'Тихий щелчок при выборе кнопки'],
            [KEY.quiet, 'Тихий режим', 'Не показывать всплывающие сообщения плагина']
        ].forEach(function (row) {
            Lampa.SettingsApi.addParam({
                component: 'easy_ui',
                param: { name: row[0], type: 'trigger', default: OFF_BY_DEFAULT.indexOf(row[0]) < 0 },
                field: { name: row[1], description: row[2] },
                onChange: function () { setTimeout(applyBodyClasses, 0); }
            });
        });

        Lampa.SettingsApi.addParam({
            component: 'easy_ui',
            param: { name: 'easy_ui_motion', type: 'select', values: { full: 'Полная', light: 'Упрощённая', off: 'Без анимации' }, default: 'full' },
            field: { name: 'Анимация', description: 'Полная: фон карточки подъезжает, затем появляются кнопки; после «Смотреть» — полёт в постер. Упрощённая — быстрее и меньше' }
        });

        Lampa.SettingsApi.addParam({
            component: 'easy_ui',
            param: { name: 'easy_ui_relay', type: 'input', values: '', placeholder: 'https://…workers.dev/ключ/', default: '' },
            field: { name: 'Свой сервер Cloudflare', description: 'Необязательно. С ним в меню звука плеера короткие названия озвучек: «Дубляж #1», «Сербин»' }
        });

        Lampa.SettingsApi.addParam({
            component: 'easy_ui',
            param: { name: 'easy_ui_tools_title', type: 'title' },
            field: { name: 'Сохранение и сброс' }
        });

        Lampa.SettingsApi.addParam({
            component: 'easy_ui',
            param: { name: 'easy_ui_backup', type: 'button' },
            field: { name: 'Резервная копия', description: 'Сохранить настройки, историю и места просмотра и вернуть их, если Lampa переустановят' },
            onChange: openBackup
        });

        Lampa.SettingsApi.addParam({
            component: 'easy_ui',
            param: { name: 'easy_ui_reset', type: 'button' },
            field: { name: 'Сбросить всё как было', description: 'Вернуть настройки плагина к начальным. Перед сбросом сохраняется снимок — сброс можно отменить' },
            onChange: openReset
        });

        Lampa.SettingsApi.addParam({
            component: 'easy_ui',
            param: { name: 'easy_ui_health', type: 'button' },
            field: { name: 'Состояние плагина', description: 'Какие части плагина работают; сломавшаяся часть выключается сама, остальное работает' },
            onChange: function () {
                var list = Object.keys(broken).concat(problems);

                say(list.length ? 'Выключено до перезапуска Lampa: ' + list.join(', ') : 'Удобный интерфейс ' + VERSION + ': всё работает');
            }
        });
    }

    /* ---------- Резервная копия и сброс ---------- */

    var SNAPSHOT_KEY = 'easy_ui_snapshot';

    function settingKeys() {
        return Object.keys(KEY).map(function (name) { return KEY[name]; });
    }

    function dataKeys() {
        return [HISTORY_KEY, PROGRESS_KEY, LAST_SOURCE];
    }

    function takeSnapshot() {
        var snap = { u: Date.now(), values: {} };

        settingKeys().concat(dataKeys()).forEach(function (key) {
            var value = Lampa.Storage.get(key, '');
            if (value !== '' && value !== null && typeof value !== 'undefined') snap.values[key] = value;
        });

        Lampa.Storage.set(SNAPSHOT_KEY, snap);

        return snap;
    }

    function readSnapshot() {
        var snap = Lampa.Storage.get(SNAPSHOT_KEY, '');

        if (typeof snap === 'string') {
            try { snap = JSON.parse(snap); } catch (e) { snap = null; }
        }

        return snap && snap.values ? snap : null;
    }

    function snapshotDate(snap) {
        var d = new Date(snap.u);
        return d.getDate() + ' ' + MONTHS[d.getMonth()] + ', ' + d.getHours() + ':' + (d.getMinutes() < 10 ? '0' : '') + d.getMinutes();
    }

    function restoreSnapshot(snap) {
        settingKeys().concat(dataKeys()).forEach(function (key) {
            if (Object.prototype.hasOwnProperty.call(snap.values, key)) Lampa.Storage.set(key, snap.values[key]);
        });

        progressData = null;
        applyBodyClasses();
    }

    function settingsBack() {
        closeMenuIfOpen();
        try { Lampa.Controller.toggle('settings_component'); } catch (e) {}
    }

    function openBackup() {
        var snap = readSnapshot();
        var account = false;

        try { account = !!Lampa.Account.Permit.access; } catch (e) {}

        var items = [
            { title: 'Сохранить снимок на этом телевизоре', subtitle: 'Настройки, история и места просмотра', act: 'save' }
        ];

        if (snap) items.push({ title: 'Вернуть снимок от ' + snapshotDate(snap), subtitle: 'Текущие данные плагина заменятся снимком', act: 'restore' });

        items.push({
            title: 'Копия, которая переживёт переустановку',
            subtitle: account
                ? 'Настройки Lampa → Аккаунт → Резервная копия → Сохранить. Данные плагина входят в неё; вернуть — там же, «Загрузить»'
                : 'Нужен вход в аккаунт CUB: Настройки Lampa → Аккаунт. Потом там же «Резервная копия» — данные плагина входят в неё',
            act: 'info'
        });

        Lampa.Select.show({
            title: 'Резервная копия',
            items: items,
            onBack: settingsBack,
            onSelect: function (picked) {
                if (picked.act === 'save') {
                    takeSnapshot();
                    say('Снимок сохранён');
                } else if (picked.act === 'restore' && snap) {
                    restoreSnapshot(snap);
                    say('Вернул снимок от ' + snapshotDate(snap));
                }

                settingsBack();
            }
        });
    }

    function openReset() {
        var snap = readSnapshot();
        var items = [
            { title: 'Сбросить настройки', subtitle: 'История и места просмотра останутся', act: 'settings' },
            { title: 'Сбросить всё', subtitle: 'Настройки, история серверов и озвучек, места просмотра', act: 'all' }
        ];

        if (snap) items.push({ title: 'Отменить сброс', subtitle: 'Вернуть снимок от ' + snapshotDate(snap), act: 'undo' });

        items.push({ title: 'Ничего не менять', act: 'none' });

        Lampa.Select.show({
            title: 'Сбросить всё как было',
            items: items,
            onBack: settingsBack,
            onSelect: function (picked) {
                if (picked.act === 'settings' || picked.act === 'all') {
                    takeSnapshot();

                    settingKeys().forEach(function (key) {
                        Lampa.Storage.set(key, OFF_BY_DEFAULT.indexOf(key) < 0 ? 'true' : 'false');
                    });

                    if (picked.act === 'all') {
                        Lampa.Storage.set(HISTORY_KEY, {});
                        Lampa.Storage.set(PROGRESS_KEY, {});
                        Lampa.Storage.set(LAST_SOURCE, '');
                        progressData = null;
                    }

                    applyBodyClasses();
                    say('Сброшено. Чтобы вернуть, выберите «Отменить сброс». Переключатели обновятся, когда откроете раздел заново');
                } else if (picked.act === 'undo' && snap) {
                    restoreSnapshot(snap);
                    say('Вернул как было до сброса');
                }

                settingsBack();
            }
        });
    }

    /* ---------- Запуск ---------- */

    var problems = [];

    function safe(name, fn) {
        try { fn(); } catch (e) { problems.push(name + ' (' + (e && e.message ? e.message : e) + ')'); }
    }

    // Online Mod при каждом запуске выключает «HDRezka через прокси». Если в нём указан свой прокси,
    // включаем обратно: при запуске и при открытии карточки (мод мог выключить его после ошибки)
    function keepRezkaProxy() {
        function apply() {
            try {
                var own = Lampa.Storage.field('online_mod_proxy_other') === true && !!(Lampa.Storage.get('online_mod_proxy_other_url', '') + '');
                if (own && Lampa.Storage.field('online_mod_proxy_rezka2') !== true) Lampa.Storage.set('online_mod_proxy_rezka2', 'true');
            } catch (e) {}
        }

        apply();
        setTimeout(apply, 3000);
        Lampa.Listener.follow('full', function (e) { if (e.type === 'complite') apply(); });
    }

    function start() {
        safe('свой прокси HDRezka', keepRezkaProxy);
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
        safe('главная', setupHome);
        safe('фокус на главной', watchMainFocus);
        safe('внешний вид', watchLook);
        safe('звук нажатия', watchClicks);
        safe('все озвучки', setupVoices);

        safe('карточка', function () {
            Lampa.Listener.follow('full', guard('карточка', function (e) {
                if (e.type !== 'complite') return;
                setupFull(e.object.activity.render(), (e.data && e.data.movie) || e.object.card);
            }));
        });

        // Видно, что плагин загрузился и какой он версии
        setTimeout(function () {
            if (problems.length) {
                Lampa.Noty.show('Удобный интерфейс ' + VERSION + ': не запустилось — ' + problems.join(', '));
                return;
            }

            if (Lampa.Storage.get('easy_ui_seen_version', '') + '' !== VERSION) {
                Lampa.Storage.set('easy_ui_seen_version', VERSION);
                say('Удобный интерфейс ' + VERSION + ' включён');
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
