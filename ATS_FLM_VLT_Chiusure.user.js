// ==UserScript==
// @name         ATS FLM → VLT · Chiusure
// @namespace    ats-spa.flm
// @author       Daniele Izzo
// @version      1.0.13
// @description  Chiude su VLT ingressi del giorno (op. linea), ACK, RMA e spare ferme in HUB con i dati dell'app "ATS - Fastweb FLM". Sostituisce i 4 script con i CSV.
// @match        https://logistictoolvf.net.vodafone.it/*
// @match        https://ats-spa.github.io/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_openInTab
// @grant        unsafeWindow
// @sandbox      JavaScript
// @run-at       document-idle
// ==/UserScript==

/*  COME FUNZIONA
    • Sull'app (ats-spa.github.io) lo script fa da ponte: l'app gli passa la coda delle schede da chiudere
      (dal database, niente più CSV pubblici) e lui gli restituisce gli esiti, che finiscono nel foglio VLT_CHIUSURE.
    • Su VLT mostra il riquadro "ATS" in basso a destra: ▶ Avvia, ⏸ Pausa, ■ Ferma, Prova 1, Riprova errori, Report.
      "Prendi dati da ATS" chiede la coda all'app (se l'app non è aperta la apre lui).
    • Ogni scheda: apre l'FR, aspetta che VLT abbia caricato QUELLA scheda, legge lo stato vero, fa solo i passi
      che mancano e considera salvato solo quando VLT risponde OK al salvataggio. Se lo stato è già quello finale
      la scheda è "già a posto" e non viene toccata. In caso di errore riprova una volta, poi passa alla successiva.
*/
(function () {
  'use strict';
  var VER = '1.0.13';
  var VLT_HOST = 'logistictoolvf.net.vodafone.it';
  var K = { CODA: 'ats_coda', STATO: 'ats_stato_', PEND: 'ats_esiti_pending', RICH: 'ats_richiesta', APP: 'ats_app_url', VIVO: 'ats_vlt_vivo', RUN: 'ats_run', UI: 'ats_ui', RICEVUTI: 'ats_esiti_ricevuti' };
  // esiti da consegnare = scritti da VLT (PEND) meno quelli già confermati dall'app (RICEVUTI): ognuno scrive solo la sua chiave
  var daConsegnare = function () { var ok = {}; get(K.RICEVUTI, []).forEach(function (i) { ok[i] = 1; }); return get(K.PEND, []).filter(function (e) { return !ok[e.id_esito]; }); };
  // posizione standard scritta su VLT (come nei vecchi script)
  var POS = { sala: 'A', scaffale: '1', piano: 'A' };
  var DEPOSITO_RMA = 'HUB_';
  var W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) ? unsafeWindow : window;
  var get = function (k, d) { try { var v = GM_getValue(k); return v === undefined ? d : v; } catch (e) { return d; } };
  var set = function (k, v) { try { GM_setValue(k, v); } catch (e) { } };
  var del = function (k) { try { GM_deleteValue(k); } catch (e) { } };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  var adesso = function () { var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()); };
  var oggi = function () { return adesso().slice(0, 10); };
  var riassunto = function (c) {
    if (!c) return null; var st = get(K.STATO + c.id, {}), f = 0;
    Object.keys(st).forEach(function (k) { if (st[k].esito === 'OK' || st[k].esito === 'GIA_FATTO') f++; });
    return { id: c.id, proc: c.proc, nome: c.nome, giorno: c.giorno, n: (c.items || []).length, fatte: f };
  };

  if (location.hostname === VLT_HOST) { if (window.top === window.self) latoVlt(); }
  else latoApp();

  // ═══════════════════════════ LATO APP (ponte) ═══════════════════════════
  function latoApp() {
    if (!document.querySelector('meta[name="ats-vlt-bridge"]')) return;
    set(K.APP, location.href.split('#')[0]);
    var dest = (location.origin === 'null' || location.protocol === 'file:') ? '*' : location.origin;
    var post = function (m) { m.src = 'ATS-VLT-TM'; window.postMessage(m, dest); };
    var pronto = function () { post({ tipo: 'ready', ver: VER, coda: riassunto(get(K.CODA, null)), richiesta: get(K.RICH, null) }); };
    var pendenti = function () { var p = daConsegnare(); if (p.length) post({ tipo: 'esiti', esiti: p }); };
    window.addEventListener('message', function (ev) {
      // niente confronto ev.source === window: in Tampermonkey "window" è un involucro e il confronto fallisce sempre
      var m = ev.data; if (!m || m.src !== 'ATS-VLT-APP' || (dest !== '*' && ev.origin !== location.origin)) return;
      if (m.tipo === 'ping') { pronto(); pendenti(); }
      else if (m.tipo === 'coda' && m.coda) {
        var c = m.coda; set(K.STATO + c.id, {}); set(K.CODA, c);
        // pulizia stati di code vecchie
        try { var ids0 = get('ats_code_ids', []).concat(c.id); ids0.slice(0, -5).forEach(function (x) { del(K.STATO + x); }); set('ats_code_ids', ids0.slice(-5)); } catch (e) { }
        if (m.richiesta) del(K.RICH);
        post({ tipo: 'coda_ok', coda: riassunto(c) });
        if (m.apri && (Date.now() - get(K.VIVO, 0)) > 12000) { try { GM_openInTab('https://' + VLT_HOST + '/' + (c.proc === 'RMA' ? '#/rma' : '#/fail-rep'), { active: true }); } catch (e) { } }
      }
      else if (m.tipo === 'esiti_ok') {
        set(K.RICEVUTI, get(K.RICEVUTI, []).concat(m.ids || []).slice(-4000));
      }
    });
    try {
      GM_addValueChangeListener(K.PEND, function (k, o, n, remoto) { if (remoto) pendenti(); });
      GM_addValueChangeListener(K.RICH, function (k, o, n, remoto) { if (remoto && n) post({ tipo: 'richiesta', richiesta: n }); });
      GM_addValueChangeListener(K.CODA, function (k, o, n, remoto) { if (remoto) pronto(); });
    } catch (e) { }
    document.documentElement.setAttribute('data-ats-vlt', VER);
    pronto(); pendenti(); setTimeout(pronto, 2000); setTimeout(pronto, 6000);
  }

  // ═══════════════════════════ LATO VLT ═══════════════════════════
  function latoVlt() {
    var TAB = Math.random().toString(36).slice(2, 8);
    var RUN = { on: false, pausa: false, stop: false, attesa: null };
    function Ferma() { this.message = 'fermato'; }
    function Errore(msg, codice, extra) { var e = new Error(msg); e.codice = codice || ''; if (extra) Object.keys(extra).forEach(function (k) { e[k] = extra[k]; }); return e; }

    // ── rete: registro le risposte di VLT (caricamento scheda e salvataggi) ──
    var NET = [];
    (function () {
      try {
        var P = W.XMLHttpRequest.prototype, o = P.open, s = P.send;
        P.open = function (m, u) { this.__ats = { m: String(m || '').toUpperCase(), u: String(u || '') }; return o.apply(this, arguments); };
        P.send = function () {
          var x = this, i = x.__ats || { m: '', u: '' }; i.t0 = Date.now();
          x.addEventListener('loadend', function () {
            var b = ''; try { if (!x.responseType || x.responseType === 'text') b = String(x.responseText || '').slice(0, 3000); else if (x.responseType === 'json') b = JSON.stringify(x.response).slice(0, 3000); } catch (e) { }
            NET.push({ m: i.m, u: i.u, s: x.status, t0: i.t0, t: Date.now(), b: b }); if (NET.length > 300) NET.shift();
          });
          return s.apply(this, arguments);
        };
      } catch (e) { console.warn('[ATS] intercettazione XHR non attiva', e); }
      try {
        var f0 = W.fetch;
        if (f0) W.fetch = function (inp, init) {
          var u = typeof inp === 'string' ? inp : (inp && inp.url) || '', m = String((init && init.method) || (inp && inp.method) || 'GET').toUpperCase(), t0 = Date.now();
          return f0.apply(this, arguments).then(function (r) {
            try { r.clone().text().then(function (b) { NET.push({ m: m, u: u, s: r.status, t0: t0, t: Date.now(), b: String(b).slice(0, 3000) }); }).catch(function () { NET.push({ m: m, u: u, s: r.status, t0: t0, t: Date.now(), b: '' }); }); } catch (e) { }
            return r;
          }, function (err) { NET.push({ m: m, u: u, s: 0, t0: t0, t: Date.now(), b: String(err) }); throw err; });
        };
      } catch (e) { }
    })();
    // VLT scrive in console "SALVATO UPDATE this.rma" quando il salvataggio va a buon fine: lo registro
    var SALVATI = [];
    (function () {
      try {
        var C = W.console, l0 = C.log;
        C.log = function () { try { var a = String(arguments[0] == null ? '' : arguments[0]); if (/^\s*SALVATO\s+(UPDATE|CREATE)/i.test(a)) SALVATI.push(Date.now()); } catch (e) { } return l0.apply(this, arguments); };
      } catch (e) { }
    })();
    var netAttendi = async function (pred, ms, da) {
      var fine = Date.now() + ms;
      while (Date.now() < fine) {
        if (RUN.stop) throw new Ferma();
        for (var i = NET.length - 1; i >= 0; i--) { var e = NET[i]; if (e.t0 >= da && pred(e)) return e; }
        await sleep(120);
      }
      return null;
    };
    var msgServer = function (b) { try { var j = JSON.parse(b); return ' · ' + [j.title, j.detail, j.message].filter(Boolean).join(' · '); } catch (e) { return ''; } };

    // ── DOM ──
    var $ = function (s, r) { return (r || document).querySelector(s); };
    var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
    var norm = function (s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase(); };
    var attendi = async function (fn, ms, passo) {
      var fine = Date.now() + (ms || 15000);
      while (Date.now() < fine) {
        if (RUN.stop) throw new Ferma();
        var r = null; try { r = fn(); } catch (e) { }
        if (r) return r;
        await sleep(passo || 150);
      }
      return null;
    };
    var scrivi = function (el, v) {
      if (!el) return false;
      var proto = el.tagName === 'TEXTAREA' ? W.HTMLTextAreaElement.prototype : W.HTMLInputElement.prototype;
      var d = Object.getOwnPropertyDescriptor(proto, 'value');
      try { el.focus(); } catch (e) { }
      if (d && d.set) d.set.call(el, v == null ? '' : String(v)); else el.value = v == null ? '' : String(v);
      ['input', 'change', 'blur'].forEach(function (t) { el.dispatchEvent(new Event(t, { bubbles: true })); });
      return true;
    };
    var testoSel = function (sel) { return sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text.trim() : ''; };
    var opzione = function (sel, t) {
      var n = norm(t), o = Array.prototype.slice.call(sel.options);
      return o.find(function (x) { return norm(x.text) === n; }) || o.find(function (x) { return norm(x.text).indexOf(n) === 0; }) || null;
    };
    var scegli = async function (selId, testo) {
      var sel = await attendi(function () { return $(selId); }, 8000);
      if (!sel) throw Errore('Menu stato non trovato');
      var o = opzione(sel, testo);
      if (!o) throw Errore('Su VLT lo stato "' + testo + '" non è selezionabile da "' + testoSel(sel) + '"', 'INATTESO');
      sel.value = o.value; o.selected = true;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(450);
      if (norm(testoSel(sel)) !== norm(o.text)) throw Errore('VLT non ha accettato lo stato "' + testo + '"');
    };
    var posizione = function (a, b, c) { scrivi($(a), POS.sala); scrivi($(b), POS.scaffale); scrivi($(c), POS.piano); };
    var campiScrap = async function () {
      var bin = await attendi(function () { return $('#field_scrapBin'); }, 6000);
      scrivi(bin, 'Scrap'); scrivi($('#field_scrapNote'), 'Non Riparabile');
    };
    var esciForm = async function () {
      var b = $$('button').find(function (x) { return /annulla|indietro|back/i.test(x.textContent.trim()) && x.offsetParent; });
      if (b) b.click(); else history.back();
      await attendi(function () { return $('input#currentSearch'); }, 8000);
    };
    var chiudiErrore = function () {
      var b = $$('button').find(function (x) { return /^(annulla|chiudi|ok)$/i.test(x.textContent.trim()) && x.offsetParent; });
      if (b) try { b.click(); } catch (e) { }
    };

    // ── apri l'FR e aspetta che sia caricata proprio quella scheda ──
    var RX_FR = /fail-?reps?\b/i;
    var apriFR = async function (fr) {
      fr = String(fr).trim();
      var target = '#/fail-rep/' + fr + '/edit';
      if ($('#field_frStatus') || /\/edit/.test(location.hash)) {
        location.hash = '#/fail-rep';
        await attendi(function () { return !$('#field_frStatus'); }, 10000);
        await sleep(250);
      }
      var t0 = Date.now(); location.hash = target;
      var rx = new RegExp('fail-?reps?/' + fr + '(\\?|/|$)', 'i');
      var g = await netAttendi(function (e) { return e.m === 'GET' && rx.test(e.u); }, 15000, t0);
      if (g && g.s === 404) throw Errore('FR ' + fr + ' non trovato su VLT', 'NON_TROVATO');
      if (g && g.s >= 400) throw Errore('VLT ha risposto ' + g.s + ' aprendo la scheda' + msgServer(g.b));
      // pronta = menu stato con lo stato attuale scelto (una FR in OPEN può avere un solo stato nel menu)
      var sel = await attendi(function () { var s = $('#field_frStatus'); return s && s.options.length >= 1 && testoSel(s) ? s : null; }, 20000);
      if (!sel) throw Errore('La scheda FR ' + fr + ' non si è caricata (VLT lento?)');
      await sleep(500);
      var idf = $('#field_id');
      if (idf && idf.value && String(idf.value).trim() !== fr) throw Errore('Si è aperta un\'altra scheda (' + idf.value + ')');
      return testoSel(sel);
    };
    // ── salva e considera fatto solo con la risposta OK di VLT ──
    var salva = async function (rx) {
      var ic = await attendi(function () { return $('svg[data-icon="save"]'); }, 8000);
      var btn = ic && ic.closest('button');
      if (!btn) throw Errore('Tasto Salva non trovato');
      await attendi(function () { return !btn.disabled; }, 2500);
      if (btn.disabled) {
        var inv = $$('form .ng-invalid[id], form .ng-invalid[formcontrolname], form .is-invalid[id]').map(function (e) { return String(e.id || e.getAttribute('formcontrolname')).replace(/^field_/, ''); });
        throw Errore('VLT non fa salvare: campi obbligatori ' + (inv.length ? inv.join(', ') : 'mancanti'), 'MODULO');
      }
      var idS = String(($('#field_id') || {}).value || (/\/(\d+)\/edit/.exec(location.hash) || [])[1] || '').trim();
      var scrittura = function (e) { return e.t0 >= t0 && (e.m === 'PUT' || e.m === 'POST' || e.m === 'PATCH') && rx.test(e.u); };
      // conferma di VLT a video: messaggio verde "... is updated/created with identifier <id>"
      var conferma = function () { var t = norm(document.body.innerText); return /(is|è) (updated|created|aggiornat|creat)\w* with identifier|with identifier/.test(t) && (!idS || t.indexOf(idS.toLowerCase()) >= 0); };
      var t0 = Date.now(); btn.click();
      var r = await netAttendi(scrittura, 25000, t0);
      if (!r) {
        if (norm(document.body.innerText).indexOf('internal server error') >= 0) { chiudiErrore(); throw Errore('Errore 500 di VLT'); }
        var via = await attendi(function () { return !/\/edit/.test(location.hash) || conferma(); }, 4000);
        if (via) return { verificato: false };
        throw Errore('Nessuna conferma del salvataggio da VLT');
      }
      // VLT può fare più chiamate (una annullata con stato 0, una secondaria in errore): basta che una risponda OK
      await sleep(1500);
      var W = NET.filter(scrittura), ok = W.filter(function (e) { return e.s >= 200 && e.s < 300; });
      if (!ok.length) {
        var esce = await attendi(function () { return conferma() || !/\/edit/.test(location.hash); }, 5000);
        var ko = W.filter(function (e) { return e.s >= 400; });
        if (conferma() || (esce && !ko.length)) { console.log('[ATS→VLT] salvataggio confermato da VLT a video (rete: ' + W.map(function (e) { return e.m + ' ' + e.s; }).join(', ') + ')'); return { verificato: true }; }
        var k = ko[ko.length - 1] || W[W.length - 1]; chiudiErrore(); throw Errore('Salvataggio rifiutato da VLT (' + k.s + ')' + msgServer(k.b));
      }
      await attendi(function () { return !/\/edit/.test(location.hash); }, 5000);
      return { verificato: true };
    };

    // ═══ PROCEDURE (stessa logica stati dei vecchi script) ═══
    var FINALI = ['close for scrap material', 'good material received', 'pending service desk', 'failure report sent'];
    var NOTI = ['failed material sent', 'failed material received and verify', 'open'];
    var esitoOk = function (prima, dopo, det) { return { esito: 'OK', stato_prima: prima, stato_dopo: dopo, dettaglio: det || '' }; };
    var RX_OK = /(^|[^A-Z])OK([^A-Z]|$)/i;
    var chiudiFR = async function (it, proc) {
      var S0 = await apriFR(it.fr), s = norm(S0), note = String(it.note || '').trim(), scrap = /scrap/i.test(note), bonif = false;
      // Spare ferme in HUB: nota VLT con "OK" = bonificata dal Service Desk → la nota si ignora, chiusura normale
      if (proc === 'FERME' && !scrap) {
        var nv = $('#field_note'), testoNv = nv ? String(nv.value || '') : '';
        if (it.bonificata || RX_OK.test(testoNv)) { bonif = true; note = ''; }
      }
      if (FINALI.indexOf(s) >= 0) return { esito: 'GIA_FATTO', stato_prima: S0, stato_dopo: S0, dettaglio: 'già chiusa su VLT' };
      // GOOD tornata dal riparatore
      if (s === 'failed material sent to repairer') {
        if (scrap) { await scegli('#field_frStatus', 'Close for Scrap material'); await campiScrap(); }
        else {
          if (!it.conf_serial) throw Errore('Manca il seriale di conferma', 'DATI');
          await scegli('#field_frStatus', 'Good Material Received');
          var ser = await attendi(function () { return $('#newMaterialSerNo'); }, 8000);
          if (!ser) throw Errore('Campo seriale di conferma non trovato');
          scrivi(ser, it.conf_serial); scrivi($('#newMaterialTMPN'), it.conf_tmpn || '');
          posizione('#field_newsala', '#field_newscaffale', '#field_newpiano');
        }
        await salva(RX_FR);
        return esitoOk(S0, scrap ? 'Close for Scrap material' : 'Good Material Received');
      }
      // Spare ferme in HUB: l'FR in OPEN non si chiude, si segnala (va nella mail al Service Desk) e si passa alla prossima
      if (s === 'open' && proc === 'FERME') return { esito: 'SALTATO', stato_prima: S0, stato_dopo: S0, dettaglio: 'FR in OPEN: non chiudibile, da segnalare al Service Desk' };
      if (s === 'open') {
        var selO = $('#field_frStatus');
        if (selO && opzione(selO, 'Open')) {
          await scegli('#field_frStatus', 'Open');
          if (note) scrivi($('#field_note'), note);
          await salva(RX_FR);
          return esitoOk(S0, 'Open', note ? 'nota inserita' : '');
        }
      }
      if (NOTI.indexOf(s) < 0) return { esito: 'SALTATO', stato_prima: S0, stato_dopo: S0, dettaglio: 'stato VLT inatteso: non toccata' };
      // passo 1: Failed Material Received and Verify
      if (s !== 'failed material received and verify' && (note || s.indexOf('failed material sent') === 0)) {
        await scegli('#field_frStatus', 'Failed Material Received and Verify');
        posizione('#field_failEquiSala', '#field_failEquiScaffale', '#field_failEquiPiano');
        await salva(RX_FR);
        var S1 = await apriFR(it.fr);
        if (norm(S1) !== 'failed material received and verify') throw Errore('Dopo il primo salvataggio la scheda è in "' + S1 + '"');
      } else if (s !== 'failed material received and verify') {
        // nessun passo 1 previsto: resto sulla scheda già aperta
      }
      // passo 2
      if (scrap) {
        await scegli('#field_frStatus', 'Close for Scrap material'); await campiScrap();
        if (note) scrivi($('#field_note'), note);
        await salva(RX_FR); return esitoOk(S0, 'Close for Scrap material');
      }
      if (note) {
        await scegli('#field_frStatus', 'Pending Service Desk');
        posizione('#field_failEquiSala', '#field_failEquiScaffale', '#field_failEquiPiano');
        scrivi($('#field_note'), note);
        await salva(RX_FR); return esitoOk(S0, 'Pending Service Desk');
      }
      await scegli('#field_frStatus', 'Failure Report Sent');
      await salva(RX_FR); return esitoOk(S0, 'Failure Report Sent', bonif ? 'nota VLT con OK: bonificata' : '');
    };
    var chiudiAck = async function (it) {
      var S0 = await apriFR(it.fr);
      if (norm(S0) === 'failed material sent to repairer') return { esito: 'GIA_FATTO', stato_prima: S0, stato_dopo: S0, dettaglio: 'già spedita al riparatore' };
      if (!it.awb) throw Errore('Manca l\'AWB dell\'ACK', 'DATI');
      await scegli('#field_frStatus', 'Failed Material sent to Repairer');
      var a = await attendi(function () { return $('#field_awb2'); }, 8000);
      if (!a) throw Errore('Campo AWB non trovato');
      scrivi(a, it.awb);
      await salva(RX_FR);
      return esitoOk(S0, 'Failed Material sent to Repairer', 'AWB ' + it.awb);
    };
    // RMA: semi-automatico (compila, l'operatore controlla i seriali e salva) — o automatico se spuntato
    var RX_RMA = /rmas?\b/i;
    var chiudiRma = async function (it) {
      var num = String(it.rma).trim().replace(/^RMA\s*/i, '').replace(/^0+(?=\d)/, '');
      var rx = new RegExp('(^|[^0-9])' + num.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^0-9]|$)', 'i');
      // 1) apertura diretta della scheda (#/rma/<numero>/edit): non dipende dalla lista "in attesa di un tuo intervento" né dalla ricerca
      var sel = null;
      if (/^\d+$/.test(num)) {
        if (/\/edit/.test(location.hash)) { location.hash = '#/rma'; await sleep(800); }
        var t1 = Date.now();
        location.hash = '#/rma/' + num + '/edit';
        sel = await attendi(function () { var s = $('select#field_rmaStatus'); return s && s.options.length > 1 && testoSel(s) ? s : null; }, 12000);
        if (!sel) {
          var e404 = NET.find(function (e) { return e.t0 >= t1 && e.s === 404 && new RegExp('/rmas/' + num + '(\\?|/|$)').test(e.u); });
          location.hash = '#/rma'; await sleep(900);
          if (e404) throw Errore('RMA ' + it.rma + ' non trovato su VLT', 'NON_TROVATO');
          UI.log('↻ RMA ' + it.rma + ': apertura diretta non riuscita, lo cerco nella lista');
        }
      }
      if (!sel) sel = await cercaRma(it, num);
      await sleep(450);
      var S0 = testoSel(sel);
      if (norm(S0) === 'shipped from cw') { await esciForm(); return { esito: 'GIA_FATTO', stato_prima: S0, stato_dopo: S0, dettaglio: 'già Shipped From CW' }; }
      if (norm(S0) !== 'to ship from cw') { await esciForm(); return { esito: 'SALTATO', stato_prima: S0, stato_dopo: S0, dettaglio: 'su VLT è in stato "' + S0 + '" (non To Ship From CW): non lo chiudo, controlla su VLT' }; }
      await scegli('select#field_rmaStatus', 'Shipped From CW');
      var avvisi = [];
      var form = sel.closest('form') || document.body, valori = $$('input, textarea', form).map(function (x) { return x.value; }).join(' ') + ' ' + form.textContent;
      if (!rx.test(valori)) avvisi.push('controlla che la scheda aperta sia l\'RMA ' + it.rma);
      var dep = await attendi(function () { return $('input[role="combobox"]'); }, 5000);
      if (dep) { if (!(await deposito(dep))) avvisi.push('scegli tu il deposito di origine'); } else avvisi.push('campo deposito non trovato');
      var aw = $('input#field_awb'); if (aw) scrivi(aw, it.awb || ''); else avvisi.push('campo AWB non trovato');
      if (it.note) { var nt = $('input#field_note') || $('textarea#field_note'); if (nt) scrivi(nt, it.note); }
      return await attendiOperatore(it, S0, avvisi);
    };
    // 2) riserva: ricerca nella lista RMA (come prima)
    var cercaRma = async function (it, num) {
      if (!/^#\/rma(\?|$)/i.test(location.hash) || $('select#field_rmaStatus')) { location.hash = '#/rma'; await sleep(800); }
      var inp = await attendi(function () { return $('input#currentSearch'); }, 15000);
      if (!inp) throw Errore('Non riesco ad aprire la pagina RMA di VLT (https://' + VLT_HOST + '/#/rma): aprila tu, poi premi Riprendi', 'PAGINA');
      // come lo script RMA precedente: valore + solo evento "input" (niente change/blur, che su VLT lanciano ricerche a vuoto in ritardo)
      var d = Object.getOwnPropertyDescriptor(W.HTMLInputElement.prototype, 'value');
      var metti = function (v) { if (d && d.set) d.set.call(inp, v); else inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); };
      try { inp.focus(); } catch (e) { }
      if (norm(inp.value) !== norm(it.rma)) metti(String(it.rma)); await sleep(500);   // niente svuotamento: la ricerca a vuoto ricaricava tutta la lista in ritardo
      var t0 = Date.now();
      var b = $('button.input-group-append.btn.btn-info') || $$('button').find(function (x) { return x.querySelector('svg[data-icon="search"]'); });
      if (b) b.click(); else inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
      // aspetta la risposta della ricerca e che la tabella smetta di cambiare (le risposte in ritardo ridisegnano la lista)
      await netAttendi(function (e) { return e.m === 'GET' && RX_RMA.test(e.u); }, 20000, t0);
      // l'ID su VLT è "RMA214295" e il testo della riga attacca le celle ("RMA21429527/10/2026…"): si confronta cella per cella
      var eRma = function (r) { return $$('td', r).some(function (td) { return String(td.textContent || '').trim().replace(/^RMA\s*/i, '').replace(/^0+(?=\d)/, '') === num; }); };
      var righe = function () { return $$('table tbody tr').filter(function (r) { return r.offsetParent && $$('td', r).length > 1; }); };
      var firma = '', stabile = 0, tr = null, fine = Date.now() + 15000;
      while (Date.now() < fine) {
        if (RUN.stop) throw new Ferma();
        var R = righe(), f = R.length + '|' + (R[0] ? R[0].textContent : '');
        var ultimaGet = NET.reduce(function (m, e) { return e.m === 'GET' && RX_RMA.test(e.u) && e.t0 >= t0 ? Math.max(m, e.t) : m; }, 0);
        stabile = f === firma ? stabile + 1 : 0; firma = f;
        if (stabile >= 3 && Date.now() - ultimaGet > 700) {
          tr = R.find(eRma) || null;   /* solo la riga con quell'ID: VLT può restituire anche altri RMA */
          if (tr) break;
        }
        await sleep(200);
      }
      if (!tr) throw Errore('RMA ' + it.rma + ' non trovato su VLT', 'NON_TROVATO');
      var trova = function (r) { var x = $$('button, a', r); return x.find(function (b) { return b.textContent.trim() === 'Modifica'; }) || x.find(function (b) { return b.querySelector('svg[data-icon="pencil-alt"],svg[data-icon="pencil"]'); }) || x.find(function (b) { return /^(modifica|edit)$/i.test(b.textContent.trim()); }); };
      var ed = trova(tr);
      if (!ed) throw Errore('Tasto Modifica non trovato');
      ed.click();
      // se dopo 5 secondi la modifica non si è aperta (riga ridisegnata nel frattempo) riclicca una volta sulla riga attuale
      var aperto = await attendi(function () { return $('select#field_rmaStatus'); }, 5000);
      if (!aperto) {
        var tr2 = righe().find(eRma) || tr, ed2 = tr2 && document.contains(tr2) ? trova(tr2) : null;
        if (ed2) { UI.log('↻ RMA ' + it.rma + ': la modifica non si era aperta, riclicco'); ed2.click(); }
      }
      var sel = await attendi(function () { var s = $('select#field_rmaStatus'); return s && s.options.length > 1 && testoSel(s) ? s : null; }, 15000);
      if (!sel) throw Errore('La scheda RMA non si è caricata');
      return sel;
    };
    var deposito = async function (inp) {
      scrivi(inp, DEPOSITO_RMA);
      var opts = await attendi(function () { var l = $$('[role="listbox"] [role="option"]'); return l.length ? l : null; }, 3000);
      if (!opts) return false;
      var n = norm(DEPOSITO_RMA), o = opts.find(function (x) { return norm(x.textContent) === n; });
      if (!o) { var st = opts.filter(function (x) { return norm(x.textContent).indexOf(n) === 0; }); if (st.length === 1) o = st[0]; }
      if (!o) return false;
      o.click(); await sleep(250); return true;
    };
    var attendiOperatore = async function (it, S0, avvisi) {
      var t0 = Date.now(), auto = false;   // RMA: salva sempre l'operatore dopo il controllo dei seriali
      UI.seriali(it, avvisi, auto);
      if (auto && !avvisi.length) { try { await salva(RX_RMA); UI.seriali(null); return esitoOk(S0, 'Shipped From CW', 'salvato in automatico · AWB ' + (it.awb || '')); } catch (e) { UI.seriali(it, [e.message], false); } }
      RUN.attesa = null;
      var scrittura = function (e) { return e.t0 >= t0 && (e.m === 'PUT' || e.m === 'POST' || e.m === 'PATCH') && !/account|logout|authenticate|management|websocket|audit/i.test(e.u); };
      var buone = function () { return NET.filter(function (e) { return scrittura(e) && e.s >= 200 && e.s < 300; }); };
      var fatto = function (come) { UI.seriali(null); console.log('[ATS→VLT] RMA ' + it.rma + ' salvato (' + come + ')'); return esitoOk(S0, 'Shipped From CW', 'salvato dall\'operatore · AWB ' + (it.awb || '')); };
      var segnalato = 0;
      // clic dell'operatore su Salva (la risposta di VLT non sempre si vede): serve a distinguere "salvato" da "chiuso con Annulla"
      var cliccato = 0, suClic = function (ev) { var b = ev.target && ev.target.closest ? ev.target.closest('button, span') : null; if (b && ((b.querySelector && b.querySelector('svg[data-icon="save"]')) || /^salva$/i.test(String(b.textContent || '').trim()))) cliccato = Date.now(); };
      var conferma = function () { return /(is|è) (updated|created|aggiornat|creat)\w* with identifier|with identifier/.test(norm(document.body.innerText)); };
      document.addEventListener('click', suClic, true);
      try {
      while (true) {
        if (RUN.stop) { UI.seriali(null); throw new Ferma(); }
        if (RUN.attesa === 'salta') { RUN.attesa = null; UI.seriali(null); if ($('select#field_rmaStatus')) await esciForm(); return { esito: 'SALTATO', stato_prima: S0, stato_dopo: S0, dettaglio: 'saltato dall\'operatore' }; }
        var ok = buone(), aperto = !!$('select#field_rmaStatus');
        if (SALVATI.some(function (t) { return t >= t0; }) && !aperto) { await attendi(function () { return $('input#currentSearch'); }, 8000); return fatto('VLT: SALVATO UPDATE'); }
        if (ok.length && !aperto) { await attendi(function () { return $('input#currentSearch'); }, 8000); return fatto(ok[ok.length - 1].m + ' ' + ok[ok.length - 1].u); }
        if (ok.length && aperto && Date.now() - ok[ok.length - 1].t > 4000) return fatto('risposta OK, scheda ancora aperta');
        if (!aperto) {
          await sleep(1500);
          ok = buone(); if (ok.length) return fatto(ok[ok.length - 1].u);
          // nessuna risposta intercettata: controllo lo stato sulla lista di VLT
          var num2 = String(it.rma).trim().replace(/^RMA\s*/i, '').replace(/^0+(?=\d)/, '');
          var tr = await attendi(function () { return $$('table tbody tr').find(function (r) { return $$('td', r).some(function (td) { return String(td.textContent || '').trim().replace(/^RMA\s*/i, '').replace(/^0+(?=\d)/, '') === num2; }); }); }, 4000);
          if (tr && norm(tr.textContent).indexOf('shipped from cw') >= 0) return fatto('verificato dalla lista');
          // Salva premuto e VLT ha chiuso la scheda senza errori (o messaggio verde "updated with identifier"): salvato
          if (SALVATI.some(function (t) { return t >= t0; })) return fatto('VLT: SALVATO UPDATE');
          // errore solo con una risposta HTTP 400+ di VLT sull'RMA (le richieste interrotte dal cambio pagina, stato 0, non contano)
          var koDopo = NET.filter(function (e) { return scrittura(e) && e.t0 >= cliccato - 500 && e.s >= 400 && /rma/i.test(e.u); });
          if (koDopo.length) console.log('[ATS→VLT] risposte KO dopo Salva', koDopo.map(function (e) { return e.m + ' ' + e.u + ' ' + e.s; }).join(' | '));
          if (conferma()) return fatto('messaggio di conferma di VLT');
          if (cliccato && !koDopo.length) return fatto('Salva premuto, VLT ha chiuso la scheda senza errori');
          UI.seriali(null); return { esito: 'SALTATO', stato_prima: S0, stato_dopo: S0, dettaglio: cliccato ? 'VLT ha risposto con errore al salvataggio: controlla su VLT' : 'scheda chiusa senza premere Salva (Annulla/indietro): non salvata' };
        }
        // errore solo se VLT ha risposto KO, nessuna risposta OK e la scheda è ancora aperta dopo 3 s
        var ko = NET.filter(function (e) { return scrittura(e) && (e.s === 0 || e.s >= 400); });
        if (ko.length > segnalato && Date.now() - ko[ko.length - 1].t > 3000) { segnalato = ko.length; var k = ko[ko.length - 1]; console.log('[ATS→VLT] risposta KO', k.m, k.u, k.s, k.b); UI.seriali(it, ['VLT ha rifiutato il salvataggio (' + k.s + ')' + msgServer(k.b) + ': correggi e salva di nuovo, o Salta'], false); }
        await sleep(300);
      }
      } finally { document.removeEventListener('click', suClic, true); }
    };
    // RMA MNF: dalla lista RMA a video, ogni RMA in "To Ship From CW" → "Material Not Found" (come il vecchio script, ma
    // con pausa/ferma, conferma del salvataggio e senza riaprire due volte lo stesso RMA). Esiti nell'app (procedura MNF).
    var mnf = async function () {
      if (RUN.on) return;
      if (location.href.indexOf('/rma') < 0) { UI.log('⚠ MNF: apri prima la lista RMA di VLT (https://logistictoolvf.net.vodafone.it/#/rma?page=1), poi riprova.'); return; }
      var righe = function () { return $$('table tbody tr').filter(function (r) { return r.offsetParent && $$('td', r).length > 1; }); };
      var n0 = righe().length;
      if (!n0) { UI.log('MNF: nessuna riga nella lista.'); return; }
      if (!confirm('Material Not Found\n\nPorto in "Material Not Found" gli RMA "To Ship From CW" della lista a video (' + n0 + ' righe in questa pagina).\nGli altri stati non vengono toccati.\n\nProcedo?')) return;
      var c = { id: 'MNF' + oggi().replace(/-/g, ''), proc: 'MNF', nome: 'RMA Material Not Found', giorno: oggi(), items: [] };
      RUN.on = true; RUN.stop = false; RUN.pausa = false; UI.agg(); UI.log('▶ MNF: avvio');
      var fatti = {}, nOk = 0, nSalt = 0, fermo = false;
      try {
        while (!RUN.stop) {
          while (RUN.pausa && !RUN.stop) await sleep(300);
          await attendi(function () { return righe().length || null; }, 15000);
          // come lo script originale: la prima riga della lista (saltando quelle già fatte in questo giro)
          var chiave = function (r) { return norm(r.textContent).slice(0, 160); };
          var tr = righe().find(function (r) { return !fatti[chiave(r)] && norm(r.textContent).indexOf('material not found') < 0; });
          if (!tr) break;
          fatti[chiave(tr)] = 1;
          var rma = ($$('td', tr).map(function (td) { return td.textContent.trim(); }).find(function (t) { return /^\d{5,8}$/.test(t); })) || String(($$('td', tr)[0] || {}).textContent || '').trim() || '?';
          UI.ora('MNF · RMA ' + rma);
          var ed = $$('a, button', tr).find(function (x) { return x.textContent.trim() === 'Modifica'; }) || $$('a, button', tr).find(function (x) { return x.querySelector('svg[data-icon="pencil-alt"],svg[data-icon="pencil"]'); });
          if (!ed) { UI.log('✗ ' + rma + ' · tasto Modifica non trovato'); break; }
          ed.click();
          var sel = await attendi(function () { var x = $('select#field_rmaStatus'); return x && x.options.length > 1 && x.selectedIndex >= 0 ? x : null; }, 15000);
          var it = { k: 'MNF:' + rma, rma: rma }, r;
          if (!sel) { r = { esito: 'ERRORE', dettaglio: 'scheda RMA non caricata' }; }
          else {
            await sleep(400); var S0 = testoSel(sel);
            if (norm(S0) !== 'to ship from cw') { await esciForm(); r = { esito: 'SALTATO', stato_prima: S0, stato_dopo: S0, dettaglio: 'stato non To Ship From CW' }; nSalt++; }
            else {
              // passi identici allo script originale: stato → change → 1 s → clic su "Salva" → si torna alla lista
              var o = Array.prototype.slice.call(sel.options).find(function (x) { return x.text.trim() === 'Material Not Found'; });
              if (!o) { r = { esito: 'ERRORE', stato_prima: S0, dettaglio: '"Material Not Found" non presente tra gli stati' }; await esciForm(); }
              else {
                sel.value = o.value; sel.dispatchEvent(new Event('change', { bubbles: true }));
                await sleep(1000);
                var sv = $$('span, button').find(function (el) { return el.textContent.trim() === 'Salva'; });
                if (!sv) { r = { esito: 'ERRORE', stato_prima: S0, dettaglio: 'tasto Salva non trovato' }; await esciForm(); }
                else {
                  var t0 = Date.now(); sv.click(); await sleep(3000);
                  var lista = await attendi(function () { return !$('select#field_rmaStatus') && righe().length ? 1 : null; }, 15000);
                  var ko = NET.filter(function (e) { return e.t0 >= t0 && (e.m === 'PUT' || e.m === 'POST' || e.m === 'PATCH') && e.s >= 400; });
                  if (lista) { r = esitoOk(S0, 'Material Not Found'); nOk++; }
                  else { r = { esito: 'ERRORE', stato_prima: S0, dettaglio: 'la lista non è tornata dopo il salvataggio' + (ko.length ? ' (VLT ' + ko[ko.length - 1].s + msgServer(ko[ko.length - 1].b) + ')' : '') }; fermo = true; }
                }
              }
            }
          }
          c.items.push(it); registra(c, it, r);
          UI.log((r.esito === 'OK' ? '✓ ' : r.esito === 'SALTATO' ? '» ' : '✗ ') + rma + ' · ' + (r.stato_dopo || '') + (r.dettaglio ? ' · ' + r.dettaglio : ''));
          if (fermo) { UI.log('■ MNF fermato: controlla la pagina VLT'); break; }
          await attendi(function () { return $('input#currentSearch'); }, 10000); await sleep(800);
        }
      } catch (e) { if (!(e instanceof Ferma)) UI.log('✗ MNF: ' + e.message); }
      finally { RUN.on = false; RUN.pausa = false; RUN.stop = false; UI.ora('MNF finito: ' + nOk + ' in Material Not Found, ' + nSalt + ' saltati.'); UI.agg(); }
    };
    var PROC = {
      INGRESSI: { nome: 'Ingressi del giorno', fai: chiudiFR },
      FERME: { nome: 'Spare ferme in HUB', fai: function (it) { return chiudiFR(it, 'FERME'); } },
      ACK: { nome: 'ACK del giorno', fai: chiudiAck },
      RMA: { nome: 'RMA del giorno', fai: chiudiRma }
    };

    // ── esecuzione ──
    var eseguiUno = async function (proc, it) {
      var ultimo = null;
      for (var tent = 1; tent <= 2; tent++) {
        try { return await PROC[proc].fai(it); }
        catch (e) {
          if (e instanceof Ferma) throw e;
          ultimo = e;
          if (['NON_TROVATO', 'INATTESO', 'DATI', 'PAGINA', 'MODULO'].indexOf(e.codice) >= 0) break;
          UI.log('↻ riprovo ' + (it.fr || it.rma) + ': ' + e.message); await sleep(1500);
        }
      }
      if (ultimo && ultimo.codice === 'PAGINA') throw ultimo;
      return { esito: 'ERRORE', stato_prima: '', stato_dopo: '', dettaglio: ultimo ? ultimo.message : 'errore' };
    };
    var registra = function (c, it, r) {
      var st = get(K.STATO + c.id, {});
      st[it.k] = { esito: r.esito, dettaglio: r.dettaglio, stato_prima: r.stato_prima, stato_dopo: r.stato_dopo, t: adesso() };
      set(K.STATO + c.id, st);
      var p = daConsegnare();
      p.push({ id_esito: c.id + '|' + it.k + '|' + Date.now(), data_ora: adesso(), giorno: c.giorno, procedura: c.proc, chiave: it.k, esito: r.esito, stato_prima: r.stato_prima || '', stato_dopo: r.stato_dopo || '', dettaglio: r.dettaglio || '', id_coda: c.id });
      set(K.PEND, p.slice(-2000));
    };
    var avvia = async function (modo) {
      if (RUN.on) return;
      var c = get(K.CODA, null);
      if (!c || !(c.items || []).length) { UI.log('Nessuna coda: premi "Prendi dati da ATS" o invia dall\'app.'); return; }
      var lk = get(K.RUN, null);
      if (lk && lk.tab !== TAB && Date.now() - lk.ts < 15000) { UI.log('⚠ Sta già lavorando un\'altra scheda VLT: fermala prima.'); return; }
      RUN.on = true; RUN.stop = false; RUN.pausa = false; UI.agg();
      var hb = setInterval(function () { set(K.RUN, { tab: TAB, ts: Date.now() }); }, 4000); set(K.RUN, { tab: TAB, ts: Date.now() });
      var fatti = 0;
      try {
        var st = get(K.STATO + c.id, {});
        var lista = c.items.filter(function (it) {
          var e = st[it.k] && st[it.k].esito;
          if (modo === 'errori') return e === 'ERRORE';
          return !e || e === 'ERRORE';
        });
        UI.log('▶ ' + c.nome + ': ' + lista.length + ' da fare');
        for (var i = 0; i < lista.length; i++) {
          while (RUN.pausa && !RUN.stop) await sleep(300);
          if (RUN.stop) break;
          var it = lista[i];
          UI.ora((i + 1) + '/' + lista.length + ' · ' + (it.fr ? 'FR ' + it.fr : 'RMA ' + it.rma) + (it.note ? ' · ' + it.note : ''));
          var r;
          try { r = await eseguiUno(c.proc, it); }
          catch (e) {
            if (e instanceof Ferma) break;
            if (e.codice === 'PAGINA') { UI.log('⚠ ' + e.message); break; }
            r = { esito: 'ERRORE', dettaglio: e.message };
          }
          registra(c, it, r); fatti++;
          UI.log((r.esito === 'OK' ? '✓ ' : r.esito === 'GIA_FATTO' ? '= ' : r.esito === 'SALTATO' ? '» ' : '✗ ') + (it.fr || it.rma) + ' · ' + (r.stato_dopo || '') + (r.dettaglio ? ' · ' + r.dettaglio : ''));
          UI.agg();
          if (modo === 'prova') break;
          await sleep(350);
        }
      } finally {
        clearInterval(hb); del(K.RUN);
        RUN.on = false; RUN.pausa = false; UI.ora(RUN.stop ? 'Fermato.' : 'Finito.'); RUN.stop = false; UI.agg();
      }
      var s = UI.conta(c);
      UI.log('■ Fine: ' + s.OK + ' chiuse · ' + s.GIA_FATTO + ' già a posto · ' + s.ERRORE + ' errori · ' + s.SALTATO + ' saltate · ' + s.da + ' da fare');
    };
    var report = function () {
      var c = get(K.CODA, null); if (!c) return;
      var st = get(K.STATO + c.id, {}), q = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
      var righe = [['PROCEDURA', 'GIORNO', 'SCHEDA', 'ESITO', 'STATO_PRIMA', 'STATO_DOPO', 'DETTAGLIO', 'ORA'].join(';')];
      c.items.forEach(function (it) { var e = st[it.k] || {}; righe.push([c.proc, c.giorno, it.fr || it.rma, e.esito || 'DA_FARE', e.stato_prima, e.stato_dopo, e.dettaglio, e.t].map(q).join(';')); });
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + righe.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
      a.download = 'report_vlt_' + c.proc.toLowerCase() + '_' + c.giorno + '.csv'; document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); }, 500);
    };
    var chiediDati = async function (proc) {
      if (RUN.on) { UI.log('Prima ferma la procedura in corso.'); return; }
      var ts = Date.now(), c0 = get(K.CODA, null), id0 = c0 && c0.id;
      set(K.RICH, { proc: proc, giorno: oggi(), ts: ts });
      UI.ora('Chiedo i dati all\'app ATS…');
      var nuova = function () { var c = get(K.CODA, null); return c && c.id !== id0 && c.proc === proc ? c : null; };
      var c = await attendi(nuova, 4000, 200), tab = null;
      if (!c) {
        var url = get(K.APP, '');
        if (!url) { UI.ora(''); UI.log('⚠ Apri una volta l\'app ATS - Fastweb FLM in questo browser, poi riprova.'); del(K.RICH); return; }
        UI.ora('Apro l\'app ATS: se chiede l\'accesso, accedi…');
        try { tab = GM_openInTab(url, { active: true }); } catch (e) { }
        c = await attendi(nuova, 120000, 400);
      }
      if (tab && tab.close) { try { tab.close(); } catch (e) { } }
      if (!c) { UI.ora(''); UI.log('⚠ L\'app non ha risposto: invia la coda dal tab "Chiusure VLT" dell\'app.'); del(K.RICH); return; }
      UI.ora(''); UI.log('📥 ' + c.nome + ' del ' + c.giorno + ': ' + c.items.length + ' schede'); UI.agg();
    };

    // ── riquadro ──
    var UI = {
      el: null,
      css: '#atsVlt{position:fixed;right:14px;bottom:14px;z-index:2147483000;font:13px/1.4 Arial,sans-serif;color:#e2e8f0;zoom:1.35}' +
        '#atsVlt .box{width:340px;max-width:calc(100vw - 28px);background:#131929;border:1px solid #2f3d5c;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:10px 12px}' +
        '#atsVlt .tit{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.5px}#atsVlt .tit span{flex:1}' +
        '#atsVlt button{background:#3b82f6;color:#fff;border:0;border-radius:6px;padding:6px 9px;font:600 12px Arial,sans-serif;cursor:pointer;margin:2px 2px 2px 0}' +
        '#atsVlt button.g{background:none;border:1px solid #2f3d5c;color:#cbd5e1}#atsVlt button.r{background:#ef4444}#atsVlt button.v{background:#10b981}#atsVlt button:disabled{opacity:.4;cursor:default}' +
        '#atsVlt .mini{background:#3b82f6;border-radius:20px;padding:8px 14px;font-weight:700;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.4)}' +
        '#atsVlt .info{font-size:12px;color:#94a3b8;margin:6px 0}#atsVlt .info b{color:#e2e8f0}' +
        '#atsVlt .num span{display:inline-block;font-size:11px;border:1px solid #2f3d5c;border-radius:8px;padding:1px 7px;margin:0 4px 4px 0}' +
        '#atsVlt .ora{font-size:12px;color:#fbbf24;min-height:16px;margin:4px 0;word-break:break-word}' +
        '#atsVlt .log{font:11px/1.45 Consolas,monospace;color:#cbd5e1;max-height:130px;overflow:auto;background:#0b0f18;border-radius:6px;padding:5px 7px;white-space:pre-wrap}' +
        '#atsVlt select{background:#1a2236;color:#e2e8f0;border:1px solid #2f3d5c;border-radius:6px;padding:5px;font-size:12px}' +
        '#atsVlt .ser{margin-top:8px;border-top:1px solid #2f3d5c;padding-top:8px}#atsVlt .ser .r{display:flex;align-items:center;gap:6px;margin:3px 0}#atsVlt .ser .r code{flex:1;font:bold 14px Consolas,monospace;user-select:all;color:#f8fafc}#atsVlt .ser button.ok{background:#10b981;color:#fff;border-color:#10b981}' +
        '#atsVlt .warn{color:#fbbf24;font-size:12px}#atsVlt label{font-size:12px;color:#94a3b8}',
      monta: function () {
        if ($('#atsVlt')) return;
        var st = document.createElement('style'); st.textContent = UI.css; document.head.appendChild(st);
        var d = document.createElement('div'); d.id = 'atsVlt'; document.body.appendChild(d); UI.el = d; UI.agg();
      },
      conta: function (c) {
        var st = get(K.STATO + c.id, {}), n = { OK: 0, GIA_FATTO: 0, ERRORE: 0, SALTATO: 0, da: 0 };
        c.items.forEach(function (it) { var e = st[it.k] && st[it.k].esito; if (e) n[e] = (n[e] || 0) + 1; else n.da++; });
        return n;
      },
      _log: [], _ora: '', _ser: null, _cop: {}, _proc: '',
      log: function (t) { UI._log.push(adesso().slice(11, 16) + ' ' + t); UI._log = UI._log.slice(-60); var l = $('#atsVlt .log'); if (l) { l.textContent = UI._log.join('\n'); l.scrollTop = 99999; } console.log('[ATS→VLT] ' + t); },
      ora: function (t) { UI._ora = t; var o = $('#atsVlt .ora'); if (o) o.textContent = t; },
      seriali: function (it, avvisi, auto) { UI._ser = it ? { it: it, avvisi: avvisi || [], auto: auto } : null; UI.agg(); },
      agg: function () {
        if (!UI.el) return;
        var cfg = get(K.UI, {});
        if (cfg.chiuso) { UI.el.innerHTML = '<div class="mini" title="ATS → VLT">ATS' + (RUN.on ? ' ⏱' : '') + '</div>'; UI.el.firstChild.onclick = function () { cfg.chiuso = false; set(K.UI, cfg); UI.agg(); }; return; }
        var c = get(K.CODA, null), n = c ? UI.conta(c) : null, h = '<div class="box"><div class="tit"><span>ATS → VLT · v' + VER + '</span><button class="g" data-a="min">–</button></div>';
        if (c) h += '<div class="info"><b>' + esc(c.nome) + '</b> · ' + esc(c.giorno) + ' · ' + c.items.length + ' schede · da ' + esc(c.da || '') + ' alle ' + esc(String(c.creata || '').slice(11, 16)) + '</div>' +
          '<div class="num"><span>✓ ' + n.OK + '</span><span>= ' + n.GIA_FATTO + ' già</span><span style="' + (n.ERRORE ? 'border-color:#ef4444;color:#fca5a5' : '') + '">✗ ' + n.ERRORE + '</span><span>» ' + n.SALTATO + '</span><span>da fare ' + n.da + '</span></div>';
        else h += '<div class="info">Nessuna coda. Inviala dall\'app (tab Chiusure VLT) o prendila qui sotto.</div>';
        if (RUN.on) h += '<button data-a="pausa" class="' + (RUN.pausa ? 'v' : 'g') + '">' + (RUN.pausa ? '▶ Riprendi' : '⏸ Pausa') + '</button><button data-a="stop" class="r">■ Ferma</button>';
        else if (c) h += '<button data-a="avvia" class="v"' + (n.da + n.ERRORE ? '' : ' disabled') + '>▶ ' + (n.OK + n.GIA_FATTO + n.SALTATO + n.ERRORE ? 'Riprendi' : 'Avvia') + '</button><button data-a="prova" class="g" title="Fa una sola scheda e si ferma">Prova 1</button><button data-a="errori" class="g"' + (n.ERRORE ? '' : ' disabled') + '>↻ Riprova errori</button><button data-a="report" class="g">⬇ Report</button>';
        if (!RUN.on) h += '<div style="margin-top:6px"><select data-a="proc"><option value="">— scegli la procedura —</option><option value="INGRESSI">Ingressi del giorno</option><option value="ACK">ACK del giorno</option><option value="RMA">RMA del giorno</option><option value="FERME">Spare ferme in HUB</option><option value="MNF">RMA → Material Not Found (lista a video)</option></select> ' +
          (UI._proc === 'MNF' ? '<button data-a="mnf" class="r" title="Lista RMA a video: To Ship From CW → Material Not Found">🔧 Avvia MNF</button>' : '<button data-a="chiedi" class="g"' + (UI._proc ? '' : ' disabled title="Scegli prima la procedura"') + '>📥 Prendi dati da ATS</button>') + '</div>';
        if (UI._ser) {
          var s = UI._ser;
          h += '<div class="ser"><b>RMA ' + esc(s.it.rma) + '</b> · ' + esc(s.it.dest || '') + ' · AWB ' + esc(s.it.awb || '—') + (s.avvisi || []).map(function (a) { return '<div class="warn">⚠ ' + esc(a) + '</div>'; }).join('') +
            '<div class="info">Controlla i seriali e premi <b>Salva</b> su VLT: passo da solo al prossimo.</div>' +
            (s.it.serials || []).map(function (x) { var fatto = UI._cop[s.it.rma + '|' + x]; return '<div class="r"><code>' + esc(x) + '</code><button class="g' + (fatto ? ' ok' : '') + '" data-c="' + esc(x) + '">' + (fatto ? '✓ Copiato' : 'Copia') + '</button></div>'; }).join('') +
            '<button class="g" data-a="salta">» Salta questo RMA</button></div>';
        }
        h += '<div class="ora">' + esc(UI._ora) + '</div><div class="log">' + esc(UI._log.join('\n')) + '</div></div>';
        UI.el.innerHTML = h;
        var l = $('#atsVlt .log'); if (l) l.scrollTop = 99999;
        // la procedura si sceglie sempre: all'apertura il menu è vuoto (non ricorda l'ultima scelta)
        var ps = $('#atsVlt select[data-a="proc"]'); if (ps) { ps.value = UI._proc || ''; ps.onchange = function () { UI._proc = ps.value; UI.agg(); }; }
        $$('#atsVlt [data-a]').forEach(function (b) {
          var a = b.getAttribute('data-a'); if (a === 'proc') return;
          if (a === 'rmaAuto') { b.onchange = function () { cfg.rmaAuto = b.checked; set(K.UI, cfg); }; return; }
          b.onclick = function (ev) {
            ev.preventDefault(); ev.stopPropagation();
            if (a === 'min') { cfg.chiuso = true; set(K.UI, cfg); UI.agg(); }
            if (a === 'avvia') avvia('tutte');
            if (a === 'prova') avvia('prova');
            if (a === 'errori') avvia('errori');
            if (a === 'pausa') { RUN.pausa = !RUN.pausa; UI.agg(); }
            if (a === 'stop') { RUN.stop = true; RUN.pausa = false; UI.ora('Mi fermo dopo il passo in corso…'); }
            if (a === 'report') report();
            if (a === 'salta') RUN.attesa = 'salta';
            if (a === 'mnf') mnf();
            if (a === 'chiedi') { var pr = ($('#atsVlt select[data-a="proc"]') || {}).value || ''; if (!pr) { UI.log('Scegli prima la procedura dal menu.'); return; } chiediDati(pr); }
          };
        });
        $$('#atsVlt [data-c]').forEach(function (b) { b.onclick = function () { var v = b.getAttribute('data-c'); (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(function () { if (UI._ser) UI._cop[UI._ser.it.rma + '|' + v] = 1; b.textContent = '✓ Copiato'; b.classList.add('ok'); }, function () { b.textContent = '✗'; }); }; });
      }
    };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

    var parti = function () {
      UI.monta();
      set(K.VIVO, Date.now()); setInterval(function () { set(K.VIVO, Date.now()); }, 5000);
      try { GM_addValueChangeListener(K.CODA, function (k, o, n, remoto) { if (remoto) { if (n && (!o || o.id !== n.id)) UI.log('📥 Nuova coda: ' + n.nome + ' · ' + (n.items || []).length + ' schede'); UI.agg(); } }); } catch (e) { }
      var c = get(K.CODA, null);
      if (c) { var n = UI.conta(c); if (n.da && n.OK + n.GIA_FATTO + n.ERRORE + n.SALTATO) UI.log('Coda interrotta: ' + n.da + ' schede ancora da fare → ▶ Riprendi'); }
    };
    if (document.body) parti(); else window.addEventListener('DOMContentLoaded', parti);
  }
})();
