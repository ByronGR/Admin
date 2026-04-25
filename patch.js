(function() {
 
  // ── Fix event delegation for ALL toggle buttons ──────────────────────────
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
 
  // ── Fix status badges from localStorage on load ───────────────────────────
  function fixRows() {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf('nw_opening_') !== 0) continue;
      try {
        var d = JSON.parse(localStorage.getItem(key));
        if (!d || !d.code) continue;
        var row = document.querySelector('.ot-row[data-code="' + d.code.toLowerCase() + '"]');
        if (!row) continue;
        var pub = !!d.published;
        var st  = d.status || 'draft';
        // Fix toggle
        var tb = row.querySelector('.toggle');
        var tl = tb && tb.nextElementSibling;
        if (tb) { if (pub) tb.classList.add('on'); else tb.classList.remove('on'); }
        if (tl) { tl.textContent = pub ? 'Published' : 'Private'; tl.style.color = pub ? 'var(--green)' : 'var(--g4)'; }
        // Fix status badge
        var sc = row.children[3];
        if (sc) {
          var ds = (st === 'draft' && pub) ? 'active' : st;
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
      } catch(e) {}
    }
  }
  setTimeout(fixRows, 500);
  setTimeout(fixRows, 1500);
 
  // ── Team loader from Firestore ────────────────────────────────────────────
  window.loadTeamFromFirestore = async function() {
    var grid = document.getElementById('team-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">Loading team...</div>';
    try {
      var mod = await import('./firebase-config.js');
      var snap = await mod.getDocs(mod.collection(mod.db, 'users'));
      var members = snap.docs.map(function(d) { return Object.assign({id:d.id}, d.data()); });
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
      grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;grid-column:1/-1;">Error loading team: '+e.message+'</div>';
    }
  };
 
  // Load team when navigating to team page
  var _origNavTo = window.navTo;
  window.navTo = function(id, label) {
    _origNavTo(id, label);
    if (id === 'team') window.loadTeamFromFirestore();
  };
 
})();
