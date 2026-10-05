/* =====================================================================
   deck.js — moteur de présentation
   ---------------------------------------------------------------------
   Rôle : mise à l'échelle de la scène, navigation entre cadres,
          révélation progressive (.frag), barre latérale, pied de page,
          plan (S), chronomètre (T), plein écran (F).

   Ce fichier ne connaît RIEN du contenu des cadres. Il se contente
   d'émettre des événements auxquels media.js et cover.js s'abonnent :

     deck:enter   detail = { slide, index, kind, section }
     deck:leave   detail = { slide, index, kind }
     deck:replay  (touche R — rejouer une animation)

   API publique : window.Deck = { go, next, prev, jumpSection, index, slides }

   IMPORTANT : ce script doit être chargé EN DERNIER, après les modules
   qui écoutent ces événements.
   ===================================================================== */

window.Deck = (function () {
'use strict';

/* ---------------------------------------------------------------------
   1. Réglages
   --------------------------------------------------------------------- */
var BASE_W = 1600, BASE_H = 900;      // repère de la scène, en pixels
var LOCK   = 420;                      // verrou anti-rafale entre deux cadres (ms)
var WHEEL  = { seuil: 30, pause: 590 };// sensibilité de la molette

/* Libellés affichés dans le pied de page et dans le plan, indexés par
   data-sec. Modifier ici si vous renommez une partie. */
var SECTIONS = [
  'Introduction et chaîne de traitement',
  '1 — Segmentation du bâti',
  '2 — Reconstruction 3D',
  '3 — Texturage hybride',
  '4 — Rendu temps réel',
  '5 — Bilan et perspectives'
];

/* Origine de la transformation « zoom » des pages de partie : elle vise
   la carte correspondante sur le cadre « Chaîne de traitement ». */
var ORIGINS = ['50% 50%', '12% 50%', '37% 50%', '62% 50%', '87% 50%', '50% 50%'];

/* Éléments sur lesquels un clic ne doit PAS faire avancer la présentation. */
var INTERACTIF = 'a, button, iframe, input, .cmp, .mapwrap, .sit, .mitem, #menu, #help';

/* ---------------------------------------------------------------------
   2. Mise à l'échelle de la scène
   --------------------------------------------------------------------- */
var stage = document.getElementById('stage');

function fit() {
  var k = Math.min(window.innerWidth / BASE_W, window.innerHeight / BASE_H);
  stage.style.transform = 'scale(' + k + ')';
}
window.addEventListener('resize', fit);
fit();

/* ---------------------------------------------------------------------
   3. Indexation des cadres
   --------------------------------------------------------------------- */
var slides   = Array.prototype.slice.call(document.querySelectorAll('.slide'));
/* frags[i] = liste de GROUPES de fragments du cadre i. Les éléments qui
   partagent la même valeur data-step forment un seul groupe : ils
   apparaissent ensemble, au même clic, où qu'ils soient dans le DOM. */
var frags    = slides.map(function (s) {
  var groupes = [], parStep = {};
  Array.prototype.forEach.call(s.querySelectorAll('.frag'), function (el) {
    var st = el.dataset.step;
    if (st && parStep[st]) { parStep[st].push(el); return; }
    var g = [el];
    groupes.push(g);
    if (st) parStep[st] = g;
  });
  return groupes;
});
var fragIdx  = slides.map(function () { return 0; });
var cur = 0, busy = false;

/* Premier cadre de chaque partie, pour les sauts directs. */
var debutPartie = {};
slides.forEach(function (s, i) {
  if (debutPartie[s.dataset.sec] === undefined) debutPartie[s.dataset.sec] = i;
});

/* Cadre à partir duquel la barre latérale apparaît (attribut data-hub). */
var sideFrom = slides.findIndex(function (s) { return s.dataset.hub === '1'; });
if (sideFrom < 0) sideFrom = 0;

document.getElementById('ftot').textContent = slides.length;

/* ---------------------------------------------------------------------
   4. Affichage
   --------------------------------------------------------------------- */
function emit(nom, detail) {
  document.dispatchEvent(new CustomEvent(nom, { detail: detail }));
}

function appliqueFrags(i, tout) {
  var groupes = frags[i], n = tout ? groupes.length : fragIdx[i];
  groupes.forEach(function (g, k) {
    g.forEach(function (el) { el.classList.toggle('on', k < n); });
  });
}

function render(prec, sens) {
  var s = slides[cur];
  var sec = parseInt(s.dataset.sec, 10) || 0;

  if (s.dataset.kind === 'chapter') s.style.transformOrigin = ORIGINS[sec] || '50% 50%';

  slides.forEach(function (el, i) {
    el.classList.toggle('back', sens < 0);
    if (i === cur) {
      el.classList.remove('leaving');
      el.classList.add('active');
    } else if (i === prec) {
      el.classList.remove('active');
      el.classList.add('leaving');
      setTimeout(function () { el.classList.remove('leaving'); }, 620);
    } else {
      el.classList.remove('active', 'leaving');
    }
  });

  appliqueFrags(cur, false);

  stage.classList.toggle('side-on',  cur >= sideFrom);
  stage.classList.toggle('cover-on', s.dataset.kind === 'cover');

  document.getElementById('fcur').textContent  = cur + 1;
  document.getElementById('footsec').textContent = SECTIONS[sec] || '';

  Array.prototype.forEach.call(document.querySelectorAll('.sit'), function (n) {
    var k = parseInt(n.dataset.jump, 10);
    n.dataset.state = (k === sec) ? 'on' : (k < sec ? 'done' : '');
  });
  Array.prototype.forEach.call(document.querySelectorAll('.mitem'), function (m) {
    m.classList.toggle('cur', parseInt(m.dataset.i, 10) === cur);
  });

  if (prec >= 0 && prec !== cur) {
    emit('deck:leave', { slide: slides[prec], index: prec, kind: slides[prec].dataset.kind || '' });
  }
  emit('deck:enter', { slide: s, index: cur, kind: s.dataset.kind || '', section: sec });
}

/* ---------------------------------------------------------------------
   5. Navigation
   --------------------------------------------------------------------- */
function go(i, sens) {
  i = Math.max(0, Math.min(slides.length - 1, i));
  if (i === cur || busy) return;
  busy = true;
  var prec = cur;
  cur = i;
  if (sens < 0) appliqueFrags(cur, true);   // en marche arrière, tout est déjà révélé
  render(prec, sens);
  setTimeout(function () { busy = false; }, LOCK);
}

function next() {
  if (busy) return;
  if (fragIdx[cur] < frags[cur].length) { fragIdx[cur]++; appliqueFrags(cur, false); return; }
  if (cur < slides.length - 1) go(cur + 1, 1);
}

function prev() {
  if (busy) return;
  if (fragIdx[cur] > 0) { fragIdx[cur]--; appliqueFrags(cur, false); return; }
  if (cur > 0) { fragIdx[cur - 1] = frags[cur - 1].length; go(cur - 1, -1); }
}

function jumpSection(k) {
  var i = debutPartie[String(k)];
  if (i === undefined) return;
  fragIdx[i] = 0;
  go(i, i > cur ? 1 : -1);
}

/* ---------------------------------------------------------------------
   6. Entrées : clic, molette, clavier, tactile
   --------------------------------------------------------------------- */
document.addEventListener('click', function (e) {
  if (menuOuvert) {
    var mi = e.target.closest('.mitem');
    if (mi) { fermeMenu(); fragIdx[+mi.dataset.i] = 0; go(+mi.dataset.i, +mi.dataset.i > cur ? 1 : -1); }
    else if (!e.target.closest('.mgrid')) fermeMenu();
    return;
  }
  var j = e.target.closest('[data-jump]');
  if (j) { jumpSection(j.dataset.jump); return; }
  if (e.target.closest(INTERACTIF)) return;
  next();
});

document.addEventListener('contextmenu', function (e) {
  if (e.target.closest(INTERACTIF)) return;
  e.preventDefault();
  prev();
});

var verrou = 0, cumul = 0;
document.addEventListener('wheel', function (e) {
  if (menuOuvert || e.target.closest('.mapwrap, iframe')) return;
  var t = Date.now();
  if (t < verrou) return;
  cumul += e.deltaY;
  if (Math.abs(cumul) < WHEEL.seuil) return;
  verrou = t + WHEEL.pause;
  (cumul > 0 ? next : prev)();
  cumul = 0;
}, { passive: true });

document.addEventListener('keydown', function (e) {
  var k = e.key;
  if (k === 'Escape') { if (menuOuvert) fermeMenu(); else if (aideOuverte) basculeAide(); return; }
  if (menuOuvert && k !== 's' && k !== 'S') return;

  if (k === 'ArrowRight' || k === ' ' || k === 'PageDown' || k === 'Enter' || k === 'ArrowDown') { e.preventDefault(); next(); }
  else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'ArrowUp') { e.preventDefault(); prev(); }
  else if (k === 'Home') { e.preventDefault(); fragIdx[0] = 0; go(0, -1); }
  else if (k === 'End')  { e.preventDefault(); go(slides.length - 1, 1); }
  else if (k === 's' || k === 'S') { e.preventDefault(); menuOuvert ? fermeMenu() : ouvreMenu(); }
  else if (k === 'f' || k === 'F') { pleinEcran(); }
  else if (k === 't' || k === 'T') { basculeChrono(); }
  else if (k === 'n' || k === 'N') { fragIdx[cur] = frags[cur].length; appliqueFrags(cur, true); }
  else if (k === 'r' || k === 'R') { emit('deck:replay', { index: cur }); }
  else if (k === '?' || k === 'h' || k === 'H') { basculeAide(); }
  else if (/^[0-5]$/.test(k)) { jumpSection(k); }
});

var tx = 0, ty = 0;
document.addEventListener('touchstart', function (e) {
  tx = e.touches[0].clientX; ty = e.touches[0].clientY;
}, { passive: true });
document.addEventListener('touchend', function (e) {
  if (e.target.closest(INTERACTIF)) return;
  var dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty;
  if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy)) (dx < 0 ? next : prev)();
  else if (Math.abs(dy) > 55) (dy < 0 ? next : prev)();
}, { passive: true });

/* ---------------------------------------------------------------------
   7. Plein écran, aide, chronomètre
   --------------------------------------------------------------------- */
function pleinEcran() {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen().then(fit).catch(function () {});
  else document.exitFullscreen();
}
document.addEventListener('fullscreenchange', function () { setTimeout(fit, 60); });

var aideOuverte = false;
function basculeAide() {
  aideOuverte = !aideOuverte;
  document.getElementById('help').classList.toggle('open', aideOuverte);
}

var t0 = null, chrono = null;
function basculeChrono() {
  var el = document.getElementById('timer');
  if (!el) {
    el = document.createElement('span');
    el.id = 'timer';
    el.style.cssText = 'margin-right:14px;font-weight:400;opacity:.9';
    document.querySelector('#foot .f3').prepend(el);
  }
  if (chrono) { clearInterval(chrono); chrono = null; el.textContent = ''; return; }
  t0 = Date.now();
  chrono = setInterval(function () {
    var s = Math.floor((Date.now() - t0) / 1000);
    el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 500);
}

/* ---------------------------------------------------------------------
   8. Plan (touche S) — construit depuis les data-title
   --------------------------------------------------------------------- */
var menuOuvert = false;
(function construitPlan() {
  var grille = document.getElementById('mgrid'), groupes = {};
  slides.forEach(function (s, i) {
    (groupes[s.dataset.sec] = groupes[s.dataset.sec] || [])
      .push({ i: i, t: s.dataset.title || ('Cadre ' + (i + 1)) });
  });
  Object.keys(groupes).forEach(function (k) {
    var g = document.createElement('div'); g.className = 'mgroup';
    var h = document.createElement('h3'); h.textContent = SECTIONS[+k] || ''; g.appendChild(h);
    groupes[k].forEach(function (o) {
      var d = document.createElement('div');
      d.className = 'mitem'; d.dataset.i = o.i;
      var em = document.createElement('em'); em.textContent = String(o.i + 1).padStart(2, '0');
      var sp = document.createElement('span'); sp.textContent = o.t;
      d.appendChild(em); d.appendChild(sp); g.appendChild(d);
    });
    grille.appendChild(g);
  });
})();
function ouvreMenu() { menuOuvert = true;  document.getElementById('menu').classList.add('open'); }
function fermeMenu() { menuOuvert = false; document.getElementById('menu').classList.remove('open'); }

/* ---------------------------------------------------------------------
   9. Démarrage
   --------------------------------------------------------------------- */
var DEV_KEY = 'deck_slide';   // clé sessionStorage — retirer en prod

// restaure l'index sauvegardé (même onglet, même session)
var saved = parseInt(sessionStorage.getItem(DEV_KEY), 10);
if (!isNaN(saved) && saved > 0 && saved < slides.length) {
  cur = saved;
  fragIdx[cur] = frags[cur].length;   // tout révélé sur le cadre restauré
}

render(-1, 1);

// sauvegarde l'index courant à chaque navigation
document.addEventListener('deck:enter', function (e) {
  sessionStorage.setItem(DEV_KEY, e.detail.index);
});

setTimeout(function () {
  var h = document.getElementById('hint');
  if (h) h.classList.add('hide');
}, 5000);

})();