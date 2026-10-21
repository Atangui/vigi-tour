"use strict";
/* Globe à points en rotation, avec arcs animés Lyon → événements partenaires. Dessiné sur <canvas>. */
(function () {
  const D2R = Math.PI / 180, TILT = 0.42;
  const HUB = [45.76, 4.84];                                  // Lyon
  const SPOKES = [[38.7, -9.1], [52.5, 13.4], [45.5, -73.6], [1.35, 103.8]]; // Lisbonne, Berlin, Montréal, Singapour
  const PTS = [];
  for (let la = -81; la <= 81; la += 7) for (let lo = -180; lo < 180; lo += 7) PTS.push([la * D2R, lo * D2R]);

  function vec(la, lo, rot) {
    const l = lo + rot;
    const x = Math.cos(la) * Math.sin(l), y = -Math.sin(la), z = Math.cos(la) * Math.cos(l);
    return { x, y: y * Math.cos(TILT) + z * Math.sin(TILT), z: -y * Math.sin(TILT) + z * Math.cos(TILT) };
  }

  window.MPGlobe = function (canvas) {
    const ctx = canvas.getContext("2d");
    let rot = 0.6, dash = 0, colors = { dot: "#9fb3c8", arc: "#5eead4" }, lastColor = 0;

    function readColors() {
      const cs = getComputedStyle(canvas);
      colors = { dot: cs.getPropertyValue("--g-dot").trim() || colors.dot, arc: cs.getPropertyValue("--g-arc").trim() || colors.arc };
    }

    function frame(t) {
      const size = canvas.clientWidth, dpr = window.devicePixelRatio || 1;
      if (size && (canvas.width !== Math.round(size * dpr))) { canvas.width = canvas.height = Math.round(size * dpr); }
      if (t - lastColor > 1000) { readColors(); lastColor = t; }
      const W = canvas.width, C = W / 2, R = W * 0.43;
      ctx.clearRect(0, 0, W, W);
      // halo
      const g = ctx.createRadialGradient(C, C, R * 0.2, C, C, R * 1.15);
      g.addColorStop(0, "transparent"); g.addColorStop(0.85, "transparent"); g.addColorStop(1, colors.arc + "22");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(C, C, R * 1.15, 0, Math.PI * 2); ctx.fill();
      // points
      ctx.fillStyle = colors.dot;
      for (const p of PTS) {
        const v = vec(p[0], p[1], rot);
        if (v.z <= 0.02) continue;
        ctx.globalAlpha = 0.15 + 0.75 * v.z;
        ctx.beginPath(); ctx.arc(C + R * v.x, C + R * v.y, (0.6 + 1.0 * v.z) * dpr, 0, Math.PI * 2); ctx.fill();
      }
      // arcs + repères
      const hub = vec(HUB[0] * D2R, HUB[1] * D2R, rot);
      ctx.globalAlpha = 1; ctx.strokeStyle = colors.arc; ctx.fillStyle = colors.arc; ctx.lineWidth = 1.4 * dpr;
      ctx.setLineDash([5 * dpr, 6 * dpr]); ctx.lineDashOffset = -dash;
      for (const s of SPOKES) {
        const b = vec(s[0] * D2R, s[1] * D2R, rot);
        if (hub.z > 0 && b.z > 0) {
          const mx = hub.x + b.x, my = hub.y + b.y, mz = hub.z + b.z, k = 1.35 / (Math.hypot(mx, my, mz) || 1);
          ctx.beginPath(); ctx.moveTo(C + R * hub.x, C + R * hub.y);
          ctx.quadraticCurveTo(C + R * mx * k, C + R * my * k, C + R * b.x, C + R * b.y); ctx.stroke();
        }
        if (b.z > 0) { ctx.beginPath(); ctx.arc(C + R * b.x, C + R * b.y, 2.4 * dpr, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.setLineDash([]);
      if (hub.z > 0) {
        const pulse = (t / 1400) % 1;
        ctx.globalAlpha = 1 - pulse; ctx.beginPath(); ctx.arc(C + R * hub.x, C + R * hub.y, (3 + 9 * pulse) * dpr, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(C + R * hub.x, C + R * hub.y, 3.2 * dpr, 0, Math.PI * 2); ctx.fill();
      }
      rot += 0.0035; dash += 0.35 * dpr;
      requestAnimationFrame(frame);
    }
    readColors();
    requestAnimationFrame(frame);
  };
})();
