// ==UserScript==
// @name         Volley.ru HD & NoAds
// @namespace    volley-hd-noads
// @version      2.3.3
// @description  Разблокировка HD (1080p) и удаление рекламы на volley.ru
// @match        https://volley.ru/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// @match на весь сайт: при переходе на трансляцию кликом по ссылке страница может не
// перезагружаться, и скрипт, ограниченный /games/*, в этот момент не запускается.
// @grant none => скрипт выполняется в контексте самой страницы,
// а @run-at document-start => раньше скриптов сайта. Оба условия обязательны.
(function () {
    'use strict';
    console.log('[VolleyFix] Запуск полной очистки...');

    // 1. Скрытие рекламных элементов (включая RTB и внутреннюю ротацию сайта)
    const style = document.createElement('style');
    style.textContent = `
        .warning-register-needed,
        .mc-video-reg-panel,
        #floor-adv-1,
        [class*="mobile-adv-spawner"],
        #player_control_countdownbox,
        .pjs-plug-player-bg,
        div[id^="yandex_rtb_"],
        .calendar-banner,
        .games-banner,
        .force-adv,
        .mc-header__sponsor,
        .JE5WOgnQpw {
            display: none !important;
            height: 0 !important;
            visibility: hidden !important;
        }
        /* Баннер магазина нельзя прятать через display:none: его margin-top (64px)
           отодвигает контент от фиксированной шапки. Схлопываем только высоту. */
        .glb-line-banner-wrapper {
            height: 0 !important;
            min-height: 0 !important;
            overflow: hidden !important;
            visibility: hidden !important;
        }
    `;
    (document.head || document.documentElement).appendChild(style);

    // 2. Подмена профиля на VIP
    const origFetch = window.fetch;
    window.fetch = function (input, options) {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (url.includes('/api/profile')) {
            return Promise.resolve(new Response(JSON.stringify({
                success: true,
                object: { id: 777, vip: 1, loggedin: true, hide_score: 0, cdnld: 1 }
            }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
        }
        return origFetch.apply(this, arguments);
    };

    // 3. Блокировка рекламных очередей Яндекса
    window.yaContextCb = {
        push: () => {
            console.log('[VolleyFix] Yandex Context Push заблокирован');
            return 0;
        }
    };
    if (!window.ya) window.ya = {};
    window.ya.videoAd = { play: () => Promise.resolve(), loadModule: () => Promise.resolve() };

    // 4. Патч конфигурации плеера
    function patchConfig(config) {
        if (!config) return config;

        // Разблокировка HD качества
        config.forbidden_quality = '';
        config.default_quality = '1080p';

        // Отключение рекламы
        config.ads = 0;
        config.noads = 1;
        config.vast = 0;
        config.pauseroll = '';
        config.midroll = [];
        config.skipAds = true;
        config.adblock = 0;

        // Полный плейлист через GetFile()
        if (typeof window.GetFile === 'function') {
            try {
                const fullPlaylist = window.GetFile();
                if (fullPlaylist && fullPlaylist.includes('[')) {
                    config.file = fullPlaylist;
                    console.log('[VolleyFix] HD Плейлист получен через GetFile');
                }
            } catch (e) {}
        }
        return config;
    }

    const pjsHandler = {
        construct(target, args) {
            if (args[0]) args[0] = patchConfig(args[0]);
            return new target(...args);
        }
    };

    const wrapped = new WeakSet();
    function wrap(fn) {
        if (typeof fn !== 'function' || wrapped.has(fn)) return fn;
        const p = new Proxy(fn, pjsHandler);
        wrapped.add(p);
        return p;
    }

    // Основной способ: перехват присвоения window.Playerjs / window.PlayerjsPoster
    ['Playerjs', 'PlayerjsPoster'].forEach((name) => {
        let value = window[name];
        try {
            Object.defineProperty(window, name, {
                configurable: true,
                enumerable: true,
                get() { return value; },
                set(v) { value = wrap(v); }
            });
        } catch (e) {}
    });

    // Запасной способ: если сайт объявил глобал через
    // "function Playerjs(){}", сеттер обходится, поэтому дополнительно опрашиваем.
    setInterval(() => {
        ['Playerjs', 'PlayerjsPoster'].forEach((name) => {
            if (window[name]) {
                const w = wrap(window[name]);
                if (w !== window[name]) {
                    try { window[name] = w; } catch (e) {}
                }
            }
        });
        // Убиваем функцию ротации баннеров сайта
        if (typeof window.rotateBanner === 'function') {
            window.rotateBanner = function () {};
        }
    }, 100); // не останавливаем: при переходах внутри сайта плеер может создаваться позже
})();
