/* Shozit Developments: язык RU/EN, ссылки на загрузку из version.json, новости из news.json. Без зависимостей. */
(function () {
  'use strict';
  var root = document.documentElement.getAttribute('data-root') || './';
  var LANGS = ['ru', 'en'];
  var qsa = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };

  function store(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
  }
  function detect() {
    var q = new URLSearchParams(location.search).get('lang');
    if (LANGS.indexOf(q) >= 0) return q;
    var s = store('lang');
    if (LANGS.indexOf(s) >= 0) return s;
    return (navigator.language || 'ru').toLowerCase().indexOf('ru') === 0 ? 'ru' : 'en';
  }
  function getJSON(path) {
    return fetch(root + path, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(path + ' ' + r.status);
      return r.json();
    });
  }

  var lang = detect();
  var dict = {};
  var versions = null;
  var news = null;
  var t = function (k) { return dict[k] !== undefined ? dict[k] : k; };

  /* ---------- перевод ---------- */
  function applyLang() {
    document.documentElement.lang = lang;
    qsa('[data-i18n]').forEach(function (el) {
      var k = el.getAttribute('data-i18n');
      if (dict[k] !== undefined) el.textContent = dict[k];
    });
    qsa('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(';').forEach(function (pair) {
        var i = pair.indexOf(':');
        var k = pair.slice(i + 1);
        if (dict[k] !== undefined) el.setAttribute(pair.slice(0, i), dict[k]);
      });
    });
    qsa('.lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-lang') === lang)); });
    renderNews();
    fillVersions();
  }
  function setLang(l) {
    if (l === lang) return;
    lang = l;
    store('lang', l);
    load().then(applyLang);
  }
  function load() {
    return getJSON('i18n/' + lang + '.json').then(function (d) { dict = d; }).catch(function () { /* оставляем текст из HTML */ });
  }

  /* ---------- загрузки и версии ---------- */
  function fmtSize(bytes) {
    if (!bytes) return '';
    return (bytes / 1048576).toFixed(bytes > 1.05e8 ? 0 : 1) + (lang === 'ru' ? ' МБ' : ' MB');
  }
  function fillVersions() {
    if (!versions) return;
    qsa('[data-dl]').forEach(function (a) {
      var p = a.getAttribute('data-dl').split(':'); // игра:ОС, например rigged:windows
      var game = p[0] === 'launcher' ? versions.launcher : versions.games[p[0]];
      var d = game && game.downloads && game.downloads[p[1]];
      if (!d) return;
      if (!a.hasAttribute('data-keep')) a.href = d.url; // у лаунчера ссылка «последняя версия» уже в HTML
      var s = a.querySelector('small');
      if (s) s.textContent = d.size ? fmtSize(d.size) : '';
    });
    qsa('[data-version]').forEach(function (el) {
      var g = versions.games[el.getAttribute('data-version')];
      if (g) el.textContent = g.version;
    });
    qsa('[data-teaser]').forEach(function (el) {
      var g = versions.games[el.getAttribute('data-teaser')];
      var has = !!(g && g.teaser);
      qsa('[data-teaser-yes]', el).forEach(function (n) { n.hidden = !has; if (has) n.href = g.teaser; });
      qsa('[data-teaser-no]', el).forEach(function (n) { n.hidden = has; });
    });
  }

  /* ---------- новости ---------- */
  function pick(o) { return o && (o[lang] || o.ru || o.en) || ''; }
  function renderNews() {
    var boxes = qsa('[data-news]');
    if (!boxes.length) return;
    boxes.forEach(function (box) {
      var limit = parseInt(box.getAttribute('data-limit') || '0', 10);
      box.textContent = '';
      if (news === false) { box.appendChild(note(t('news.error'))); return; }
      if (!news) return;
      var items = news.items.slice().sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
      if (limit) items = items.slice(0, limit);
      if (!items.length) { box.appendChild(note(t('news.empty'))); return; }
      var ul = document.createElement('ul');
      ul.className = 'news-list';
      items.forEach(function (it) {
        var li = document.createElement('li');
        li.className = 'news-item';
        var time = document.createElement('time');
        time.setAttribute('datetime', it.date);
        time.textContent = new Date(it.date + 'T12:00:00').toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        var body = document.createElement('div');
        var h = document.createElement('h3');
        h.textContent = pick(it.title);
        var tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = t('tag.' + String(it.game).replace('-', ''));
        h.appendChild(tag);
        var p = document.createElement('p');
        p.textContent = pick(it.text);
        body.appendChild(h);
        body.appendChild(p);
        if (it.url) {
          var a = document.createElement('a');
          a.href = it.url;
          a.textContent = '→';
          a.setAttribute('aria-label', pick(it.title));
          p.appendChild(document.createTextNode(' '));
          p.appendChild(a);
        }
        li.appendChild(time);
        li.appendChild(body);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    });
  }
  function note(text) {
    var p = document.createElement('p');
    p.className = 'news-empty';
    p.textContent = text;
    return p;
  }

  /* ---------- запуск ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('.lang button');
    if (b) setLang(b.getAttribute('data-lang'));
  });
  var done = function () { document.documentElement.classList.remove('lang-wait'); };
  Promise.all([
    load(),
    getJSON('version.json').then(function (d) { versions = d; }).catch(function () {}),
    qsa('[data-news]').length ? getJSON('news.json').then(function (d) { news = d; }).catch(function () { news = false; }) : Promise.resolve()
  ]).then(function () { applyLang(); done(); });
  setTimeout(done, 1500);
})();
