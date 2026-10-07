/*!
 * signature-metrics.js
 * Calcula la "firma" de un jugador: las métricas propias que más lo separan del promedio.
 *
 * Uso:
 *   const sig = SignatureMetrics.compute(player);          // promedios de referencia por defecto
 *   const base = SignatureMetrics.baselineFrom(allPlayers); // o promedios reales de tu web
 *   const sig2 = SignatureMetrics.compute(player, base);
 *   sig.featured -> las 4 métricas de la firma (una por familia, salvo señales de 2 desviaciones o más)
 *   sig.others   -> las 3 siguientes
 *   sig.all      -> todas, ordenadas por distancia al promedio
 *
 * Forma del jugador (player):
 * {
 *   wins, losses,
 *   form:   { start, min, max, now }                       // winrate móvil, en %
 *   champs: [{ name, games, wins, losses, kda }],
 *   recent: [{ win, dur (segundos), k, d, a, cs, kp (%) }]  // últimas partidas
 * }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SignatureMetrics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Valores iniciales de referencia. Reemplázalos con baselineFrom(jugadores) cuando tengas datos.
  var DEFAULT_BASELINE = {
    minPerDeath: { mean: 5.0, sd: 1.2 },
    winGap:      { mean: 0,   sd: 5 },
    mainShare:   { mean: 0.55, sd: 0.2 },
    formPos:     { mean: 0.5, sd: 0.25 },
    balance:     { mean: 0.04, sd: 0.08 },
    swing:       { mean: 35,  sd: 12 },
    csGap:       { mean: 0.6, sd: 0.8 },
    kp:          { mean: 0.55, sd: 0.1 },
    finish:      { mean: 0.45, sd: 0.1 },
    riskGap:     { mean: -1.5, sd: 1.8 }
  };

  var GROUPS = {
    tempo: 'Ritmo', pool: 'Campeones', forma: 'Forma',
    farmeo: 'Farmeo', pelea: 'Peleas', riesgo: 'Riesgo'
  };

  function sum(a) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s; }
  function avg(a) { return a.length ? sum(a) / a.length : 0; }
  function r1(x) { return Math.round(x * 10) / 10; }
  function fix1(x) { return r1(x).toFixed(1); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function sgn(x) { return x >= 0 ? '+' : '−'; }
  function pct(x) { return Math.round(x * 100); }

  function split(recent) {
    var w = [], l = [];
    (recent || []).forEach(function (g) { (g.win ? w : l).push(g); });
    return { w: w, l: l };
  }
  function perMin(g) { return g.cs / (g.dur / 60); }

  var METRICS = [
    {
      id: 'minPerDeath', group: 'tempo', label: 'Reloj de muertes',
      formula: 'Minutos jugados ÷ muertes, en las últimas partidas.',
      compute: function (p) {
        var r = p.recent || [];
        if (r.length < 3) return null;
        var deaths = sum(r.map(function (g) { return g.d; }));
        if (!deaths) return null;
        var min = sum(r.map(function (g) { return g.dur; })) / 60;
        var raw = min / deaths, s = Math.round(raw * 60);
        return {
          raw: raw, num: Math.floor(s / 60) + ':' + pad(s % 60), unit: '',
          title: 'Una muerte cada ' + Math.floor(s / 60) + ' min ' + (s % 60) + ' s',
          text: deaths + ' muertes en ' + Math.round(min) + ' minutos jugados, últimas ' + r.length + ' partidas.'
        };
      }
    },
    {
      id: 'winGap', group: 'tempo', label: 'Brecha de victoria',
      formula: 'Duración media de las victorias − duración media de las derrotas.',
      compute: function (p) {
        var s = split(p.recent), n = s.w.length + s.l.length;
        if (!s.w.length || !s.l.length || n < 4) return null;
        var aw = Math.round(avg(s.w.map(function (g) { return g.dur; })) / 60);
        var al = Math.round(avg(s.l.map(function (g) { return g.dur; })) / 60);
        var raw = avg(s.w.map(function (g) { return g.dur; })) / 60 - avg(s.l.map(function (g) { return g.dur; })) / 60;
        var d = aw - al;
        return {
          raw: raw, num: sgn(d) + Math.abs(d), unit: 'min',
          title: Math.abs(raw) < 2 ? 'Gana a cualquier ritmo' : (raw > 0 ? 'Gana cuando el juego se alarga' : 'Gana cuando cierra rápido'),
          text: 'Sus victorias duran ' + aw + ' min en promedio y sus derrotas ' + al + ' min, en las últimas ' + n + '.'
        };
      }
    },
    {
      id: 'mainShare', group: 'pool', label: 'Índice de campeón',
      formula: 'Partidas del campeón más jugado ÷ partidas importadas. Si es menos de 50% se muestra como versatilidad.',
      compute: function (p) {
        var c = (p.champs || []).slice().sort(function (a, b) { return b.games - a.games; });
        var total = sum(c.map(function (x) { return x.games; }));
        if (!c.length || total < 10) return null;
        var top = c[0], raw = top.games / total;
        if (raw >= 0.5) {
          var second = c[1] ? c[1].games : 0;
          return {
            raw: raw, label: 'Índice ' + top.name, num: fix1(raw * 100), unit: '%',
            title: raw >= 0.75 ? 'Casi todo su juego es un campeón' : 'Tiene un campeón de cabecera',
            text: top.games + ' de sus ' + total + ' partidas importadas son con ' + top.name + '. ' +
              (second ? 'El segundo campeón suma ' + second + '.' : 'No juega otro campeón.')
          };
        }
        var n = c.filter(function (x) { return x.games >= 3; }).length;
        return {
          raw: raw, label: 'Índice de versatilidad', num: String(n), unit: 'campeones',
          title: 'Se adapta a lo que toque',
          text: n + ' campeones con 3 o más partidas. El más jugado, ' + top.name + ', concentra ' + pct(raw) + '% de sus partidas.'
        };
      }
    },
    {
      id: 'formPos', group: 'forma', label: 'Rango de forma',
      formula: '(WR móvil actual − piso) ÷ (techo − piso).',
      compute: function (p) {
        var f = p.form;
        if (!f || !(f.max > f.min)) return null;
        var raw = (f.now - f.min) / (f.max - f.min);
        return {
          raw: raw, num: String(pct(raw)), unit: '%',
          title: raw >= 0.75 ? 'Está cerca de su techo' : (raw <= 0.25 ? 'Está cerca de su piso' : 'Está a mitad de su rango'),
          text: 'Su winrate móvil de ' + fix1(f.now) + '% queda al ' + pct(raw) + '% del camino entre su piso (' + fix1(f.min) + '%) y su techo (' + fix1(f.max) + '%).'
        };
      }
    },
    {
      id: 'balance', group: 'forma', label: 'Saldo de cuenta',
      formula: '(Victorias − derrotas) ÷ partidas.',
      compute: function (p) {
        var W = p.wins, L = p.losses, n = W + L;
        if (!n) return null;
        var raw = (W - L) / n, d = W - L;
        return {
          raw: raw, num: sgn(d) + Math.abs(d), unit: '',
          title: Math.abs(raw) < 0.04 ? 'Balance casi parejo' : (raw > 0 ? 'Más victorias que derrotas' : 'Más derrotas que victorias'),
          text: W + ' victorias contra ' + L + ' derrotas en ' + n + ' partidas.'
        };
      }
    },
    {
      id: 'swing', group: 'forma', label: 'Montaña rusa',
      formula: 'Techo − piso del winrate móvil.',
      compute: function (p) {
        var f = p.form;
        if (!f || !(f.max > f.min)) return null;
        var raw = f.max - f.min;
        return {
          raw: raw, num: fix1(raw), unit: 'pts',
          title: raw >= 45 ? 'Su winrate sube y baja fuerte' : (raw <= 20 ? 'Su winrate casi no se mueve' : 'Oscila de forma moderada'),
          text: 'Su winrate móvil osciló ' + fix1(raw) + ' puntos, entre ' + fix1(f.min) + '% y ' + fix1(f.max) + '%.'
        };
      }
    },
    {
      id: 'csGap', group: 'farmeo', label: 'Farmeo según resultado',
      formula: 'CS/min medio en victorias − CS/min medio en derrotas.',
      compute: function (p) {
        var s = split(p.recent), n = s.w.length + s.l.length;
        if (!s.w.length || !s.l.length || n < 4) return null;
        var aw = avg(s.w.map(perMin)), al = avg(s.l.map(perMin));
        var d = r1(aw) - r1(al);
        return {
          raw: aw - al, num: sgn(d) + Math.abs(d).toFixed(1), unit: 'CS/min',
          title: d > 0.4 ? 'Su farmeo marca el resultado' : (d < -0.4 ? 'Farmea más cuando pierde' : 'Farmea igual gane o pierda'),
          text: fix1(aw) + ' CS/min en victorias contra ' + fix1(al) + ' en derrotas, últimas ' + n + '.'
        };
      }
    },
    {
      id: 'kp', group: 'pelea', label: 'Presencia en peleas',
      formula: 'Promedio de participación en kills del equipo.',
      compute: function (p) {
        var r = (p.recent || []).filter(function (g) { return typeof g.kp === 'number'; });
        if (r.length < 3) return null;
        var raw = avg(r.map(function (g) { return g.kp; })) / 100;
        return {
          raw: raw, num: String(pct(raw)), unit: '%',
          title: raw >= 0.65 ? 'Está en casi toda pelea' : (raw <= 0.45 ? 'Juega apartado del equipo' : 'Participa de forma pareja'),
          text: 'Estuvo presente en el ' + pct(raw) + '% de las kills de su equipo, promedio de las últimas ' + r.length + '.'
        };
      }
    },
    {
      id: 'finish', group: 'pelea', label: 'Índice de remate',
      formula: 'Kills ÷ (kills + asistencias).',
      compute: function (p) {
        var r = p.recent || [];
        if (r.length < 3) return null;
        var K = sum(r.map(function (g) { return g.k; })), A = sum(r.map(function (g) { return g.a; }));
        if (!(K + A)) return null;
        var raw = K / (K + A);
        return {
          raw: raw, num: String(pct(raw)), unit: '%',
          title: raw >= 0.55 ? 'Remata las peleas' : (raw <= 0.4 ? 'Prepara las peleas para otros' : 'Reparte entre kills y asistencias'),
          text: K + ' kills y ' + A + ' asistencias en las últimas ' + r.length + '. El ' + pct(raw) + '% de su participación son kills.'
        };
      }
    },
    {
      id: 'riskGap', group: 'riesgo', label: 'Ritmo de riesgo',
      formula: 'Muertes medias en victorias − muertes medias en derrotas.',
      compute: function (p) {
        var s = split(p.recent), n = s.w.length + s.l.length;
        if (!s.w.length || !s.l.length || n < 4) return null;
        var dW = avg(s.w.map(function (g) { return g.d; })), dL = avg(s.l.map(function (g) { return g.d; }));
        var raw = dW - dL, d = r1(dW) - r1(dL);
        return {
          raw: raw, num: sgn(d) + Math.abs(d).toFixed(1), unit: 'muertes',
          title: raw > 0.5 ? 'Muere más cuando gana' : (raw < -3 ? 'Sus derrotas llegan por morir de más' : (raw < -0.5 ? 'Muere más cuando pierde' : 'Muere igual gane o pierda')),
          text: fix1(dW) + ' muertes por victoria y ' + fix1(dL) + ' por derrota, últimas ' + n + '.'
        };
      }
    }
  ];

  function compute(player, baseline) {
    var base = {};
    Object.keys(DEFAULT_BASELINE).forEach(function (k) {
      base[k] = (baseline && baseline[k]) || DEFAULT_BASELINE[k];
    });
    var all = [];
    METRICS.forEach(function (m) {
      var r = null;
      try { r = m.compute(player); } catch (e) { r = null; }
      if (!r || !isFinite(r.raw)) return;
      var b = base[m.id], z = (r.raw - b.mean) / b.sd;
      all.push({
        id: m.id, group: m.group, label: r.label || m.label,
        raw: r.raw, num: r.num, unit: r.unit, title: r.title, text: r.text,
        z: z, score: Math.abs(z)
      });
    });
    all.sort(function (a, b) { return b.score - a.score; });
    // Una métrica por familia, salvo que la señal sea muy fuerte (2 desviaciones o más).
    var featured = [], seen = {};
    all.forEach(function (m) {
      if (featured.length < 4 && (!seen[m.group] || m.score >= 2)) { featured.push(m); seen[m.group] = true; }
    });
    all.forEach(function (m) {
      if (featured.length < 4 && featured.indexOf(m) < 0) featured.push(m);
    });
    var others = all.filter(function (m) { return featured.indexOf(m) < 0; }).slice(0, 3);
    return { featured: featured, others: others, all: all };
  }

  // Promedio y desviación reales de tus jugadores, para reemplazar los valores de referencia.
  function baselineFrom(players) {
    var out = {};
    METRICS.forEach(function (m) {
      var raws = [];
      players.forEach(function (p) {
        var r = null;
        try { r = m.compute(p); } catch (e) { r = null; }
        if (r && isFinite(r.raw)) raws.push(r.raw);
      });
      if (raws.length < 5) return; // muestra muy chica, se queda el valor por defecto
      var mean = avg(raws);
      var sd = Math.sqrt(avg(raws.map(function (x) { return (x - mean) * (x - mean); })));
      if (sd > 1e-6) out[m.id] = { mean: mean, sd: sd };
    });
    return out;
  }

  return {
    compute: compute,
    baselineFrom: baselineFrom,
    metrics: METRICS.map(function (m) { return { id: m.id, group: m.group, label: m.label, formula: m.formula }; }),
    groups: GROUPS,
    defaultBaseline: DEFAULT_BASELINE
  };
});
