(function() {
 
  // Fix toggleRowPublished
  window.toggleRowPublished = async function(btn, code) {
    btn.classList.toggle('on');
    var on = btn.classList.contains('on');
    var label = btn.nextElementSibling;
    if (label) { label.textContent = on ? 'Published' : 'Private'; label.style.color = on ? 'var(--green)' : 'var(--g4)'; }
    var row = btn.closest('.ot-row');
    if (row) {
      var sc = row.children[3];
      if (sc) sc.innerHTML = on
        ? '<span style="background:rgba(16,185,129,0.12);color:#059669;font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">Active</span>'
        : '<span style="background:rgba(107,114,128,0.1);color:#6B7280;font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">Private</span>';
    }
    var key = 'nw_opening_' + code;
    var data = JSON.parse(localStorage.getItem(key) || '{}');
    data.published = on; data.status = on ? 'active' : 'draft'; data.code = data.code || code;
    localStorage.setItem(key, JSON.stringify(data));
    try {
      var mod = await import('./firebase-config.js');
      await mod.setDoc(mod.doc(mod.db, 'openings', code), { published: on, status: on ? 'active' : 'draft', updatedAt: mod.serverTimestamp() }, { merge: true });
      toast(on ? '✓ Published' : '✓ Unpublished', 'ok');
    } catch(e) { toast('Firebase error: ' + e.message, 'ok'); }
  };
 
  // Event delegation for toggles
  document.addEventListener('click', function(e) {
    var btn = e.target;
    if (!btn.classList.contains('toggle')) return;
    var row = btn.closest('.ot-row');
    if (!row) return;
    var code = row.dataset.code;
    if (!code) return;
    btn.onclick = null;
    window.toggleRowPublished(btn, code.toUpperCase());
    e.stopPropagation();
  }, true);
 
  // Fix openOrgDetail to save slug and push clean URL
  var _origOpenOrg = window.openOrgDetail;
  window.openOrgDetail = function(orgId, name, domain, initials, plan, status) {
    if (_origOpenOrg) _origOpenOrg(orgId, name, domain, initials, plan, status);
    var slug = orgId.toLowerCase().replace(/[^a-z0-9]/g, '-');
    localStorage.setItem('nw_last_org', JSON.stringify({orgId:orgId, name:name, domain:domain, initials:initials, plan:plan, status:status, slug:slug}));
    history.replaceState({page:'org-detail'}, '', '/orgs/' + slug);
  };
 
  // Wait for auth guard to be removed, then route
  var done = false;
  var interval = setInterval(function() {
    if (document.getElementById('auth-guard')) return;
    clearInterval(interval);
    if (done) return;
    done = true;
 
    var p = window.location.pathname;
 
    // Org detail
    if (p.indexOf('/orgs/') > -1) {
      var slug = p.split('/orgs/')[1].split('/')[0];
      if (slug && slug.length > 0) {
        var orgMap = {
          'org-cs01': ['ORG-CS01','Crestline SaaS','crestline.io','CS','Essential','active'],
          'org-at02': ['ORG-AT02','Axiom Tech','axiomtech.io','AT','Lite','active'],
          'org-nd03': ['ORG-ND03','NovaDash','novadash.com','ND','Essential','hold']
        };
        var orgData = orgMap[slug];
        if (!orgData) {
          try {
            var lo = JSON.parse(localStorage.getItem('nw_last_org') || 'null');
            if (lo && lo.slug === slug) orgData = [lo.orgId, lo.name, lo.domain, lo.initials, lo.plan, lo.status];
          } catch(e) {}
        }
        if (orgData) {
          setTimeout(function() { window.openOrgDetail.apply(null, orgData); }, 100);
        } else {
          setTimeout(function() { navTo('orgs', 'Organizations'); }, 100);
        }
        return;
      }
    }
 
    // Specific opening
    if (p.indexOf('/openings/open-') > -1) {
      var c = p.split('/openings/')[1].toUpperCase();
      var raw = localStorage.getItem('nw_opening_' + c);
      if (raw) {
        try {
          var d = JSON.parse(raw);
          var st = (d.status === 'draft' && d.published) ? 'active' : (d.status || 'active');
          setTimeout(function() { openOpeningDetail(d.code||c, d.title||c, st, !!d.published, d.recruiter||'Byron Giraldo'); }, 100);
          return;
        } catch(e) {}
      }
      setTimeout(function() { navTo('openings','Openings'); }, 100);
      return;
    }
 
    // All other pages
    var routes = [
      ['/openings','openings','Openings'],
      ['/orgs','orgs','Organizations'],
      ['/candidates','candidates','Candidates'],
      ['/pipeline','pipeline','Pipelines'],
      ['/questions','question-bank','Question Bank'],
      ['/skills','skills','Skills'],
      ['/team','team','Team'],
      ['/audit','audit','Audit Log'],
      ['/assessments','assessments','Assessments'],
      ['/hired','hired','Hired'],
      ['/blog','blog','Blog']
    ];
    for (var i = 0; i < routes.length; i++) {
      if (p.indexOf(routes[i][0]) > -1) {
        (function(pg, lb) { setTimeout(function() { navTo(pg, lb); }, 100); })(routes[i][1], routes[i][2]);
        return;
      }
    }
  }, 50);
 
  // Fix status badges
  setTimeout(function() {
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || key.indexOf('nw_opening_') !== 0) continue;
      try {
        var d = JSON.parse(localStorage.getItem(key));
        if (!d || !d.code) continue;
        var row = document.querySelector('.ot-row[data-code="' + d.code.toLowerCase() + '"]');
        if (!row) continue;
        var pub = !!d.published, st = d.status || 'draft';
        var tb = row.querySelector('.toggle'), tl = tb && tb.nextElementSibling;
        if (tb) { if (pub) tb.classList.add('on'); else tb.classList.remove('on'); }
        if (tl) { tl.textContent = pub ? 'Published' : 'Private'; tl.style.color = pub ? 'var(--green)' : 'var(--g4)'; }
        var sc = row.children[3]; if (!sc) continue;
        var ds = (st === 'draft' && pub) ? 'active' : st;
        var bm = {active:['Active','rgba(16,185,129,0.12)','#059669'],'on hold':['On hold','rgba(245,158,11,0.12)','#D97706'],draft:['Draft','rgba(107,114,128,0.1)','#6B7280']};
        var b = bm[ds] || bm.draft;
        sc.innerHTML = '<span style="background:'+b[1]+';color:'+b[2]+';font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">'+b[0]+'</span>';
      } catch(e) {}
    }
  }, 800);
 
  // Team loader
  window.loadTeamFromFirestore = async function() {
    var grid = document.getElementById('team-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">Loading team...</div>';
    try {
      var mod = await import('./firebase-config.js');
      var snap = await mod.getDocs(mod.collection(mod.db, 'users'));
      var members = snap.docs.map(function(d) { return Object.assign({id:d.id}, d.data()); });
      if (!members.length) { grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">No team members.</div>'; return; }
      var rg = {super_admin:'linear-gradient(135deg,#6C3CE1,#3D1FA8)',admin:'linear-gradient(135deg,#3D1FA8,#6C3CE1)',sr_recruiter:'linear-gradient(135deg,#10B981,#059669)',recruiter:'linear-gradient(135deg,#10B981,#059669)'};
      var rl = {super_admin:'Super Admin',admin:'Admin',sr_recruiter:'Sr. Recruiter',recruiter:'Recruiter'};
      var rb = {super_admin:'b-dark',admin:'b-purple',sr_recruiter:'b-green',recruiter:'b-green'};
      grid.innerHTML = members.map(function(m) {
        var first = m.firstName || (m.name||'').split(' ')[0] || '?';
        var last = m.lastName || (m.name||'').split(' ').slice(1).join(' ') || '';
        var name = (first+' '+last).trim() || m.email || m.id;
        var ini = ((first[0]||'')+(last[0]||'')).toUpperCase();
        var role = m.role || 'recruiter';
        return '<div class="team-card"><div class="tc-top"><div class="tc-av" style="background:'+(rg[role]||'linear-gradient(135deg,#6B7280,#9CA3AF)')+'">'+ini+'</div><div><div class="tc-name">'+name+'</div><div class="tc-role">'+(rl[role]||role)+'</div></div></div><div style="font-size:11px;color:var(--g5);margin-bottom:10px;">'+(m.email||'')+'</div><div style="margin-bottom:10px;"><span class="badge '+(rb[role]||'b-amber')+'">'+(rl[role]||role)+'</span></div><div class="tc-actions"><button class="btn btn-ghost btn-sm">Edit access</button></div></div>';
      }).join('');
    } catch(e) { grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;grid-column:1/-1;">Error: '+e.message+'</div>'; }
  };
 
  var _nt = window.navTo;
  window.navTo = function(id, label) { _nt(id, label); if (id === 'team') window.loadTeamFromFirestore(); };
 
})();
