/* =====================================================================
   media.js — logos, images, comparateurs avant/après, carte ArcGIS
   ---------------------------------------------------------------------
   Aucun réglage à faire ici pour l'usage courant : tout se pilote depuis
   le HTML.

     LOGO            <span class="logo" data-name="…" data-sub="…">
                       <img src="assets/logo-xxx.png" alt="…"></span>
                     Si le fichier est absent, le nom s'affiche en toutes
                     lettres à la place : rien ne casse.

     FIGURE          <figure class="fig">
                       <div class="fbox"><img src="assets/xx.png" alt="…"></div>
                       <figcaption><b>Fig. 1</b> — légende</figcaption>
                     </figure>
                     Image absente → un emplacement rappelle le chemin attendu.

     COMPARATEUR     <div class="cmp" data-before="assets/a.png" data-after="assets/b.png">
                       <span class="tagl">avant</span><span class="tagr">après</span>
                     </div>

     CARTE           <div class="mapwrap" data-embed="URL" data-link="URL"
                          data-label="…"> … </div>
                     data-embed vide → rien n'est chargé, le repli reste
                     affiché. L'iframe n'est créée qu'à l'arrivée sur le
                     cadre, pour ne pas ralentir le démarrage.
   ===================================================================== */

(function () {
'use strict';

/* ---------------------------------------------------------------------
   1. Logos — repli typographique si le fichier manque
   --------------------------------------------------------------------- */
Array.prototype.forEach.call(document.querySelectorAll('.logo img'), function (img) {
  function repli() {
    var hote = img.parentNode;
    var w = document.createElement('span'); w.className = 'lw';
    var b = document.createElement('b');    b.textContent = hote.dataset.name || '';
    var s = document.createElement('span'); s.textContent = hote.dataset.sub  || '';
    w.appendChild(b); w.appendChild(s);
    img.replaceWith(w);
  }
  img.addEventListener('error', repli);
  if (img.complete && img.naturalWidth === 0) repli();
});

/* ---------------------------------------------------------------------
   2. Figures — emplacement lisible si l'image manque
   --------------------------------------------------------------------- */
Array.prototype.forEach.call(document.querySelectorAll('.fig img'), function (img) {
  function repli() {
    var ph = document.createElement('div'); ph.className = 'ph';
    var b  = document.createElement('b');   b.textContent = 'Emplacement image';
    var c  = document.createElement('code');c.textContent = img.getAttribute('src');
    ph.appendChild(b); ph.appendChild(c);
    img.replaceWith(ph);
  }
  img.addEventListener('error', repli);
  if (img.complete && img.naturalWidth === 0) repli();
});

/* ---------------------------------------------------------------------
   3. Comparateurs avant / après — curseur glissant
   --------------------------------------------------------------------- */
Array.prototype.forEach.call(document.querySelectorAll('.cmp'), function (c) {

  function couche(src, classe) {
    var d = document.createElement('div'); d.className = 'layer ' + classe;
    var im = new Image(); im.src = src; im.alt = '';
    im.onerror = function () {
      var p  = document.createElement('div');  p.className = 'cph';
      var b  = document.createElement('b');    b.textContent = (classe === 'after' ? 'image après' : 'image avant');
      var co = document.createElement('code'); co.textContent = src;
      p.appendChild(b); p.appendChild(co);
      d.innerHTML = ''; d.appendChild(p);
    };
    d.appendChild(im);
    return d;
  }

  c.prepend(couche(c.dataset.after,  'after'));
  c.prepend(couche(c.dataset.before, 'before'));

  var poignee = document.createElement('div');
  poignee.className = 'handle';
  poignee.setAttribute('role', 'separator');
  poignee.tabIndex = 0;
  c.appendChild(poignee);
  c.style.setProperty('--cut', '50%');

  var glisse = false;
  function place(x) {
    var r = c.getBoundingClientRect();
    c.style.setProperty('--cut', (Math.max(0, Math.min(1, (x - r.left) / r.width)) * 100).toFixed(1) + '%');
  }
  c.addEventListener('pointerdown',   function (e) { glisse = true; c.setPointerCapture(e.pointerId); place(e.clientX); });
  c.addEventListener('pointermove',   function (e) { if (glisse) place(e.clientX); });
  c.addEventListener('pointerup',     function () { glisse = false; });
  c.addEventListener('pointercancel', function () { glisse = false; });

  poignee.addEventListener('keydown', function (e) {
    var v = parseFloat(getComputedStyle(c).getPropertyValue('--cut')) || 50;
    if (e.key === 'ArrowLeft')  { e.stopPropagation(); c.style.setProperty('--cut', Math.max(0,   v - 4) + '%'); }
    if (e.key === 'ArrowRight') { e.stopPropagation(); c.style.setProperty('--cut', Math.min(100, v + 4) + '%'); }
  });
});

/* ---------------------------------------------------------------------
   4. Carte ArcGIS Online — chargée à l'arrivée sur le cadre
   --------------------------------------------------------------------- */
var ATTENTE = 4200;   // délai avant de conclure que le cadre est refusé (ms)

function chargeCarte(cadre) {
  var w = cadre.querySelector('.mapwrap');
  if (!w || w.dataset.loaded === '1') return;

  var url = (w.dataset.embed || '').trim();
  if (!url) return;                       // pas d'URL renseignée : on garde le repli
  w.dataset.loaded = '1';

  var fr = document.createElement('iframe');
  fr.src   = url;
  fr.title = w.dataset.label || 'Carte';
  fr.setAttribute('allowfullscreen', '');
  fr.setAttribute('loading', 'lazy');
  fr.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');

  var repli = w.querySelector('.mapfall'), charge = false;
  fr.addEventListener('load', function () { charge = true; if (repli) repli.style.display = 'none'; });
  w.prepend(fr);

  setTimeout(function () {
    if (charge || !repli) return;
    repli.style.display = 'flex';
    var p = repli.querySelector('p');
    if (p) p.textContent = "Le service n'autorise pas l'affichage en cadre depuis cette page. "
                         + "Ouvrez la scène dans un onglet, ou lancez la présentation depuis le fichier local.";
    var a = repli.querySelector('a');
    if (a) a.href = w.dataset.link || url;
  }, ATTENTE);
}

document.addEventListener('deck:enter', function (e) {
  if (e.detail.kind === 'map') chargeCarte(e.detail.slide);
});

})();
