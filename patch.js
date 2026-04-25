// Nearwork Admin — Runtime Patch v3
(function() {
 
  // ── 1. Fix toggleRowPublished ────────────────────────────────────────────
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
      toast(on ? '✓ Published — visible on jobs page' : '✓ Private — hidden from jobs page', 'ok');
    } catch(e) { toast('Firebase error: ' + e.message, 'ok'); }
  };
 
  // ── 2. Event delegation — fix ALL toggle buttons including dynamic rows ──
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
 
  // ── 3. Fix openOrgDetail URL + store org data for refresh ──────────────
  var _origOpenOrgDetail = window.openOrgDetail;
  if (_origOpenOrgDetail) {
    window.openOrgDetail = function(orgId, name, domain, initials, plan, status) {
      _origOpenOrgDetail(orgId, name, domain, initials, plan, status);
      // Store org data so refresh can restore it
      var slug = orgId.toLowerCase().replace(/[^a-z0-9]/g, '-');
      localStorage.setItem('nw_last_org', JSON.stringify({ orgId:orgId, name:name, domain:domain, initials:initials, plan:plan, status:status, slug:slug }));
      // Push clean URL with org slug
      history.replaceState({ page:'org-detail', orgId:orgId, name:name }, '', '/orgs/' + slug);
      // Add org to runtime map so refresh works
      orgMap[slug] = [orgId, name, domain, initials, plan, status];
    };
  }
 
  // ── 4. Route after auth completes (MutationObserver) ────────────────────
  var orgMap = {
    'org-cs01': ['ORG-CS01','Crestline SaaS','crestline.io','CS','Essential','active'],
    'org-at02': ['ORG-AT02','Axiom Tech','axiomtech.io','AT','Lite','active'],
    'org-nd03': ['ORG-ND03','NovaDash','novadash.com','ND','Essential','hold'],
  };
 
  var observer = new MutationObserver(function() {
    if (!document.getElementById('auth-guard')) {
      observer.disconnect();
      var p = window.location.pathname;
      console.log('[NW] Auth complete, routing for path:', p);
      if (p.startsWith('/dashboard')) p = p.slice(10) || '/';
 
      // Specific opening
      if (p.includes('/openings/open-')) {
        var c = p.split('/openings/')[1].toUpperCase();
        var raw = localStorage.getItem('nw_opening_' + c);
        if (raw) { try { var d=JSON.parse(raw); var st=(d.status==='draft'&&d.published)?'active':(d.status||'active'); setTimeout(function(){ openOpeningDetail(d.code||c,d.title||c,st,!!d.published,d.recruiter||'Byron Giraldo'); },80); return; } catch(e){} }
        setTimeout(function(){ navTo('openings','Openings'); },80); return;
      }
 
      // Specific org — go directly to org detail, skip orgs list entirely
      if (p.match(/^\/orgs\/[a-z0-9-]+/)) {
        var slug2 = p.split('/orgs/')[1].split('/')[0];
        console.log('[NW] Org slug detected:', slug2);
        var orgData = orgMap[slug2];
        console.log('[NW] orgMap lookup:', orgData ? 'found' : 'not found');
        // Also check localStorage for orgs opened during this session
        if (!orgData) {
          try {
            var lastOrg = JSON.parse(localStorage.getItem('nw_last_org') || 'null');
            console.log('[NW] localStorage nw_last_org:', lastOrg);
            if (lastOrg && lastOrg.slug === slug2) {
              orgData = [lastOrg.orgId, lastOrg.name, lastOrg.domain, lastOrg.initials, lastOrg.plan, lastOrg.status];
              console.log('[NW] Using localStorage org data');
            }
          } catch(e) { console.log('[NW] localStorage error:', e); }
        }
        if (orgData) {
          console.log('[NW] Opening org detail with:', orgData[0]);
          showPage('orgs');
          setTimeout(function(){ 
            console.log('[NW] Calling openOrgDetail now');
            openOrgDetail.apply(null, orgData); 
          }, 100);
          return;
        }
        console.log('[NW] No org data found, going to orgs list');
        setTimeout(function(){ navTo('orgs','Organizations'); }, 80);
        return;
      }
 
      var routes = [
        ['/openings',   'openings',     'Openings'],
        // /orgs without slug — show list; /orgs/slug handled above
        ['/orgs',       'orgs',         'Organizations'],
        ['/candidates', 'candidates',   'Candidates'],
        ['/pipeline',   'pipeline',     'Pipelines'],
        ['/questions',  'question-bank','Question Bank'],
        ['/skills',     'skills',       'Skills'],
        ['/team',       'team',         'Team'],
        ['/audit',      'audit',        'Audit Log'],
        ['/assessments','assessments',  'Assessments'],
        ['/hired',      'hired',        'Hired'],
        ['/blog',       'blog',         'Blog'],
      ];
      for (var i=0; i<routes.length; i++) {
        if (p.includes(routes[i][0])) {
          (function(pg,lb){ setTimeout(function(){ navTo(pg,lb); },80); })(routes[i][1],routes[i][2]);
          return;
        }
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
 
  // ── 5. Fix status badges from localStorage ───────────────────────────────
  function fixRows() {
    for (var i=0; i<localStorage.length; i++) {
      var key = localStorage.key(i);
      if (!key || !key.startsWith('nw_opening_')) continue;
      try {
        var d = JSON.parse(localStorage.getItem(key));
        if (!d || !d.code) continue;
        var row = document.querySelector('.ot-row[data-code="'+d.code.toLowerCase()+'"]');
        if (!row) continue;
        var pub = !!d.published, st = d.status||'draft';
        var toggleBtn = row.querySelector('.toggle');
        var toggleLbl = toggleBtn && toggleBtn.nextElementSibling;
        if (toggleBtn) { if(pub) toggleBtn.classList.add('on'); else toggleBtn.classList.remove('on'); }
        if (toggleLbl) { toggleLbl.textContent=pub?'Published':'Private'; toggleLbl.style.color=pub?'var(--green)':'var(--g4)'; }
        var sc=row.children[3]; if(!sc) continue;
        var ds=(st==='draft'&&pub)?'active':st;
        var bm={'active':['Active','rgba(16,185,129,0.12)','#059669'],'on hold':['On hold','rgba(245,158,11,0.12)','#D97706'],'draft':['Draft','rgba(107,114,128,0.1)','#6B7280'],'private':['Private','rgba(107,114,128,0.1)','#6B7280'],'archived':['Archived','rgba(107,114,128,0.08)','#9CA3AF']};
        var b=bm[ds]||bm.draft;
        sc.innerHTML='<span style="background:'+b[1]+';color:'+b[2]+';font-weight:700;padding:3px 9px;border-radius:99px;font-size:10px;">'+b[0]+'</span>';
      } catch(e) {}
    }
  }
  setTimeout(fixRows,300); setTimeout(fixRows,1000);
 
  // ── 6. Fix upsertOpeningRow status normalization ──────────────────────────
  var _origUpsert = window.upsertOpeningRow;
  if (_origUpsert) {
    window.upsertOpeningRow = function(code, data) {
      var d = Object.assign({}, data);
      if (d.status==='draft' && d.published) d.status='active';
      _origUpsert(code, d);
    };
  }
 
  // ── 7. Edit pipeline stages modal ────────────────────────────────────────
  // Create the modal and inject it
  var editPipelineModal = document.createElement('div');
  editPipelineModal.className = 'modal-bg';
  editPipelineModal.id = 'edit-pipeline-modal';
  editPipelineModal.onclick = function(e) { if(e.target===this) closeModal('edit-pipeline-modal'); };
  editPipelineModal.innerHTML = `
    <div class="modal" style="max-width:520px;">
      <div class="modal-hdr">
        <div>
          <div class="modal-title">Edit pipeline stages</div>
          <div style="font-size:11px;color:var(--g5);margin-top:2px;">Drag to reorder · Toggle to show/hide</div>
        </div>
        <button class="modal-close" onclick="closeModal('edit-pipeline-modal')">✕</button>
      </div>
      <div class="modal-body" id="edit-stages-list" style="display:flex;flex-direction:column;gap:6px;"></div>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal('edit-pipeline-modal')">Cancel</button>
        <button class="btn btn-p" onclick="savePipelineStages()">Save stages</button>
      </div>
    </div>`;
  document.body.appendChild(editPipelineModal);
 
  var DEFAULT_STAGES = [
    { id:'applied',       name:'Applied',         locked:true  },
    { id:'profile-review',name:'Profile Review',  locked:false },
    { id:'assessment',    name:'Assessment',       locked:false },
    { id:'background',    name:'Background Check', locked:false },
    { id:'presented',     name:'Presented',        locked:false },
    { id:'client-review', name:'Client Review',    locked:false },
    { id:'hired',         name:'Hired',            locked:true  },
    { id:'denied',        name:'Denied',           locked:true  },
  ];
 
  // Override openModal to populate stage list
  var _origOpenModal = window.openModal;
  window.openModal = function(id) {
    if (id === 'edit-pipeline-modal') {
      var list = document.getElementById('edit-stages-list');
      var stages = DEFAULT_STAGES;
      try { var saved = localStorage.getItem('nw_pipeline_stages'); if(saved) stages = JSON.parse(saved); } catch(e){}
      list.innerHTML = stages.map(function(s,i) {
        return '<div class="stage-row" data-stage-id="'+s.id+'" draggable="true" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fff;border:1.5px solid var(--g2);border-radius:9px;cursor:grab;">'
          + '<span style="color:var(--g4);font-size:14px;cursor:grab;">⠿</span>'
          + '<span style="flex:1;font-size:13px;font-weight:600;color:var(--black);">'+s.name+'</span>'
          + (s.locked ? '<span style="font-size:10px;color:var(--g4);background:var(--g1);padding:2px 8px;border-radius:99px;">Locked</span>'
            : '<label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:12px;color:var(--g5);">'
              + '<input type="checkbox" '+(s.visible!==false?'checked':'')+'> Visible</label>')
          + '</div>';
      }).join('');
      // Simple drag-to-reorder
      var rows = list.querySelectorAll('.stage-row');
      rows.forEach(function(row) {
        row.addEventListener('dragstart', function(){ this.style.opacity='.4'; window._dragStage=this; });
        row.addEventListener('dragend',   function(){ this.style.opacity='1'; });
        row.addEventListener('dragover',  function(e){ e.preventDefault(); this.style.borderColor='var(--purple)'; });
        row.addEventListener('dragleave', function(){ this.style.borderColor='var(--g2)'; });
        row.addEventListener('drop', function(e) {
          e.preventDefault(); this.style.borderColor='var(--g2)';
          if (window._dragStage && window._dragStage !== this) {
            list.insertBefore(window._dragStage, this);
          }
        });
      });
    }
    _origOpenModal(id);
  };
 
  window.savePipelineStages = function() {
    var rows = document.querySelectorAll('#edit-stages-list .stage-row');
    var stages = Array.from(rows).map(function(r) {
      var orig = DEFAULT_STAGES.find(function(s){ return s.id===r.dataset.stageId; }) || {};
      var cb = r.querySelector('input[type=checkbox]');
      return { id:r.dataset.stageId, name:r.querySelector('span:nth-child(2)').textContent, locked:!!orig.locked, visible:cb?cb.checked:true };
    });
    localStorage.setItem('nw_pipeline_stages', JSON.stringify(stages));
    closeModal('edit-pipeline-modal');
    toast('Pipeline stages saved ✓','ok');
  };
 
  // ── 8. Team page loader ───────────────────────────────────────────────────
  window.loadTeamFromFirestore = async function() {
    var grid = document.getElementById('team-grid');
    if (!grid) return;
    grid.innerHTML = '<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">Loading team...</div>';
    try {
      var mod = await import('./firebase-config.js');
      var snap = await mod.getDocs(mod.collection(mod.db, 'users'));
      var members = snap.docs.map(function(d){ return Object.assign({id:d.id},d.data()); });
      if (!members.length) { grid.innerHTML='<div style="padding:32px;text-align:center;color:var(--g4);font-size:13px;grid-column:1/-1;">No team members found.</div>'; return; }
      var rg={super_admin:'linear-gradient(135deg,#6C3CE1,#3D1FA8)',admin:'linear-gradient(135deg,#3D1FA8,#6C3CE1)',sr_recruiter:'linear-gradient(135deg,#10B981,#059669)',recruiter:'linear-gradient(135deg,#10B981,#059669)'};
      var rl={super_admin:'Super Admin',admin:'Admin',sr_recruiter:'Sr. Recruiter',recruiter:'Recruiter'};
      var rb={super_admin:'b-dark',admin:'b-purple',sr_recruiter:'b-green',recruiter:'b-green'};
      grid.innerHTML = members.map(function(m) {
        var first=m.firstName||(m.name||'').split(' ')[0]||'?', last=m.lastName||(m.name||'').split(' ').slice(1).join(' ')||'';
        var name=(first+' '+last).trim()||m.email||m.id, ini=((first[0]||'')+(last[0]||'')).toUpperCase();
        var role=m.role||'recruiter', grad=rg[role]||'linear-gradient(135deg,#6B7280,#9CA3AF)', label=rl[role]||role, badge=rb[role]||'b-amber';
        return '<div class="team-card"><div class="tc-top"><div class="tc-av" style="background:'+grad+'">'+ini+'</div><div><div class="tc-name">'+name+'</div><div class="tc-role">'+label+'</div></div></div><div style="font-size:11px;color:var(--g5);margin-bottom:10px;">'+(m.email||'')+'</div><div style="margin-bottom:10px;"><span class="badge '+badge+'">'+label+'</span></div><div class="tc-actions"><button class="btn btn-ghost btn-sm">Edit access</button></div></div>';
      }).join('');
    } catch(e) { grid.innerHTML='<div style="padding:32px;text-align:center;color:var(--red);font-size:13px;grid-column:1/-1;">Error: '+e.message+'</div>'; }
  };
 
  // Wire team load into navTo
  var _nt = window.navTo;
  window.navTo = function(id, label) { _nt(id, label); if (id==='team') window.loadTeamFromFirestore(); };
 
  // ── 9. Visibility button sync on opening detail ───────────────────────────
  var _origOpenDetail = window.openOpeningDetail;
  if (_origOpenDetail) {
    window.openOpeningDetail = function(code, title, status, published, recruiter, editMode) {
      _origOpenDetail(code, title, status, published, recruiter, editMode);
      setTimeout(function() {
        var vi=document.getElementById('od-vis-icon'), vl=document.getElementById('od-vis-label'), vb=document.getElementById('od-visibility-btn');
        if(vi) vi.textContent=published?'👁':'🌐';
        if(vl) vl.textContent=published?'Set private':'Publish opening';
        if(vb){ vb.style.borderColor=published?'var(--green)':'var(--g3)'; vb.style.color=published?'var(--green)':'var(--g6)'; }
      },50);
    };
  }
 
})();
