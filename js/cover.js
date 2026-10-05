/* =====================================================================
   cover.js — animation de la page de titre (et de la page « Merci »)
   ---------------------------------------------------------------------
   Rejoue en boucle la chaîne de traitement, en cinq temps :

     1. Emprises au sol    : les contours des bâtiments se tracent au sol ;
     2. Nuage LiDAR        : les points se mettent en place, le bruit est
                             ensuite filtré ;
     3. Reconstruction     : les arêtes du modèle LoD2 se tracent ;
     4. Texture des toits  : les pans s'éclairent d'une surbrillance rouge,
                             modulée par leur orientation ;
     5. Texture des façades: légère surbrillance grise des murs ; le nuage
                             s'efface ;
     puis courte pose, fondu et reprise au début.

   La rotation est calée sur l'horloge absolue : le modèle ne « saute »
   pas au bouclage.

   S'abonne à deck:enter (démarrage / arrêt) et à deck:replay (touche R).
   ===================================================================== */

(function () {
'use strict';

/* ---------------------------------------------------------------------
   1. Réglages — c'est ici qu'on ajuste l'animation
   --------------------------------------------------------------------- */
var CW = 660, CH = 560;          // dimensions internes du canevas (px)
var CX = 330, CY = 330;          // centre de projection dans le canevas
var SC = 1.9;                    // échelle du modèle
var ROT = 0.0000162;             // vitesse de rotation (rad par ms)

// fin de chaque phase (ms depuis le début du cycle)
var T_EMPRISE = 1300;            // 1. emprises au sol
var T_NUAGE   = 2700;            // 2a. mise en place du nuage
var T_FILTRE  = 3400;            // 2b. filtrage du bruit
var T_RECON   = 5100;            // 3. tracé des arêtes
var T_TOITS   = 6600;            // 4. texture des toitures
var T_FACADES = 8100;            // 5. texture des façades
var POSE  = 3200;                // pose sur le modèle fini
var FONDU = 900;                 // fondu de sortie avant reprise
var CYCLE = T_FACADES + POSE + FONDU;

var DENSITE_TOIT   = 0.30;       // points par m² de toiture (indicatif)
var DENSITE_FACADE = 1.2;        // points par mètre de hauteur de façade
var N_SOL   = 1500;              // points de voirie
var N_BRUIT = 520;               // points aberrants, filtrés en phase 2

var COUL_BAS  = [176, 182, 186]; // nuage : gris clair en bas…
var COUL_MI   = [126, 163, 200];
var COUL_HAUT = [61, 90, 148];   // …bleu OTE aux faîtages
var COUL_ARETE = '58,56,92';
var COUL_PAN   = '61,90,148';
var COUL_EMPRISE = '61,90,148';

var A_TOIT   = 0.30;            // opacité max. de la surbrillance des toits
var COUL_FACADE = '120,128,140'; // teinte de la surbrillance des façades
var A_FACADE = 0.16;             // opacité max. de la surbrillance des façades

/* ---------------------------------------------------------------------
   2. État
   --------------------------------------------------------------------- */
var cv = document.getElementById('recon');
if (!cv) return;

var ctx = null, raf = null, T0 = 0, construit = false;
var PTS = [], ARETES = [], BATS = [];
var REDUIT = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------------------------------------------------------------------
   3. Projection axonométrique, teintes
   --------------------------------------------------------------------- */
function tourne(x, y, a) {
  var ca = Math.cos(a), sa = Math.sin(a);
  return [x * ca - y * sa, x * sa + y * ca];
}
function proj(x, y, z, a) {
  var r = tourne(x, y, a), X = r[0], Y = r[1];
  return [CX + (X - Y) * 0.866 * SC,
          CY + ((X + Y) * 0.5 * 0.58 - z * 0.88) * SC];
}
function profondeur(x, y, a) { var r = tourne(x, y, a); return r[0] + r[1]; }  // grand = proche

function teinte(u) {
  var a = COUL_BAS, b = COUL_MI, c = COUL_HAUT, k;
  if (u < 0.55) { k = u / 0.55;          return mix(a, b, k); }
  k = (u - 0.55) / 0.45;                 return mix(b, c, k);
}
function mix(a, b, k) {
  return [(a[0] + (b[0] - a[0]) * k) | 0,
          (a[1] + (b[1] - a[1]) * k) | 0,
          (a[2] + (b[2] - a[2]) * k) | 0];
}

/* ---------------------------------------------------------------------
   4. Construction du quartier : emprises, volumes, faces, nuage
   --------------------------------------------------------------------- */
function construire() {
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var blocs = [], gx = -96;

  while (gx < 94) {
    var w = rnd(23, 42), gy = -96;
    while (gy < 94) {
      var d = rnd(22, 40), h = rnd(14, 42), p = rnd(6, 16);
      blocs.push({ x: gx, y: gy, w: w, d: d, h: h, p: p, faitage: Math.random() > 0.35 });
      gy += d + rnd(9, 20);
    }
    gx += w + rnd(11, 22);
  }

  var zmax = 0;
  blocs.forEach(function (b) { if (b.h + b.p > zmax) zmax = b.h + b.p; });

  blocs.forEach(function (b, ib) {
    var x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.d;
    var ym = (y0 + y1) / 2, top = b.h + b.p;
    var bat = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, emprise: [], murs: [], pans: [] };
    function A(p, q) { ARETES.push({ a: p, c: q, bat: ib }); }

    var a0 = [x0, y0, 0],    b0 = [x1, y0, 0],    c0 = [x1, y1, 0],    d0 = [x0, y1, 0];
    var a1 = [x0, y0, b.h],  b1 = [x1, y0, b.h],  c1 = [x1, y1, b.h],  d1 = [x0, y1, b.h];
    bat.emprise = [a0, b0, c0, d0];
    A(a0, b0); A(b0, c0); A(c0, d0); A(d0, a0);
    A(a0, a1); A(b0, b1); A(c0, c1); A(d0, d1);
    A(a1, b1); A(b1, c1); A(c1, d1); A(d1, a1);

    // murs : polygone + normale extérieure (plan XY), pour savoir s'ils sont vus
    function mur(v, n) { bat.murs.push({ v: v, n: n }); }
    mur([a0, b0, b1, a1], [0, -1]);
    mur([b0, c0, c1, b1], [1, 0]);
    mur([c0, d0, d1, c1], [0, 1]);
    mur([d0, a0, a1, d1], [-1, 0]);

    if (b.faitage) {                       // toiture à deux pans + pignons
      var r1 = [x0, ym, top], r2 = [x1, ym, top];
      A(r1, r2); A(a1, r1); A(d1, r1); A(b1, r2); A(c1, r2);
      bat.pans.push({ v: [a1, b1, r2, r1] });
      bat.pans.push({ v: [d1, c1, r2, r1] });
      bat.murs.push({ v: [d1, a1, r1], n: [-1, 0] });
      bat.murs.push({ v: [b1, c1, r2], n: [1, 0] });
    } else {                               // toiture à croupe
      var f1 = [x0 + b.w * 0.22, y0 + b.d * 0.22, top], f2 = [x1 - b.w * 0.22, y0 + b.d * 0.22, top];
      var f3 = [x1 - b.w * 0.22, y1 - b.d * 0.22, top], f4 = [x0 + b.w * 0.22, y1 - b.d * 0.22, top];
      A(f1, f2); A(f2, f3); A(f3, f4); A(f4, f1);
      A(a1, f1); A(b1, f2); A(c1, f3); A(d1, f4);
      bat.pans.push({ v: [f1, f2, f3, f4], plat: true });
      bat.pans.push({ v: [a1, b1, f2, f1] });
      bat.pans.push({ v: [d1, c1, f3, f4] });
      bat.pans.push({ v: [a1, d1, f4, f1] });
      bat.pans.push({ v: [b1, c1, f3, f2] });
    }
    // normale 3D des pans, pour l'ombrage
    bat.pans.forEach(function (pn) {
      var v = pn.v, u1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]],
          u2 = [v[3][0] - v[0][0], v[3][1] - v[0][1], v[3][2] - v[0][2]];
      var n = [u1[1] * u2[2] - u1[2] * u2[1], u1[2] * u2[0] - u1[0] * u2[2], u1[0] * u2[1] - u1[1] * u2[0]];
      var l = Math.hypot(n[0], n[1], n[2]) || 1;
      n = [n[0] / l, n[1] / l, n[2] / l];
      if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
      pn.n = n;
    });
    BATS.push(bat);

    var n = Math.round(b.w * b.d * DENSITE_TOIT);
    for (var i = 0; i < n; i++) {
      var px = rnd(x0, x1), py = rnd(y0, y1), pz;
      if (b.faitage) {
        pz = b.h + b.p * (1 - Math.abs(py - ym) / (b.d / 2));
      } else {
        var dedansX = px > x0 + b.w * 0.22 && px < x1 - b.w * 0.22;
        var dedansY = py > y0 + b.d * 0.22 && py < y1 - b.d * 0.22;
        if (dedansX && dedansY) pz = top;
        else {
          var t = Math.min(Math.min(px - x0, x1 - px) / (b.w * 0.22),
                           Math.min(py - y0, y1 - py) / (b.d * 0.22));
          pz = b.h + b.p * Math.max(0, Math.min(1, t));
        }
      }
      PTS.push(point(px, py, pz, zmax, false));
    }
    for (var j = 0; j < Math.round(b.h * DENSITE_FACADE); j++) {
      var cote = Math.floor(Math.random() * 4);
      PTS.push(point(cote === 0 ? x0 : cote === 1 ? x1 : rnd(x0, x1),
                     cote === 2 ? y0 : cote === 3 ? y1 : rnd(y0, y1),
                     rnd(0, b.h), zmax, false));
    }
  });

  for (var g = 0; g < N_SOL; g++)
    PTS.push(point(rnd(-100, 100), rnd(-100, 100), rnd(-0.5, 0.5), zmax, false));
  for (var k = 0; k < N_BRUIT; k++)
    PTS.push(point(rnd(-100, 100), rnd(-100, 100), rnd(-12, 54), zmax, true));

  function point(x, y, z, zm, bruit) {
    return {
      x: x, y: y, z: z, bruit: bruit,
      c: teinte(Math.max(0, Math.min(1, z / zm))),
      sx: x + (Math.random() - 0.5) * 80,      // position de départ, dispersée
      sy: y + (Math.random() - 0.5) * 80,
      sz: z + (Math.random() - 0.5) * 44,
      jx: Math.random() - 0.5,                 // gigue résiduelle, résorbée au filtrage
      jy: Math.random() - 0.5,
      jz: Math.random() - 0.5
    };
  }

  // ordre d'apparition : les bâtiments se traitent de l'arrière vers l'avant
  BATS.forEach(function (b, i) { b.k = i / BATS.length; });
  ARETES.forEach(function (e, i) { e.k = i / ARETES.length; });
  construit = true;
}

/* ---------------------------------------------------------------------
   5. Boucle de rendu
   --------------------------------------------------------------------- */
function borne(v) { return Math.max(0, Math.min(1, v)); }
function adouci(v) { return 1 - Math.pow(1 - v, 3); }
function phase(t, debut, fin) { return borne((t - debut) / (fin - debut)); }
function vague(e, k) { return borne((e * 1.25 - k) / 0.25); }   // apparition échelonnée par bâtiment

function poly(pts, ang) {
  ctx.beginPath();
  for (var i = 0; i < pts.length; i++) {
    var q = proj(pts[i][0], pts[i][1], pts[i][2], ang);
    i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1]);
  }
  ctx.closePath();
}

function image(ts) {
  if (!T0) T0 = ts;
  var t = ts - T0;
  if (REDUIT) t = T_FACADES + 1;                // mouvement réduit : état final figé
  if (t > CYCLE) { T0 = ts; t = 0; }            // reprise du cycle

  var ang = REDUIT ? 0.62 : 0.62 + ts * ROT;
  var fondu = t > T_FACADES + POSE ? 1 - (t - T_FACADES - POSE) / FONDU : 1;

  var eE = phase(t, 0, T_EMPRISE);               // emprises
  var e1 = adouci(phase(t, T_EMPRISE, T_NUAGE)); // mise en place du nuage
  var e2 = phase(t, T_NUAGE, T_FILTRE);          // filtrage
  var e3 = phase(t, T_FILTRE, T_RECON);          // arêtes
  var eT = phase(t, T_RECON, T_TOITS);           // texture toits
  var eF = phase(t, T_TOITS, T_FACADES);         // texture façades

  ctx.clearRect(0, 0, CW, CH);

  /* --- 1. emprises au sol --- */
  var aEmp = (1 - 0.6 * eT) * fondu;
  ctx.lineWidth = 1.4;
  BATS.forEach(function (b) {
    var v = vague(eE, b.k);
    if (v <= 0) return;
    poly(b.emprise, ang);
    ctx.fillStyle = 'rgba(' + COUL_EMPRISE + ',' + (0.10 * v * aEmp).toFixed(3) + ')';
    ctx.fill();
    ctx.strokeStyle = 'rgba(' + COUL_EMPRISE + ',' + (0.85 * v * aEmp).toFixed(3) + ')';
    ctx.stroke();
  });

  /* --- 2. nuage de points (s'efface pendant le texturage) --- */
  if (t >= T_EMPRISE) {
    var gigue = 2.4 * (1 - adouci(e2)) + 0.22;
    var alpha = (0.8 - 0.3 * e3) * (1 - 0.55 * eT - 0.45 * eF) * fondu;
    for (var i = 0; i < PTS.length; i++) {
      var p = PTS[i];
      if (p.bruit) {
        var ab = (1 - adouci(e2)) * 0.55 * fondu * Math.min(1, e1 * 3);
        if (ab < 0.02) continue;
        var q = proj(p.sx + (p.x - p.sx) * e1, p.sy + (p.y - p.sy) * e1, p.sz + (p.z - p.sz) * e1, ang);
        ctx.fillStyle = 'rgba(150,158,163,' + ab.toFixed(3) + ')';
        ctx.fillRect(q[0], q[1], 1.1, 1.1);
        continue;
      }
      if (alpha < 0.02) break;
      var s = proj(p.sx + (p.x - p.sx) * e1 + p.jx * gigue,
                   p.sy + (p.y - p.sy) * e1 + p.jy * gigue,
                   p.sz + (p.z - p.sz) * e1 + p.jz * gigue, ang);
      ctx.fillStyle = 'rgba(' + p.c[0] + ',' + p.c[1] + ',' + p.c[2] + ',' + (alpha * Math.min(1, e1 * 3)).toFixed(3) + ')';
      ctx.fillRect(s[0], s[1], 1.3, 1.3);
    }
  }

  /* --- 3 à 5. volumes : pans en reconstruction, puis textures ---
     bâtiments dessinés du plus lointain au plus proche (peintre) */
  if (e3 > 0) {
    var ca = Math.cos(ang), sa = Math.sin(ang);
    var ordre = BATS.slice().sort(function (a, b) { return profondeur(a.cx, a.cy, ang) - profondeur(b.cx, b.cy, ang); });
    var L = [0.45, -0.55, 0.70];                 // direction de la lumière

    ordre.forEach(function (b) {
      var vT = vague(eT, b.k), vF = vague(eF, b.k), vR = vague(e3, b.k);

      // façades : légère surbrillance, modulée par l'orientation du mur
      if (vF > 0) {
        b.murs.forEach(function (m) {
          var nx = m.n[0] * ca - m.n[1] * sa, ny = m.n[0] * sa + m.n[1] * ca;
          if (nx + ny <= 0) return;                               // face cachée
          var ombre = 0.6 + 0.4 * (nx - ny + 1.414) / 2.828;      // 0,6 → 1
          poly(m.v, ang);
          ctx.fillStyle = 'rgba(' + COUL_FACADE + ',' + (A_FACADE * ombre * vF * fondu).toFixed(3) + ')';
          ctx.fill();
        });
      }

      // pans de toiture : teinte légère en reconstruction, puis surbrillance plus nette
      b.pans.forEach(function (pn) {
        var aPan = 0.08 * vR;
        if (vT > 0) {
          var n = pn.n, nx = n[0] * ca - n[1] * sa, ny = n[0] * sa + n[1] * ca;
          var ombre = 0.55 + 0.45 * Math.max(0, nx * L[0] + ny * L[1] + n[2] * L[2]);
          aPan += (A_TOIT * ombre - 0.08) * vT;
        }
        if (aPan <= 0) return;
        poly(pn.v, ang);
        ctx.fillStyle = 'rgba(' + COUL_PAN + ',' + (aPan * fondu).toFixed(3) + ')';
        ctx.fill();
      });
    });

    /* arêtes par-dessus, plus discrètes une fois le modèle texturé */
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(' + COUL_ARETE + ',' + ((0.45 + 0.35 * e3) * (1 - 0.2 * eF) * fondu).toFixed(3) + ')';
    ctx.beginPath();
    for (var k = 0; k < ARETES.length; k++) {
      var ar = ARETES[k];
      if (ar.k > e3) continue;
      var qa2 = proj(ar.a[0], ar.a[1], ar.a[2], ang), qb2 = proj(ar.c[0], ar.c[1], ar.c[2], ang);
      ctx.moveTo(qa2[0], qa2[1]); ctx.lineTo(qb2[0], qb2[1]);
    }
    ctx.stroke();
  }

  raf = REDUIT ? null : requestAnimationFrame(image);
}

/* ---------------------------------------------------------------------
   6. Démarrage, arrêt, reprise
   --------------------------------------------------------------------- */
function demarre() {
  if (raf) return;
  if (!construit) { cv.width = CW; cv.height = CH; ctx = cv.getContext('2d'); construire(); }
  T0 = 0;
  raf = requestAnimationFrame(image);
}
function arrete() { if (raf) { cancelAnimationFrame(raf); raf = null; } }

document.addEventListener('deck:enter', function (e) {
  if (e.detail.kind === 'cover') demarre(); else arrete();
});
document.addEventListener('deck:replay', function () {
  if (ctx) { arrete(); demarre(); }
});

})();