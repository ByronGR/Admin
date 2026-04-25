// Nearwork Admin — Runtime Patch
// Fixes: URL routing, refresh staying on page, toggle saving to Firebase

(function() {

  // ── 1. Fix navTo to use clean URLs ──────────────────────────────────────
  var _origNavTo = window.navTo;
  window.navTo = function(id, label) {
    _origNavTo(id, label);
    var map = {
      dashboard:'/', orgs:'/orgs', 'org-detail':'/orgs',
      pipeline:'/pipeline', candidates:'/candidates',
      openings:'/openings', 'opening-detail':'/openings',
      'opening-applicants':'/openings', 'question-bank':'/questions',
      skills:'/skills', team:'/team', audit:'/audit',
      assessments:'/assessments', hired:'/hired'
    };
    var url = map[id] !== undefined ? map[id] : '/' + id;
    history.replaceState({ page: id }, '', url);
  };

  // ── 2. Fix toggleRowPublished to write to Firebase ──────────────────────
  window.toggleRowPublished = async function(btn, code) {
    btn.classList.toggle('on');
    var on = btn.classList.contains('on');
    var label = btn.nextElementSibling;
    if (label) {
      label.textContent = on ? 'Published' : 'Private';
      label.style.color = on ? 'var(--green)' : 'var(--g4)';
    }
    // Save localStorage
    var key = 'nw_opening_' + code;
    var data = JSON.parse(localStorage.getItem(key) || '{}');
    data.published = on;
    data.code = data.code || code;
    localStorage.setItem(key, JSON.stringify(data));
    // Write to Firebase
    try {
      var mod = await import('./firebase-config.js');
      await mod.setDoc(mod.doc(mod.db, 'openings', code), {
        published: on,
        updatedAt: mod.serverTimestamp()
      }, { merge: true });
      toast(on ? '✓ Published — visible on jobs page' : '✓ Private — hidden from jobs page', 'ok');
    } catch(e) {
      toast('Saved locally. Firebase error: ' + e.message, 'ok');
    }
  };

  // ── 3. Route on auth complete ────────────────────────────────────────────
  // Wait for auth-guard to be removed, then route
  var observer = new MutationObserver(function() {
    if (!document.getElementById('auth-guard')) {
      observer.disconnect();
      var p = window.location.pathname;
      // Strip /dashboard prefix if present
      if (p.startsWith('/dashboard')) p = p.slice(10) || '/';
      if (p.includes('/openings/open-')) {
        var c = p.split('/openings/')[1].toUpperCase();
        var r = localStorage.getItem('nw_opening_' + c);
        if (r) {
          try {
            var d = JSON.parse(r);
            var st = (d.status === 'draft' && d.published) ? 'active' : (d.status || 'active');
            setTimeout(function() { openOpeningDetail(d.code||c, d.title||c, st, !!d.published, d.recruiter||'Byron Giraldo'); }, 50);
            return;
          } catch(e) {}
        }
        setTimeout(function() { window.navTo('openings','Openings'); }, 50);
        return;
      }
      var routes = [
        ['/openings',   'openings',     'Openings'],
        ['/orgs',       'orgs',         'Organizations'],
        ['/org',        'orgs',         'Organizations'],
        ['/candidates', 'candidates',   'Candidates'],
        ['/pipeline',   'pipeline',     'Pipelines'],
        ['/questions',  'question-bank','Question Bank'],
        ['/skills',     'skills',       'Skills'],
        ['/team',       'team',         'Team'],
        ['/audit',      'audit',        'Audit Log'],
      ];
      for (var i = 0; i < routes.length; i++) {
        if (p.includes(routes[i][0])) {
          (function(page, label) {
            setTimeout(function() { window.navTo(page, label); }, 50);
          })(routes[i][1], routes[i][2]);
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // ── 4. Fix status badge: draft+published = Active ────────────────────────
  var _origUpsert = window.upsertOpeningRow;
  if (_origUpsert) {
    window.upsertOpeningRow = function(code, data) {
      if (data.status === 'draft' && data.published) data = Object.assign({}, data, { status: 'active' });
      _origUpsert(code, data);
    };
  }

  // Fix status on existing rows after page loads
  setTimeout(function() {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || !key.startsWith('nw_opening_')) continue;
      try {
        var d = JSON.parse(localStorage.getItem(key));
        if (!d || !d.code) continue;
        var row = document.querySelector('.ot-row[data-code="' + d.code.toLowerCase() + '"]');
        if (!row) continue;
        // Fix status badge
        if (d.status === 'draft' && d.published) {
          var sc = row.children[3];
          if (sc) sc.innerHTML = '<span style="background:rgba(16,185,129,0.12);color:#059669;font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">Active</span>';
        }
        // Fix toggle label
        var lbl = row.querySelector('.pub-toggle span');
        if (lbl && typeof d.published === 'boolean') {
          lbl.textContent = d.published ? 'Published' : 'Private';
          lbl.style.color = d.published ? 'var(--green)' : 'var(--g4)';
          var btn = row.querySelector('.toggle');
          if (btn) { if (d.published) btn.classList.add('on'); else btn.classList.remove('on'); }
        }
      } catch(e) {}
    }
  }, 500);

})();
