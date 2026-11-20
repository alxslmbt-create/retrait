/* Retrait : tous les codes de casiers au même endroit. Vanilla JS, aucune dépendance. */
(function () {
  'use strict';

  var KEY = { cfg: 'retrait.cfg', data: 'retrait.data', queue: 'retrait.queue', filter: 'retrait.filter' };
  var CARRIERS = {
    mondialrelay: { name: 'Mondial Relay', short: 'MR', color: 'var(--mr)' },
    vintedgo: { name: 'Vinted Go', short: 'VG', color: 'var(--vgo)' },
  };
  var OTHER = { name: 'Autre', short: '?', color: 'var(--muted)' };
  var MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function fold(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }

  var cfg = load(KEY.cfg, null);
  var data = load(KEY.data, null);
  var queue = load(KEY.queue, []);
  var demo = false;
  var tab = 'ready';
  var filter = load(KEY.filter, 'all');
  var DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
  var pendingHide = {};
  var offline = false;
  var lastSync = 0;

  // ---------- Lien d'installation (#api=…&t=…) ou démo (#demo) ----------
  function applyLink(hash) {
    var p = new URLSearchParams(hash.replace(/^.*#/, ''));
    if (p.get('api') && p.get('t')) {
      cfg = { api: p.get('api'), token: p.get('t') };
      save(KEY.cfg, cfg);
      return true;
    }
    return false;
  }
  if (location.hash === '#demo') {
    demo = true;
    data = demoData();
    queue = [];
  } else if (location.hash.length > 1) {
    applyLink(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
  }

  // ---------- Dates ----------
  function localIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function daysLeft(iso) { return Math.round((Date.parse(iso + 'T12:00:00') - Date.parse(localIso(new Date()) + 'T12:00:00')) / 86400000); }
  function shortDate(iso) { var p = iso.split('-'); return +p[2] + ' ' + MONTHS[+p[1] - 1]; }
  function deadlineBadge(iso) {
    if (!iso) return '';
    var n = daysLeft(iso);
    if (n < 0) return '<span class="badge danger">Délai dépassé · ' + shortDate(iso) + '</span>';
    if (n === 0) return '<span class="badge danger">Dernier jour</span>';
    if (n === 1) return '<span class="badge warn">Jusqu\'à demain</span>';
    return '<span class="badge' + (n <= 2 ? ' warn' : '') + '">Avant le ' + shortDate(iso) + ' · J-' + n + '</span>';
  }
  function arrivedText(ts) {
    if (!ts) return '';
    var day = localIso(new Date(ts)), n = -daysLeft(day);
    return n === 0 ? 'Arrivé aujourd\'hui' : n === 1 ? 'Arrivé hier' : 'Arrivé le ' + shortDate(day);
  }
  function stamp(ts) {
    if (!ts) return 'jamais';
    var d = new Date(ts);
    var hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return localIso(d) === localIso(new Date()) ? 'à ' + hm : 'le ' + shortDate(localIso(d)) + ' à ' + hm;
  }

  // ---------- Affichage ----------
  // Une case par caractère, comme un code PIN, avec un léger écart entre les groupes de 3 ou 4.
  function formatCode(code) {
    var c = String(code), size = c.length % 4 === 0 && c.length > 4 ? 4 : (c.length % 3 === 0 && c.length > 3 ? 3 : 0);
    return c.split('').map(function (ch, i) {
      return '<span class="tile' + (size && i && i % size === 0 ? ' g' : '') + '">' + esc(ch) + '</span>';
    }).join('');
  }
  function mark(c) { return '<span class="carrier-mark" style="--c:' + c.color + '">' + c.short + '</span>'; }
  function who(p) { return p.holder || ''; }
  function mapsUrl(loc) { return 'https://maps.apple.com/?q=' + encodeURIComponent(loc.name + ', ' + (loc.address || '')); }
  // Colis d'un onglet, tous transporteurs (compteurs) ou selon le filtre choisi (listes).
  function byStatus(status) {
    return (data && data.parcels || []).filter(function (p) {
      return !pendingHide[p.id] && (status === 'ready' ? p.status === 'ready' || p.status === 'check' : p.status === 'done');
    });
  }
  function visible(status) {
    return byStatus(status).filter(function (p) { return filter === 'all' || p.carrier === filter; });
  }

  var ICON_QR = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2zM16 16h2v2h-2z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  var ICON_CLOCK = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="13" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 9v4.2l2.6 1.6M9.5 2.8h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_DONE = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function parcelHtml(p) {
    var body;
    if (p.code) body = '<button class="code" data-copy="' + esc(p.code) + '" aria-label="Copier le code ' + esc(p.code) + '">' + formatCode(p.code) + '</button>';
    else body = '<div class="nocode">Code introuvable dans l\'e-mail</div>';
    var actions = (p.qr || p.qrUrl ? '<button class="round" data-qr="' + esc(p.id) + '" aria-label="Afficher le QR code">' + ICON_QR + '</button>' : '') +
      '<button class="round done-btn" data-done="' + esc(p.id) + '" aria-label="Marquer récupéré">' + ICON_DONE + '</button>';
    var meta = [deadlineBadge(p.deadline)];
    if (p.status === 'check') meta.push('<span class="badge check">À vérifier</span>');
    if (p.arrivedAt || p.receivedAt) meta.push('<span>' + arrivedText(p.arrivedAt || p.receivedAt) + '</span>');
    if (p.label) meta.push('<span>' + esc(p.label) + '</span>');
    if (who(p)) meta.push('<span>' + esc(who(p)) + '</span>');
    if (!p.label && p.tracking) meta.push('<span>N° ' + esc(p.tracking) + '</span>');
    var note = p.status === 'check'
      ? '<p class="check-note">' + esc(p.snippet || p.subject || '') + (p.gmailUrl ? ' <a href="' + esc(p.gmailUrl) + '" target="_blank" rel="noopener">Ouvrir l\'e-mail</a>' : '') + '</p>'
      : '';
    return '<div class="parcel">' + body +
      '<div class="parcel-foot"><div class="parcel-meta">' + meta.join('') + '</div><div class="parcel-actions">' + actions + '</div></div>' +
      note + '</div>';
  }

  function renderReady() {
    var groups = {}, order = [];
    visible('ready').forEach(function (p) {
      var loc = p.location || { name: 'Lieu inconnu', address: '' };
      var key = p.carrier + '|' + fold(loc.name);
      if (!groups[key]) { groups[key] = { carrier: p.carrier, loc: loc, items: [] }; order.push(key); }
      groups[key].items.push(p);
    });
    if (!order.length) return empty(filter === 'all' ? 'Aucun colis à retirer' : 'Aucun colis ' + CARRIERS[filter].name, demo || cfg ? 'Touche ↻ pour relire le libellé Vinted de Gmail.' : 'Connecte l\'appli avec ton lien d\'installation.');
    function first(g) { return g.items.reduce(function (m, p) { return p.deadline && (!m || p.deadline < m) ? p.deadline : m; }, null) || '9999'; }
    order.sort(function (a, b) { return first(groups[a]).localeCompare(first(groups[b])) || groups[a].loc.name.localeCompare(groups[b].loc.name); });
    return order.map(function (key) {
      var g = groups[key], c = CARRIERS[g.carrier] || OTHER, n = g.items.length;
      g.items.sort(function (a, b) { return String(a.deadline || '9999').localeCompare(String(b.deadline || '9999')) || String(a.arrivedAt).localeCompare(String(b.arrivedAt)); });
      var addr = g.loc.address ? '<a href="' + esc(mapsUrl(g.loc)) + '" target="_blank" rel="noopener">' + esc(g.loc.address) + '</a>' : '';
      return '<section class="place">' +
        '<div class="place-head">' + mark(c) + '<div class="place-title"><strong>' + esc(g.loc.name) + '</strong>' +
        '<div class="place-meta"><span>' + c.name + '</span>' + addr + '</div></div>' +
        (n > 1 ? '<span class="count">' + n + ' colis</span>' : '') + '</div>' +
        g.items.map(parcelHtml).join('') +
        (n > 1 ? '<div class="place-foot"><button class="all-done" data-done="' + g.items.map(function (p) { return esc(p.id); }).join(',') + '">' +
          'Tout récupéré ici (' + n + ')</button></div>' : '') + '</section>';
    }).join('');
  }

  function rowHtml(p, button) {
    var c = CARRIERS[p.carrier] || OTHER;
    var title = p.label || (p.location && p.location.name) || p.subject || c.name;
    var sub = [c.name, p.code ? 'code ' + p.code : '', p.doneAt ? 'récupéré ' + stamp(p.doneAt) : ''].filter(Boolean).join(' · ');
    return '<div class="row">' + mark(c) + '<strong>' + esc(title) + '</strong>' +
      button + '<small>' + esc(sub) + '</small></div>';
  }
  function renderDone() {
    var list = visible('done').sort(function (a, b) { return String(b.doneAt).localeCompare(String(a.doneAt)); });
    if (!list.length) return empty('Aucun colis récupéré', 'Les colis marqués récupérés restent ici 7 jours, au cas où.');
    return list.map(function (p) { return rowHtml(p, '<button data-undone="' + esc(p.id) + '">Annuler</button>'); }).join('');
  }
  function empty(title, text) { return '<div class="empty"><strong>' + esc(title) + '</strong>' + esc(text) + '</div>'; }

  // Les 7 prochains jours : un point par jour, chiffré quand des colis doivent être retirés ce jour-là.
  function renderWeek() {
    var list = visible('ready').filter(function (p) { return p.deadline; });
    var late = list.filter(function (p) { return daysLeft(p.deadline) < 0; }).length;
    var soon = list.filter(function (p) { var n = daysLeft(p.deadline); return n >= 0 && n <= 1; }).length;
    var alert = late + soon;
    var cells = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(); d.setDate(d.getDate() + i);
      var iso = localIso(d);
      var n = list.filter(function (p) { return p.deadline === iso || (i === 0 && p.deadline < iso); }).length;
      var cls = 'day' + (i === 0 ? ' today' : '') + (n ? ' has' : '') + (i === 0 && late ? ' late' : '');
      cells += '<div class="' + cls + '" aria-label="' + (n ? n + ' colis à retirer avant le ' + shortDate(iso) : shortDate(iso)) + '">' +
        '<span class="dot">' + (n || '') + '</span><b>' + DAYS[d.getDay()] + '</b></div>';
    }
    return '<div class="week-head"><span>Dates limites</span>' +
      (alert ? '<span class="week-alert" title="À retirer aujourd\'hui ou demain">' + alert + ' ' + ICON_CLOCK + '</span>' : '') + '</div>' +
      '<div class="days">' + cells + '</div>';
  }

  function render() {
    $('list').innerHTML = tab === 'ready' ? renderReady() : renderDone();
    var all = byStatus('ready');
    function count(c) { return all.filter(function (p) { return p.carrier === c; }).length; }
    var r = visible('ready').length;
    $('n-ready').textContent = r;
    $('hero-label').innerHTML = 'colis<br>à retirer';
    $('n-all').textContent = all.length;
    $('n-mondialrelay').textContent = count('mondialrelay');
    $('n-vintedgo').textContent = count('vintedgo');
    document.querySelectorAll('[data-filter]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filter === filter)); });
    $('week').hidden = tab !== 'ready';
    if (tab === 'ready') $('week').innerHTML = renderWeek();
    var name = filter === 'all' ? '' : CARRIERS[filter].name;
    $('list-title').textContent = tab === 'ready' ? 'À retirer' : 'Récupérés';
    $('list-sub').textContent = [name, tab === 'done' ? 'gardés 7 jours' : ''].filter(Boolean).join(' · ');
    document.querySelectorAll('[data-tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === tab)); });
    var st = $('status');
    st.classList.toggle('offline', offline);
    if (demo) st.textContent = 'Démo · données fictives';
    else if (!cfg) st.textContent = 'Non connecté · touche ici pour configurer';
    else st.textContent = (offline ? 'Hors ligne · ' : '') + 'Mis à jour ' + stamp(data && data.updatedAt) + (queue.length ? ' · ' + queue.length + ' en attente' : '');
  }

  // ---------- Serveur (Apps Script) ----------
  function api(action, params) {
    var url = cfg.api + '?t=' + encodeURIComponent(cfg.token) + '&action=' + action;
    Object.keys(params || {}).forEach(function (k) { url += '&' + k + '=' + encodeURIComponent(params[k]); });
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (j) {
      if (j.error) throw Object.assign(new Error(j.error), { fatal: true });
      return j;
    });
  }
  function setData(j) {
    data = { updatedAt: j.updatedAt, parcels: j.parcels || [] };
    if (!demo) save(KEY.data, data);
  }
  function flush() {
    if (!queue.length) return Promise.resolve(null);
    var job = queue[0];
    return api(job.action, job.params).then(function (j) {
      queue.shift(); save(KEY.queue, queue);
      return queue.length ? flush() : j;
    }, function (e) {
      // Une action refusée par le serveur ne doit pas bloquer la file.
      if (e.fatal) { queue.shift(); save(KEY.queue, queue); return flush(); }
      throw e;
    });
  }
  function send(action, params) {
    if (demo) return;
    queue.push({ action: action, params: params });
    save(KEY.queue, queue);
    sync('list');
  }
  var syncing = null;
  function sync(action) {
    if (demo || !cfg) return Promise.resolve();
    if (syncing) return syncing;
    var btn = $('refresh');
    if (action === 'scan') btn.classList.add('spin');
    syncing = flush().then(function () { return api(action || 'list'); }).then(function (j) {
      offline = false; lastSync = Date.now(); setData(j); render();
      if (action === 'scan') toast(j.added ? j.added + ' nouvel e-mail' + (j.added > 1 ? 's' : '') + ' lu' + (j.added > 1 ? 's' : '') : 'Rien de nouveau');
    }).catch(function (e) {
      offline = !e.fatal; render();
      if (action === 'scan' || e.fatal) toast(e.fatal ? 'Erreur : ' + e.message : 'Hors ligne · données conservées');
    }).then(function () { btn.classList.remove('spin'); syncing = null; });
    return syncing;
  }

  // ---------- Actions ----------
  var toastTimer = null, toastUndo = null;
  function toast(text, actionLabel, onAction, onExpire) {
    if (toastUndo) { var prev = toastUndo; toastUndo = null; prev(); }
    clearTimeout(toastTimer);
    $('toast-text').textContent = text;
    var b = $('toast-action');
    b.hidden = !actionLabel;
    b.textContent = actionLabel || '';
    b.onclick = function () { toastUndo = null; clearTimeout(toastTimer); $('toast').hidden = true; if (onAction) onAction(); };
    toastUndo = onExpire || null;
    $('toast').hidden = false;
    toastTimer = setTimeout(function () {
      $('toast').hidden = true;
      if (toastUndo) { var f = toastUndo; toastUndo = null; f(); }
    }, actionLabel ? 5000 : 1800);
  }

  function markDone(ids) {
    ids.forEach(function (id) { pendingHide[id] = true; });
    render();
    toast(ids.length > 1 ? ids.length + ' colis récupérés' : 'Colis récupéré', 'Annuler', function () {
      ids.forEach(function (id) { delete pendingHide[id]; });
      render();
    }, function commit() {
      var now = new Date().toISOString();
      data.parcels.forEach(function (p) { if (ids.indexOf(p.id) >= 0) { p.status = 'done'; p.doneAt = now; } });
      ids.forEach(function (id) { delete pendingHide[id]; });
      if (!demo) save(KEY.data, data);
      render();
      send('done', { ids: ids.join(',') });
    });
  }

  function markUndone(id) {
    data.parcels.forEach(function (p) { if (p.id === id) { p.status = p.code ? 'ready' : 'check'; p.doneAt = null; } });
    if (!demo) save(KEY.data, data);
    render();
    send('undone', { id: id });
  }

  function copy(code) {
    var done = function () { toast('Code ' + code + ' copié'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(code).then(done, done);
    else done();
  }

  function showQr(id) {
    var p = data.parcels.filter(function (x) { return x.id === id; })[0];
    if (!p || !(p.qr || p.qrUrl)) return;
    $('qr-img').src = p.qr || p.qrUrl;
    $('qr-code').textContent = p.code || '';
    $('qr').hidden = false;
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-copy],[data-qr],[data-done],[data-undone],[data-tab],[data-filter]');
    if (!t) return;
    if (t.dataset.copy) copy(t.dataset.copy);
    else if (t.dataset.qr) showQr(t.dataset.qr);
    else if (t.dataset.done) markDone(t.dataset.done.split(','));
    else if (t.dataset.undone) markUndone(t.dataset.undone);
    else if (t.dataset.tab) {
      tab = t.dataset.tab;
      render();
      window.scrollTo(0, 0);
    } else if (t.dataset.filter) {
      // Toucher le filtre déjà choisi revient à « Tous ».
      filter = t.dataset.filter === filter ? 'all' : t.dataset.filter;
      save(KEY.filter, filter);
      render();
    }
  });
  $('qr').addEventListener('click', function () { $('qr').hidden = true; });
  $('refresh').addEventListener('click', function () { if (!cfg && !demo) openSetup(); else if (demo) toast('Démo : rien à actualiser'); else sync('scan'); });
  $('status').addEventListener('click', openSetup);

  // Ajout manuel
  $('add').addEventListener('click', function () {
    var names = {};
    (data && data.parcels || []).forEach(function (p) { if (p.location) names[p.location.name] = 1; });
    $('places').innerHTML = Object.keys(names).map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
    $('add-form').reset();
    if (filter !== 'all') $('add-form').carrier.value = filter;
    $('sheet').hidden = false;
  });
  $('add-cancel').addEventListener('click', function () { $('sheet').hidden = true; });
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) $('sheet').hidden = true; });
  $('add-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target, id = 'm' + Date.now().toString(36);
    var known = (data && data.parcels || []).filter(function (p) { return p.location && p.location.name === f.place.value.trim(); })[0];
    var p = {
      id: id, carrier: f.carrier.value, status: 'ready', source: 'manual',
      code: f.code.value.replace(/\s+/g, '').toUpperCase(), deadline: f.deadline.value || null,
      location: known ? known.location : { name: f.place.value.trim(), address: '', type: 'locker' },
      receivedAt: new Date().toISOString(), arrivedAt: new Date().toISOString(),
    };
    data = data || { updatedAt: null, parcels: [] };
    data.parcels.push(p);
    if (!demo) save(KEY.data, data);
    $('sheet').hidden = true;
    tab = 'ready';
    render();
    send('add', { id: id, carrier: p.carrier, code: p.code, deadline: p.deadline || '', place: p.location.name });
    toast('Code ajouté');
  });

  // Connexion
  function openSetup() { if (!demo) $('setup').hidden = false; }
  $('setup').addEventListener('click', function (e) { if (e.target === $('setup') && cfg) $('setup').hidden = true; });
  $('setup-form').addEventListener('submit', function (e) {
    e.preventDefault();
    if (applyLink(e.target.link.value.trim())) { $('setup').hidden = true; sync('list'); }
    else toast('Lien invalide');
  });
  $('demo').addEventListener('click', function () { location.hash = 'demo'; location.reload(); });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && Date.now() - lastSync > 60000) sync('list');
  });
  window.addEventListener('online', function () { sync('list'); });
  // Lien d'installation ouvert alors que l'appli est déjà affichée : on repart de zéro avec lui.
  window.addEventListener('hashchange', function () { if (location.hash.length > 1) location.reload(); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');

  render();
  if (!cfg && !demo) openSetup();
  else sync('list');

  // ---------- Données de démonstration ----------
  function demoData() {
    function inDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return localIso(d); }
    function ago(h) { return new Date(Date.now() - h * 3600000).toISOString(); }
    var laval = { name: 'Locker 24/7 Intermarché', address: '215 Avenue Chanzy, 53000 Laval', type: 'locker' };
    var evron = { name: 'Lockers Super U Evron', address: 'ZA du Bois, 53600 Evron', type: 'locker' };
    var presse = { name: 'Le Kiosque', address: '1 Rue de la Gare, Laval', type: 'relay' };
    return {
      updatedAt: ago(1.5),
      parcels: [
        { id: 'd1', carrier: 'mondialrelay', status: 'ready', code: '482913', deadline: inDays(4), arrivedAt: ago(26), location: laval, holder: 'Camille Martin', tracking: '44966360' },
        { id: 'd2', carrier: 'mondialrelay', status: 'ready', code: '771204', deadline: inDays(1), arrivedAt: ago(70), location: laval, holder: 'Camille Martin', tracking: '80775437' },
        { id: 'd3', carrier: 'vintedgo', status: 'ready', code: '297138', deadline: inDays(5), arrivedAt: ago(5), location: presse, label: 'American Vintage Cardigan', holder: 'Camille Martin', qr: fakeQr('297138') },
        { id: 'd4', carrier: 'vintedgo', status: 'ready', code: '659758', deadline: inDays(0), arrivedAt: ago(98), location: evron, label: 'Patagonia Retro-X', holder: 'Sam Martin', qr: fakeQr('659758') },
        { id: 'd5', carrier: 'vintedgo', status: 'check', code: null, deadline: null, arrivedAt: ago(3), location: presse, snippet: 'Ton colis Vinted Go est arrivé. Ouvre l\'appli pour voir ton code.', gmailUrl: 'https://mail.google.com/' },
        { id: 'd6', carrier: 'mondialrelay', status: 'done', code: '571168', location: laval, doneAt: ago(26), arrivedAt: ago(80) },
      ],
    };
  }

  // Faux QR (motif déterministe) pour la démo uniquement.
  function fakeQr(seed) {
    var n = 25, cells = '', h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    function rnd() { h ^= h << 13; h >>>= 0; h ^= h >>> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; }
    function finder(x, y) { return '<path d="M' + x + ' ' + y + 'h7v7h-7zM' + (x + 1) + ' ' + (y + 1) + 'v5h5v-5z" fill-rule="evenodd"/><rect x="' + (x + 2) + '" y="' + (y + 2) + '" width="3" height="3"/>'; }
    for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
      var inFinder = (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9);
      if (!inFinder && rnd() > 0.52) cells += 'M' + x + ' ' + y + 'h1v1h-1z';
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 ' + (n + 4) + ' ' + (n + 4) + '" shape-rendering="crispEdges"><rect x="-2" y="-2" width="' + (n + 4) + '" height="' + (n + 4) + '" fill="#fff"/><g fill="#000">' +
      finder(0, 0) + finder(n - 7, 0) + finder(0, n - 7) + '<path d="' + cells + '"/></g></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }
})();
