// Nearwork Admin — Runtime Patch v2
 
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
 
  // ── 2. Fix toggleRowPublished ────────────────────────────────────────────
  window.toggleRowPublished = async function(btn, code) {
    btn.classList.toggle('on');
    var on = btn.classList.contains('on');
    var label = btn.nextElementSibling;
    if (label) {
      label.textContent = on ? 'Published' : 'Private';
      label.style.color = on ? 'var(--green)' : 'var(--g4)';
    }
 
    // Update status badge in row
    var row = btn.closest('.ot-row');
    if (row) {
      var sc = row.children[3];
      if (sc && on) {
        // When publishing — show Active
        sc.innerHTML = '<span style="background:rgba(16,185,129,0.12);color:#059669;font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">Active</span>';
      } else if (sc && !on) {
        // When unpublishing — show Private
        sc.innerHTML = '<span style="background:rgba(107,114,128,0.1);color:#6B7280;font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">Private</span>';
      }
    }
 
    // Save to localStorage
    var key = 'nw_opening_' + code;
    var data = JSON.parse(localStorage.getItem(key) || '{}');
    data.published = on;
    data.status = on ? 'active' : 'draft';
    data.code = data.code || code;
    localStorage.setItem(key, JSON.stringify(data));
 
    // Write to Firebase
    try {
      var mod = await import('./firebase-config.js');
      await mod.setDoc(mod.doc(mod.db, 'openings', code), {
        published: on,
        status: on ? 'active' : 'draft',
        updatedAt: mod.serverTimestamp()
      }, { merge: true });
      toast(on ? '✓ Published — visible on jobs page' : '✓ Unpublished — hidden from jobs page', 'ok');
    } catch(e) {
      toast('Firebase error: ' + e.message, 'ok');
    }
  };
 
  // ── 3. Route after auth completes ────────────────────────────────────────
  var observer = new MutationObserver(function() {
    if (!document.getElementById('auth-guard')) {
      observer.disconnect();
      var p = window.location.pathname;
      if (p.startsWith('/dashboard')) p = p.slice(10) || '/';
 
      if (p.includes('/openings/open-')) {
        var c = p.split('/openings/')[1].toUpperCase();
        var raw = localStorage.getItem('nw_opening_' + c);
        if (raw) {
          try {
            var d = JSON.parse(raw);
            var st = (d.status === 'draft' && d.published) ? 'active' : (d.status || 'active');
            setTimeout(function() {
              openOpeningDetail(d.code||c, d.title||c, st, !!d.published, d.recruiter||'Byron Giraldo');
            }, 50);
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
          (function(page, lbl) {
            setTimeout(function() { window.navTo(page, lbl); }, 50);
          })(routes[i][1], routes[i][2]);
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
 
  // ── 4. Fix status badges + toggle state from localStorage ────────────────
  // Run after page fully loads
  function fixOpeningRows() {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || !key.startsWith('nw_opening_')) continue;
      try {
        var d = JSON.parse(localStorage.getItem(key));
        if (!d || !d.code) continue;
        var row = document.querySelector('.ot-row[data-code="' + d.code.toLowerCase() + '"]');
        if (!row) continue;
 
        var published = !!d.published;
        var status    = d.status || 'draft';
 
        // Fix toggle button state
        var toggleBtn = row.querySelector('.toggle');
        var toggleLbl = toggleBtn && toggleBtn.nextElementSibling;
        if (toggleBtn) {
          if (published) toggleBtn.classList.add('on');
          else           toggleBtn.classList.remove('on');
        }
        if (toggleLbl) {
          toggleLbl.textContent = published ? 'Published' : 'Private';
          toggleLbl.style.color = published ? 'var(--green)' : 'var(--g4)';
        }
 
        // Fix status badge
        var sc = row.children[3];
        if (sc) {
          var displayStatus = (status === 'draft' && published) ? 'active' : status;
          var badges = {
            active:    ['Active',   'rgba(16,185,129,0.12)', '#059669'],
            'on hold': ['On hold',  'rgba(245,158,11,0.12)', '#D97706'],
            draft:     ['Draft',    'rgba(107,114,128,0.1)', '#6B7280'],
            private:   ['Private',  'rgba(107,114,128,0.1)', '#6B7280'],
            archived:  ['Archived', 'rgba(107,114,128,0.08)','#9CA3AF'],
          };
          var b = badges[displayStatus] || badges.draft;
          sc.innerHTML = '<span style="background:'+b[1]+';color:'+b[2]+';font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">'+b[0]+'</span>';
        }
      } catch(e) {}
    }
  }
 
  // Run once DOM is ready and again after loadSavedOpenings runs
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(fixOpeningRows, 300); });
  } else {
    setTimeout(fixOpeningRows, 300);
  }
  setTimeout(fixOpeningRows, 1000); // second pass after Firebase data loads
 
  // ── 5. Fix upsertOpeningRow status normalization ──────────────────────
  var _origUpsert = window.upsertOpeningRow;
  if (_origUpsert) {
    window.upsertOpeningRow = function(code, data) {
      var d = Object.assign({}, data);
      if (d.status === 'draft' && d.published) d.status = 'active';
      _origUpsert(code, d);
    };
  }
 
  // ── 6. Team page loader ───────────────────────────────────────────────────
  window.loadTeamFromFirestore = async function() {
    var grid = document.getElementById('team-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">Loading team...</div>';
    try {
      var mod = await import('./firebase-config.js');
      var snap = await mod.getDocs(mod.collection(mod.db, 'users'));
      var members = snap.docs.map(function(doc) { return Object.assign({ id: doc.id }, doc.data()); });
      if (!members.length) {
        grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">No team members found.</div>';
        return;
      }
      var rg = { super_admin:'linear-gradient(135deg,#6C3CE1,#3D1FA8)', admin:'linear-gradient(135deg,#3D1FA8,#6C3CE1)', sr_recruiter:'linear-gradient(135deg,#10B981,#059669)', recruiter:'linear-gradient(135deg,#10B981,#059669)' };
      var rl = { super_admin:'Super Admin', admin:'Admin', sr_recruiter:'Sr. Recruiter', recruiter:'Recruiter' };
      var rb = { super_admin:'b-dark', admin:'b-purple', sr_recruiter:'b-green', recruiter:'b-green' };
      grid.innerHTML = members.map(function(m) {
        var first = m.firstName || (m.name||'').split(' ')[0] || '?';
        var last  = m.lastName  || (m.name||'').split(' ').slice(1).join(' ') || '';
        var name  = (first+' '+last).trim() || m.email || m.id;
        var ini   = ((first[0]||'')+(last[0]||'')).toUpperCase();
        var role  = m.role || 'recruiter';
        var grad  = rg[role] || 'linear-gradient(135deg,#6B7280,#9CA3AF)';
        var label = rl[role] || role;
        var badge = rb[role] || 'b-amber';
        return '<div class="team-card">'
          + '<div class="tc-top"><div class="tc-av" style="background:'+grad+'">'+ini+'</div>'
          + '<div><div class="tc-name">'+name+'</div><div class="tc-role">'+label+'</div></div></div>'
          + '<div style="font-size:11px;color:var(--g5);margin-bottom:10px;">'+(m.email||'')+'</div>'
          + '<div style="margin-bottom:10px;"><span class="badge '+badge+'">'+label+'</span></div>'
          + '<div class="tc-actions"><button class="btn btn-ghost btn-sm">Edit access</button></div></div>';
      }).join('');
    } catch(e) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;grid-column:1/-1;">Error: '+e.message+'</div>';
    }
  };
 
  // Load team when navigating to team page
  var _nt2 = window.navTo;
  window.navTo = function(id, label) {
    _nt2(id, label);
    if (id === 'team') window.loadTeamFromFirestore();
  };
 
 
  // ── 7. Fix ALL toggle buttons via event delegation ───────────────────────
  // Dynamically created rows (from wizard) have wrong inline onclick.
  // This catches ALL toggle clicks and routes them through toggleRowPublished.
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn.classList.contains('toggle')) return;
    // Only handle if it's inside a pub-toggle inside an ot-row
    var row = btn.closest('.ot-row');
    if (!row) return;
    var code = row.dataset.code;
    if (!code) return;
    // Remove the inline onclick to prevent double-firing
    btn.onclick = null;
    // Call our fixed version
    window.toggleRowPublished(btn, code.toUpperCase());
    e.stopPropagation();
  }, true); // capture phase — runs before inline onclick
 
})();
