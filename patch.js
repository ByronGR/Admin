(function() {
 
  // Track recently toggled codes to prevent sync overwrite
  var _recentlyToggled = {};
 
  // ── 1. Toggle event delegation ────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn.classList.contains('toggle')) return;
    var row = btn.closest('.ot-row');
    if (!row) return;
    var code = row.dataset.code;
    if (!code) return;
    btn.onclick = null;
    _recentlyToggled[code.toUpperCase()] = Date.now();
    toggleRowPublished(btn, code.toUpperCase());
    e.stopPropagation();
  }, true);
 
  // ── 2. Load ALL opening data from Firebase and sync rows ──────────────────
  async function syncOpeningsFromFirebase() {
    try {
      var mod = await import('/firebase-config.js');
      var rows = document.querySelectorAll('.ot-row[data-code]');
      if (!rows.length) return;
 
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var code = (row.dataset.code || '').toUpperCase();
        if (!code) continue;
 
        try {
          var snap = await mod.getDoc(mod.doc(mod.db, 'openings', code));
          var fbStatus, fbPublished;
 
          if (snap.exists()) {
            var data = snap.data();
            fbStatus    = (data.status || 'draft').toLowerCase();
            fbPublished = !!data.published;
          } else {
            // Not in Firebase — use localStorage
            var ls = JSON.parse(localStorage.getItem('nw_opening_' + code) || '{}');
            fbStatus    = (ls.status || 'draft').toLowerCase();
            fbPublished = !!ls.published;
          }
 
          // Skip if recently toggled (prevent overwriting user action)
          if (_recentlyToggled[code] && (Date.now() - _recentlyToggled[code]) < 5000) return;
 
          // Sync localStorage to match Firebase
          var existing = JSON.parse(localStorage.getItem('nw_opening_' + code) || '{}');
          existing.status    = fbStatus;
          existing.published = fbPublished;
          existing.code      = existing.code || code;
          localStorage.setItem('nw_opening_' + code, JSON.stringify(existing));
 
          // Update toggle button
          var tb = row.querySelector('.toggle');
          var tl = tb && tb.nextElementSibling;
          if (tb) {
            if (fbPublished) tb.classList.add('on');
            else             tb.classList.remove('on');
          }
          if (tl) {
            tl.textContent = fbPublished ? 'Published' : 'Private';
            tl.style.color = fbPublished ? 'var(--green)' : 'var(--g4)';
          }
 
          // Update status badge
          var sc = row.children[3];
          if (sc) {
            // Never show "draft" to user — if published show active, if not show actual status
            var display = fbStatus;
            if (fbStatus === 'draft' && fbPublished)  display = 'active';
            if (fbStatus === 'draft' && !fbPublished) display = 'draft';
 
            var badges = {
              'active':   ['Active',   'rgba(16,185,129,0.12)', '#059669'],
              'on hold':  ['On hold',  'rgba(245,158,11,0.12)', '#D97706'],
              'draft':    ['Draft',    'rgba(107,114,128,0.1)', '#6B7280'],
              'archived': ['Archived', 'rgba(107,114,128,0.08)','#9CA3AF'],
            };
            var b = badges[display] || badges['draft'];
            sc.innerHTML = '<span style="background:'+b[1]+';color:'+b[2]+';font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">'+b[0]+'</span>';
          }
 
        } catch(rowErr) {}
      }
    } catch(e) {}
  }
 
  // Run after openings page loads
  setTimeout(syncOpeningsFromFirebase, 600);
 
  // ── 3. Hook into navTo ────────────────────────────────────────────────────
  var _origNavTo = window.navTo;
  window.navTo = function(id, label) {
    _origNavTo(id, label);
    if (id === 'openings') setTimeout(syncOpeningsFromFirebase, 400);
    if (id === 'team')     window.loadTeamFromFirestore();
  };
 
  // ── 4. Team loader — @nearwork.co staff only ──────────────────────────────
  window.loadTeamFromFirestore = async function() {
    var grid = document.getElementById('team-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">Loading team...</div>';
    try {
      var mod = await import('/firebase-config.js');
      var snap = await mod.getDocs(mod.collection(mod.db, 'users'));
      var adminRoles = ['admin','super_admin','sr_recruiter','recruiter'];
      var members = snap.docs
        .map(function(d) { return Object.assign({id:d.id}, d.data()); })
        .filter(function(m) {
          var role  = m.role || '';
          var email = m.email || '';
          return adminRoles.indexOf(role) > -1 || email.indexOf('@nearwork.co') > -1;
        });
 
      if (!members.length) {
        grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">No team members found.</div>';
        return;
      }
      var rg = {super_admin:'linear-gradient(135deg,#6C3CE1,#3D1FA8)',admin:'linear-gradient(135deg,#3D1FA8,#6C3CE1)',sr_recruiter:'linear-gradient(135deg,#10B981,#059669)',recruiter:'linear-gradient(135deg,#10B981,#059669)'};
      var rl = {super_admin:'Super Admin',admin:'Admin',sr_recruiter:'Sr. Recruiter',recruiter:'Recruiter'};
      var rb = {super_admin:'b-dark',admin:'b-purple',sr_recruiter:'b-green',recruiter:'b-green'};
      grid.innerHTML = members.map(function(m) {
        var first = m.firstName || (m.name||'').split(' ')[0] || '?';
        var last  = m.lastName  || (m.name||'').split(' ').slice(1).join(' ') || '';
        var name  = (first+' '+last).trim() || m.email || m.id;
        var ini   = ((first[0]||'')+(last[0]||'')).toUpperCase();
        var role  = m.role || 'recruiter';
        return '<div class="team-card">'
          +'<div class="tc-top"><div class="tc-av" style="background:'+(rg[role]||'linear-gradient(135deg,#6B7280,#9CA3AF)')+'">'+ini+'</div>'
          +'<div><div class="tc-name">'+name+'</div><div class="tc-role">'+(rl[role]||role)+'</div></div></div>'
          +'<div style="font-size:11px;color:var(--g5);margin-bottom:10px;">'+(m.email||'')+'</div>'
          +'<div style="margin-bottom:10px;"><span class="badge '+(rb[role]||'b-amber')+'">'+(rl[role]||role)+'</span></div>'
          +'<div class="tc-actions"><button class="btn btn-ghost btn-sm">Edit access</button></div></div>';
      }).join('');
    } catch(e) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;grid-column:1/-1;">Error: '+e.message+'</div>';
    }
  };
 
})();
