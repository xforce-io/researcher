/** Shipped video-detail workbench logic. Tests import this file. */

export function visibleCues(cues, query) {
  const list = Array.isArray(cues) ? cues : [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list.slice();
  return list.filter((c) =>
    String(c.text ?? '').toLowerCase().includes(q)
    || String(c.zh ?? '').toLowerCase().includes(q),
  );
}

/** Current cue among a visible subset: t ∈ [start, end). Overlap → max start, then min id. */
export function currentCueInVisible(visible, t) {
  const list = Array.isArray(visible) ? visible : [];
  const time = Number(t);
  if (!list.length || !Number.isFinite(time)) return null;
  const hits = list.filter((c) => c.start <= time && time < c.end);
  if (!hits.length) return null;
  hits.sort((a, b) => (b.start - a.start) || (a.id - b.id));
  return hits[0];
}

export function cycleHitIndex(hitIds, index, dir) {
  const hits = Array.isArray(hitIds) ? hitIds : [];
  if (!hits.length) return -1;
  const d = dir >= 0 ? 1 : -1;
  if (index < 0 || index >= hits.length) return d > 0 ? 0 : hits.length - 1;
  return (index + d + hits.length) % hits.length;
}

/** ScrollTop that places el's vertical center on the pane's vertical center. */
export function centeredScrollTop(paneHeight, paneScrollHeight, elOffsetTop, elHeight) {
  const mid = elOffsetTop + elHeight / 2 - paneHeight / 2;
  const max = Math.max(0, paneScrollHeight - paneHeight);
  return Math.min(max, Math.max(0, mid));
}

export function formatCueClock(seconds) {
  const t = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  return m + ':' + String(s).padStart(2, '0');
}

export function bindVideoWorkbench() {
  const cues = Array.isArray(window.__CUES) ? window.__CUES : [];
  const player = document.getElementById('player');
  const list = document.getElementById('cues');
  const q = document.getElementById('cue-q');
  const hitCount = document.getElementById('hitCount');
  const id = document.querySelector('[data-video-id]')?.dataset.videoId;
  let hitIndex = -1;
  let follow = true;
  let programmaticScroll = false;

  function hitsForQuery() {
    const needle = (q?.value || '').trim();
    if (!needle) return [];
    return visibleCues(cues, needle).map((c) => c.id);
  }

  function render() {
    if (!list) return;
    const vis = visibleCues(cues, q?.value || '');
    const hits = hitsForQuery();
    if (hitCount) {
      const needle = (q?.value || '').trim();
      if (!needle) hitCount.textContent = `${cues.length} cues`;
      else if (!hits.length) hitCount.textContent = '0 hits';
      else if (hitIndex >= 0) hitCount.textContent = `${hitIndex + 1}/${hits.length}`;
      else hitCount.textContent = `${hits.length} hits`;
    }
    if (cues.length && vis.length === 0) {
      list.innerHTML = '<p class="status">No matching cues.</p>';
      return;
    }
    if (!cues.length) return;
    list.innerHTML = vis.map((c) =>
      '<article class="cue" data-id="' + c.id + '" data-start="' + c.start + '" data-end="' + c.end + '">' +
      '<div class="t">' + formatCueClock(c.start) + '</div>' +
      '<div class="txt-wrap"><div class="txt"></div>' +
      (c.zh ? '<div class="txt-zh"></div>' : '') +
      '</div></article>'
    ).join('');
    vis.forEach((c, i) => {
      list.querySelectorAll('.txt')[i].textContent = c.text;
      const zhEl = list.querySelectorAll('.cue')[i].querySelector('.txt-zh');
      if (zhEl && c.zh) zhEl.textContent = c.zh;
    });
  }

  function scrollCueIntoPane(el, opts) {
    if (!el || !list) return;
    if (!follow && !(opts && opts.force)) return;
    programmaticScroll = true;
    list.scrollTop = centeredScrollTop(list.clientHeight, list.scrollHeight, el.offsetTop, el.offsetHeight);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { programmaticScroll = false; });
    });
  }

  function pauseFollowFromUser() {
    follow = false;
  }

  function seekCueId(cueId, play) {
    const cue = cues.find((c) => c.id === cueId);
    if (!cue) return;
    if (!window.__MEDIA) { alert('Media file is missing. Restore it to seek.'); return; }
    follow = true;
    if (player) {
      player.currentTime = cue.start;
      if (play) player.play().catch(() => {});
    }
    const node = list?.querySelector(`[data-id="${cueId}"]`);
    if (node) scrollCueIntoPane(node, { force: true });
  }

  function jumpHit(dir) {
    const hits = hitsForQuery();
    if (!hits.length) return;
    hitIndex = cycleHitIndex(hits, hitIndex, dir);
    if (hitCount) hitCount.textContent = `${hitIndex + 1}/${hits.length}`;
    seekCueId(hits[hitIndex], true);
    list?.querySelectorAll('.hit-current').forEach((n) => n.classList.remove('hit-current'));
    const node = list?.querySelector(`[data-id="${hits[hitIndex]}"]`);
    if (node) node.classList.add('hit-current');
  }

  list?.addEventListener('click', (e) => {
    const cue = e.target.closest('.cue');
    if (!cue) return;
    seekCueId(Number(cue.dataset.id), true);
  });
  q?.addEventListener('input', () => {
    const hits = hitsForQuery();
    hitIndex = hits.length ? 0 : -1;
    render();
    if (hits.length) {
      const node = list?.querySelector(`[data-id="${hits[0]}"]`);
      if (node) {
        node.classList.add('hit-current');
        scrollCueIntoPane(node, { force: true });
      }
    }
  });
  list?.addEventListener('wheel', pauseFollowFromUser, { passive: true });
  list?.addEventListener('touchstart', pauseFollowFromUser, { passive: true });
  list?.addEventListener('scroll', () => {
    if (!programmaticScroll) pauseFollowFromUser();
  }, { passive: true });
  document.getElementById('prevHit')?.addEventListener('click', () => jumpHit(-1));
  document.getElementById('nextHit')?.addEventListener('click', () => jumpHit(1));

  player?.addEventListener('timeupdate', () => {
    const vis = visibleCues(cues, q?.value || '');
    const cur = currentCueInVisible(vis, player.currentTime);
    list?.querySelectorAll('.cue').forEach((el) => {
      const on = cur && el.dataset.id === String(cur.id);
      el.classList.toggle('active', Boolean(on));
    });
    if (cur) {
      const node = list?.querySelector(`[data-id="${cur.id}"]`);
      if (node) scrollCueIntoPane(node);
    }
  });

  const saveTitle = async () => {
    const btn = document.getElementById('save-title');
    const input = document.getElementById('video-title');
    const err = document.getElementById('title-error');
    const form = document.querySelector('.video-title-form');
    if (!btn || !input) return;
    const title = input.value;
    const expectedRevision = Number(form?.dataset.revision || '1');
    btn.disabled = true;
    if (err) { err.hidden = true; err.textContent = ''; }
    try {
      const res = await fetch('/library/documents/' + encodeURIComponent(id), {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, expectedRevision, mutationId: crypto.randomUUID() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (err) {
          err.hidden = false;
          err.textContent = data.message || 'Save failed';
        }
        return;
      }
      location.reload();
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e && e.message ? e.message : 'Save failed';
      }
    } finally {
      btn.disabled = false;
    }
  };
  document.getElementById('save-title')?.addEventListener('click', saveTitle);
  document.querySelector('.video-title-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    saveTitle();
  });

  document.getElementById('analyze-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('analyze-btn');
    const statusEl = document.getElementById('analyze-status');
    const setIdle = (msg) => {
      btn.disabled = false;
      btn.textContent = 'Analyze';
      if (statusEl) {
        statusEl.hidden = !msg;
        statusEl.textContent = msg || '';
      }
    };
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    try {
      const res = await fetch('/library/documents/' + encodeURIComponent(id) + '/analyses', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mutationId: crypto.randomUUID() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setIdle(data.message || (res.status === 503 ? 'analyzer unavailable' : 'analyze failed'));
        return;
      }
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const stRes = await fetch('/library/documents/' + encodeURIComponent(id) + '/analyses/' + encodeURIComponent(data.id));
        if (!stRes.ok) { setIdle('analysis failed'); return; }
        let st;
        try { st = await stRes.json(); } catch { setIdle('analysis failed'); return; }
        if (st.status === 'done' || st.status === 'failed') { location.reload(); return; }
      }
    } catch (err) {
      setIdle(err && err.message ? err.message : 'analyze failed');
    }
  });

  document.getElementById('restore-btn')?.addEventListener('click', async () => {
    const file = document.getElementById('restore-file')?.files?.[0];
    const hint = document.getElementById('restore-hint');
    if (!file) {
      if (hint) { hint.hidden = false; hint.textContent = 'Choose a file to restore.'; }
      return;
    }
    const body = new FormData();
    body.append('file', file, file.name);
    const res = await fetch('/library/documents/' + encodeURIComponent(id) + '/media/restore', { method: 'POST', body });
    if (res.status === 409) { alert('Not the same media file.'); return; }
    if (!res.ok) { alert('Restore failed'); return; }
    location.reload();
  });

  render();
}

if (typeof document !== 'undefined' && document.querySelector?.('[data-video-id]')) {
  bindVideoWorkbench();
}
