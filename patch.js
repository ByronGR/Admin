(function() {
 
  // ── 1. Toggle event delegation ────────────────────────────────────────────
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn.classList.contains('toggle')) return;
    var row = btn.closest('.ot-row');
    if (!row) return;
    var code = row.dataset.code;
    if (!code) return;
    btn.onclick = null;
    toggleRowPublished(btn, code.toUpperCase());
    e.stopPropagation();
  }, true);
 
  // ── 2. Load status from Firebase for each opening row ────────────────────
  async function loadOpeningStatuses() {
    try {
      var mod = await import('./firebase-config.js');
      // Also try to get all published openings at once for efficiency
      var rows = document.querySelectorAll('.ot-row[data-code]');
      rows.forEach(async function(row) {
        var code = row.dataset.code ? row.dataset.code.toUpperCase() : '';
        if (!code) return;
        try {
          var snap = await mod.getDoc(mod.doc(mod.db, 'openings', code));
          if (!snap.exists()) return;
          var data = snap.data();
          var status = data.status || 'draft';
          var published = !!data.published;
 
          // Update toggle
          var tb = row.querySelector('.toggle');
          var tl = tb && tb.nextElementSibling;
          if (tb) { if (published) tb.classList.add('on'); else tb.classList.remove('on'); }
          if (tl) { tl.textContent = published ? 'Published' : 'Private'; tl.style.color = published ? 'var(--green)' : 'var(--g4)'; }
 
          // Update status badge
          var sc = row.children[3];
          if (sc) {
            var ds = (status === 'draft' && published) ? 'active' : status;
            var bm = {
              'active':   ['Active',   'rgba(16,185,129,0.12)', '#059669'],
              'on hold':  ['On hold',  'rgba(245,158,11,0.12)', '#D97706'],
              'draft':    ['Draft',    'rgba(107,114,128,0.1)', '#6B7280'],
              'private':  ['Private',  'rgba(107,114,128,0.1)', '#6B7280'],
              'archived': ['Archived', 'rgba(107,114,128,0.08)','#9CA3AF'],
            };
            var b = bm[ds] || bm['draft'];
            sc.innerHTML = '<span style="background:'+b[1]+';color:'+b[2]+';font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">'+b[0]+'</span>';
          }
 
          // Update localStorage to match Firebase
          var key = 'nw_opening_' + code;
          var existing = JSON.parse(localStorage.getItem(key) || '{}');
          existing.published = published;
          existing.status = status;
          existing.code = existing.code || code;
          localStorage.setItem(key, JSON.stringify(existing));
 
        } catch(e) {}
      });
    } catch(e) {}
  }
 
  // Run after page loads
  setTimeout(loadOpeningStatuses, 800);
 
  // Also run when openings page is shown
  var _origNavTo = window.navTo;
  window.navTo = function(id, label) {
    _origNavTo(id, label);
    if (id === 'openings') setTimeout(loadOpeningStatuses, 400);
    if (id === 'team') window.loadTeamFromFirestore();
  };
 
  // ── 3. Team loader — only @nearwork.co users ──────────────────────────────
  window.loadTeamFromFirestore = async function() {
    var grid = document.getElementById('team-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">Loading team...</div>';
    try {
      var mod = await import('./firebase-config.js');
      var snap = await mod.getDocs(mod.collection(mod.db, 'users'));
      var members = snap.docs
        .map(function(d) { return Object.assign({id:d.id}, d.data()); })
        .filter(function(m) {
          // Only show nearwork.co staff — exclude candidates and client users
          var email = m.email || '';
          var role = m.role || '';
          var adminRoles = ['admin','super_admin','sr_recruiter','recruiter'];
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
          + '<div class="tc-top"><div class="tc-av" style="background:'+(rg[role]||'linear-gradient(135deg,#6B7280,#9CA3AF)')+'">'+ini+'</div>'
          + '<div><div class="tc-name">'+name+'</div><div class="tc-role">'+(rl[role]||role)+'</div></div></div>'
          + '<div style="font-size:11px;color:var(--g5);margin-bottom:10px;">'+(m.email||'')+'</div>'
          + '<div style="margin-bottom:10px;"><span class="badge '+(rb[role]||'b-amber')+'">'+(rl[role]||role)+'</span></div>'
          + '<div class="tc-actions"><button class="btn btn-ghost btn-sm">Edit access</button></div></div>';
      }).join('');
    } catch(e) {
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;grid-column:1/-1;">Error: '+e.message+'</div>';
    }
  };
 
})();
