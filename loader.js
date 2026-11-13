/*
 * Загрузчик плагина «Удобный интерфейс» для Lampa.
 * Ставится в «Расширения» один раз и всегда подтягивает свежую версию easy_ui.js:
 * ссылка на ветку через jsDelivr может днями отдавать старую копию из кэша.
 * Этот файл менять не нужно — поэтому его собственный кэш не мешает.
 */
(function () {
    'use strict';

    var REPO = 'romap328-hash/lampa-easy-ui';
    var FILE = 'easy_ui.js';

    if (window.easy_ui_loader) return;
    window.easy_ui_loader = true;

    function addScript(src) {
        var script = document.createElement('script');
        script.src = src;
        script.async = true;
        document.head.appendChild(script);
    }

    // Запасной путь: последний коммит через API GitHub, файл через jsDelivr по номеру коммита
    function fromJsDelivr() {
        var xhr = new XMLHttpRequest();

        function fallback() {
            addScript('https://cdn.jsdelivr.net/gh/' + REPO + '@main/' + FILE);
        }

        try {
            xhr.open('GET', 'https://api.github.com/repos/' + REPO + '/commits/main', true);
            xhr.timeout = 8000;
            xhr.onload = function () {
                var sha = '';

                try { sha = JSON.parse(xhr.responseText).sha || ''; } catch (e) {}

                if (/^[0-9a-f]{40}$/.test(sha)) addScript('https://cdn.jsdelivr.net/gh/' + REPO + '@' + sha + '/' + FILE);
                else fallback();
            };
            xhr.onerror = fallback;
            xhr.ontimeout = fallback;
            xhr.send();
        } catch (e) {
            fallback();
        }
    }

    // Основной путь: файл прямо из репозитория (кэш там до 5 минут)
    var xhr = new XMLHttpRequest();

    try {
        xhr.open('GET', 'https://raw.githubusercontent.com/' + REPO + '/main/' + FILE + '?t=' + Date.now(), true);
        xhr.timeout = 8000;
        xhr.onload = function () {
            var code = xhr.status === 200 ? xhr.responseText : '';

            if (code.indexOf('easy_ui_plugin') < 0) return fromJsDelivr();

            var script = document.createElement('script');
            script.text = code;
            document.head.appendChild(script);

            // Встроенный код могли запретить настройки безопасности — тогда отдельным файлом
            if (!window.easy_ui_version) fromJsDelivr();
        };
        xhr.onerror = fromJsDelivr;
        xhr.ontimeout = fromJsDelivr;
        xhr.send();
    } catch (e) {
        fromJsDelivr();
    }
})();
