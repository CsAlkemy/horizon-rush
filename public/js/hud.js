// DOM HUD: speedo gauge, minimap, skill feed, nameplates, banners, results.
const $ = (id) => document.getElementById(id);

export class HUD {
  constructor(track) {
    this.track = track;
    this.gaugeInit();
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    this.plates = new Map(); // id -> element
    this.lastBanner = 0;
  }

  show() { $('hud').classList.remove('hidden'); }
  hide() { $('hud').classList.add('hidden'); }

  // Map switches hand the minimap the new circuit.
  setTrack(track) { this.track = track; }

  // ------------------------------------------------ speedometer (SVG arc)
  gaugeInit() {
    const svg = $('gauge');
    const cx = 100, cy = 100, r = 86;
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25; // 270° sweep
    let ticks = '';
    for (let i = 0; i <= 20; i++) {
      const a = a0 + (a1 - a0) * (i / 20);
      const big = i % 2 === 0;
      const r1 = big ? r - 12 : r - 7;
      const x1 = cx + Math.cos(a) * r1, y1 = cy + Math.sin(a) * r1;
      const x2 = cx + Math.cos(a) * r, y2 = cy + Math.sin(a) * r;
      ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="rgba(255,255,255,${big ? 0.9 : 0.45})" stroke-width="${big ? 3 : 1.6}"/>`;
    }
    const arc = (a, rr) => `${cx + Math.cos(a) * rr},${cy + Math.sin(a) * rr}`;
    svg.innerHTML = `
      <circle cx="${cx}" cy="${cy}" r="96" fill="rgba(8,11,17,0.42)"/>
      <path d="M ${arc(a0, r)} A ${r} ${r} 0 1 1 ${arc(a1, r)}" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="2"/>
      ${ticks}
      <path id="gaugeFill" d="" fill="none" stroke="#ff2d78" stroke-width="6" stroke-linecap="round"/>
      <line id="needle" x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - 70}" stroke="#ff2d78" stroke-width="4" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="7" fill="#ff2d78"/>`;
    this.gaugeA0 = a0; this.gaugeA1 = a1;
  }

  gauge(mph) {
    const f = Math.min(1, mph / 200);
    const a = this.gaugeA0 + (this.gaugeA1 - this.gaugeA0) * f;
    const cx = 100, cy = 100;
    $('needle').setAttribute('x2', cx + Math.cos(a) * 70);
    $('needle').setAttribute('y2', cy + Math.sin(a) * 70);
    const r = 80;
    const large = a - this.gaugeA0 > Math.PI ? 1 : 0;
    $('gaugeFill').setAttribute('d',
      `M ${cx + Math.cos(this.gaugeA0) * r} ${cy + Math.sin(this.gaugeA0) * r} A ${r} ${r} 0 ${large} 1 ${cx + Math.cos(a) * r} ${cy + Math.sin(a) * r}`);
  }

  // ------------------------------------------------ per-frame race HUD
  update(st) {
    $('speedNum').textContent = Math.round(st.mph);
    $('gearNum').textContent = st.gear;
    this.gauge(st.mph);
    $('posNum').textContent = st.pos;
    $('posTotal').textContent = '/' + st.total;
    $('raceTime').textContent = fmtTime(st.time);
    $('lapNum').textContent = `${Math.min(st.lap, st.laps)}/${st.laps}`;
    if (st.cpYd !== null) {
      $('checkpoint').style.opacity = 1;
      $('cpDist').textContent = Math.round(st.cpYd) + ' YD';
      $('checkpoint').style.left = (50 + st.cpScreenX * 38) + '%';
    } else {
      $('checkpoint').style.opacity = 0;
    }
  }

  // Nitro meter beside the speedo. frac 0..1; `active` flashes the bar while
  // the boost is burning.
  nitro(frac, active) {
    const fill = $('nitroFill');
    fill.style.width = (frac * 100).toFixed(1) + '%';
    $('nitroWrap').classList.toggle('burning', !!active);
    $('nitroWrap').classList.toggle('empty', frac <= 0.001);
  }

  chain(pts, mult) {
    const el = $('chain');
    if (pts <= 0) { el.classList.add('hidden'); return; }
    el.classList.remove('hidden');
    $('chainPts').textContent = Math.round(pts);
    $('chainMult').textContent = '×' + mult.toFixed(1);
  }

  skill(label, pts, cls = '') {
    const div = document.createElement('div');
    div.className = 'skill-pop ' + cls;
    div.innerHTML = pts ? `${label}<span class="pts">+${Math.round(pts)}</span>` : label;
    const feed = $('skillFeed');
    feed.appendChild(div);
    while (feed.children.length > 3) feed.removeChild(feed.firstChild);
    setTimeout(() => div.remove(), 1700);
  }

  // ------------------------------------------------ first-race coach
  // Three rows, each retired the moment the player uses that control. Returns
  // true while any row is still showing, so the caller can stop feeding it.
  coachShow(on) {
    const el = $('coach');
    if (!el) return;
    el.classList.toggle('hidden', !on);
  }

  coachDone(which) {
    const row = document.querySelector(`.coach-row[data-coach="${which}"]`);
    if (!row || row.classList.contains('done')) return false;
    row.classList.add('done');
    setTimeout(() => row.remove(), 500);
    return true;
  }

  coachRemaining() {
    return document.querySelectorAll('.coach-row:not(.done)').length;
  }

  banner(text, ms = 2600) {
    const b = $('banner');
    b.textContent = text;
    b.classList.remove('hidden');
    clearTimeout(this._bt);
    this._bt = setTimeout(() => b.classList.add('hidden'), ms);
  }

  // ------------------------------------------------ minimap
  minimap(self, others, pickups = []) {
    const ctx = this.mmCtx;
    const W = this.mm.width;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.arc(W / 2, W / 2, W / 2 - 3, 0, Math.PI * 2);
    ctx.clip();

    const scale = 0.62; // world meters -> px
    ctx.translate(W / 2, W / 2);
    ctx.rotate(self.h + Math.PI);

    // track ribbon
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.lineWidth = 9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const S = this.track.samples;
    for (let i = 0; i < this.track.N; i += 12) {
      const x = (S[i].x - self.x) * scale, y = (S[i].z - self.z) * scale;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(40,46,56,0.9)';
    ctx.lineWidth = 5.5;
    ctx.stroke();

    // start line
    const s0 = S[0];
    ctx.save();
    ctx.translate((s0.x - self.x) * scale, (s0.z - self.z) * scale);
    ctx.rotate(-(self.h + Math.PI) + s0.h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-6, -1.5, 12, 3);
    ctx.restore();

    // nitro canisters still on the road
    ctx.fillStyle = '#ffb400';
    for (const p of pickups) {
      if (!p.active) continue;
      ctx.beginPath();
      ctx.arc((p.x - self.x) * scale, (p.z - self.z) * scale, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }

    // other cars
    for (const o of others) {
      ctx.fillStyle = o.human ? '#ffd23d' : 'rgba(235,238,244,0.95)';
      ctx.beginPath();
      ctx.arc((o.x - self.x) * scale, (o.z - self.z) * scale, o.human ? 5 : 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // self arrow (always center, pointing up)
    ctx.save();
    ctx.translate(W / 2, W / 2);
    ctx.fillStyle = '#35e0e6';
    ctx.beginPath();
    ctx.moveTo(0, -9); ctx.lineTo(6.5, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6.5, 7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // ------------------------------------------------ nameplates
  ensurePlate(id, name, posNum, human) {
    let el = this.plates.get(id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'plate';
      el.innerHTML = `<span class="pnum"></span><span class="pname ${human ? 'human' : ''}"></span>`;
      $('plates').appendChild(el);
      this.plates.set(id, el);
    }
    el.children[0].textContent = posNum;
    el.children[1].textContent = name;
    return el;
  }

  placePlate(id, sx, sy, visible) {
    const el = this.plates.get(id);
    if (!el) return;
    el.style.display = visible ? 'flex' : 'none';
    if (visible) {
      el.style.left = sx + 'px';
      el.style.top = sy + 'px';
    }
  }

  removePlate(id) {
    const el = this.plates.get(id);
    if (el) { el.remove(); this.plates.delete(id); }
  }

  // ------------------------------------------------ results
  results(rows, myId, extras = null) {
    const tbl = $('resultsTable');
    tbl.innerHTML = rows.map(r => `
      <tr class="${r.id === myId ? 'me' : ''}">
        <td class="rpos">${r.pos}</td>
        <td>${escapeHtml(r.name)}${r.id === myId ? ' (you)' : ''}</td>
        <td class="rtime">${r.dnf ? '—' : fmtTime(r.time)}</td>
        <td class="rtime">${r.bestLap ? 'best ' + fmtTime(r.bestLap) : ''}</td>
      </tr>`).join('');

    // Progression strip: medal, PBs, XP earned, level-ups.
    const box = $('resultsProgress');
    if (box) {
      const bits = [];
      const st = extras && extras.stats;
      if (st && st.medal) {
        const ico = { gold: '🥇', silver: '🥈', bronze: '🥉' }[st.medal];
        bits.push(`<span class="rp-medal">${ico} ${st.medal.toUpperCase()}${st.newMedal ? ' — NEW!' : ''}</span>`);
      }
      if (extras && extras.bestLap > 5000) {
        bits.push(`<span>LAP ${fmtTime(extras.bestLap)}${st && st.lapPB ? ' <b class="rp-pb">PB!</b>' : ''}</span>`);
      }
      if (extras && extras.xp > 0) {
        bits.push(`<span class="rp-xp">+${extras.xp.toLocaleString()} XP</span>`);
      }
      if (extras && extras.leveled) {
        bits.push(`<span class="rp-level">LEVEL UP → ${extras.level}</span>`);
      }
      box.innerHTML = bits.join('<span class="rp-dot">·</span>');
      box.classList.toggle('hidden', bits.length === 0);
      // Count the XP up from zero — earning it should feel like earning it.
      const xpEl = box.querySelector('.rp-xp');
      if (xpEl && extras && extras.xp > 0) {
        const total = extras.xp;
        const t0 = performance.now();
        const tick = () => {
          const k = Math.min(1, (performance.now() - t0) / 1200);
          const eased = 1 - Math.pow(1 - k, 3);
          xpEl.textContent = `+${Math.round(total * eased).toLocaleString()} XP`;
          if (k < 1 && !document.getElementById('results').classList.contains('hidden')) {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }
    }
    document.getElementById('results').classList.remove('hidden');
  }

  hideResults() { document.getElementById('results').classList.add('hidden'); }
}

export function fmtTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const t = ms % 1000;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(t).padStart(3, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

export function toast(text, ms = 3200) {
  const t = $('toast');
  t.textContent = text;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
