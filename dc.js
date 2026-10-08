// 미래를 여는 디지털 시민 — 공용 라이브러리 (session.js 다음에 로드)
//
// 데이터 경로: years/{year}/dcitizen/u{UNIT}/{key}/{ban}/{studentId}
//   개인 응답 레코드 = { id, name, ban, num, answers:{fieldId:value}, updatedAt }
//   좋아요          = {key}__likes/{ban}/{ownerId}/{likerId} = { name, ts }
//   댓글            = {key}__comments/{ban}/{ownerId}/{pushId} = { id, name, text, ts }
//
// 페이지 쪽 사용 예:
//   <script src="session.js"></script><script src="dc.js"></script>
//   <script>
//   DC.start({ title: '1차시 · 상황 이해하기' }).then(() => {
//     DC.form({ mount: '#f1', key: 's1/situation', fields: [...] });
//     DC.board({ mount: '#b1', key: 's1/situation', fields: [...] });
//   });
//   </script>
(function () {
  var DB_URL = 'https://gwangsu-on-default-rtdb.firebaseio.com';
  var UNIT = 'u2';
  var TEACHER_BAN = 'T'; // 교사 계정이 테스트로 쓴 응답은 'T' 반으로 저장

  var DC = window.DC = { DB_URL: DB_URL, UNIT: UNIT, cfg: null, student: null };

  // ---------- 유틸 ----------
  DC.esc = function (s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  DC.escAttr = function (s) { return DC.esc(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); };
  DC.nl2br = function (s) { return DC.esc(s).replace(/\n/g, '<br>'); };
  DC.fmtTime = function (ts) {
    if (!ts) return '';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
  };

  // ---------- Firebase REST ----------
  // p에 '?shallow=true' 같은 쿼리가 붙어 있으면 .json은 쿼리 앞에 붙여야 한다.
  DC.url = function (p) {
    var q = '', i = p.indexOf('?');
    if (i >= 0) { q = p.slice(i); p = p.slice(0, i); }
    return DB_URL + '/years/' + DC.cfg.year + '/dcitizen/' + UNIT + '/' + p + '.json' + q;
  };
  // 체험 모드(로그인 없이 체험하기): 입장할 때 고른 반 친구들의 실제 글은 읽어서 보여 주지만,
  // 체험하는 사람의 입력·좋아요·댓글은 서버에 보내지 않고 이 탭의 메모리에만 담는다(새로고침하면 사라짐).
  DC.isGuest = function () { return !!(DC.student && DC.student.isGuest); };
  // 내 답을 저장하기 전에도 반 친구 글·집계를 볼 수 있는 사람(교사, 체험 모드)
  DC.canPeek = function () { return !!(DC.student && (DC.student.isTeacher || DC.student.isGuest)); };
  var mem = {};
  function memSplit(p) { return p.split('?')[0].split('/').filter(Boolean); }
  function memGet(p) {
    var shallow = p.indexOf('shallow=true') >= 0, cur = mem;
    memSplit(p).forEach(function (k) { cur = (cur && typeof cur === 'object') ? cur[k] : undefined; });
    if (cur === undefined) return null;
    cur = JSON.parse(JSON.stringify(cur));
    if (shallow && cur && typeof cur === 'object') Object.keys(cur).forEach(function (k) { cur[k] = true; });
    return cur;
  }
  function memSet(p, v, merge) {
    var ks = memSplit(p), last = ks.pop(), cur = mem;
    ks.forEach(function (k) { if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {}; cur = cur[k]; });
    v = v === null || v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    if (v === undefined) delete cur[last];
    else if (merge && cur[last] && typeof cur[last] === 'object') Object.keys(v).forEach(function (k) { cur[last][k] = v[k]; });
    else cur[last] = v;
  }
  var memSeq = 0;
  function guestOp(fn) { return new Promise(function (res) { setTimeout(function () { res(fn()); }, 120); }); }

  function overlay(base, top) {
    if (top === null || top === undefined) return base;
    if (base === null || base === undefined || typeof base !== 'object' || typeof top !== 'object') return top;
    Object.keys(top).forEach(function (k) { base[k] = overlay(base[k], top[k]); });
    return base;
  }
  function realGet(p) {
    return fetch(DC.url(p)).then(function (r) { if (!r.ok) throw new Error('불러오기 실패'); return r.json(); });
  }
  // 체험 모드의 읽기 = 실제 서버 데이터(선택한 반 친구들 글) 위에 내 임시 입력을 덮어씌운 것
  DC.get = function (p) {
    if (DC.isGuest()) return realGet(p).catch(function () { return null; }).then(function (real) { return overlay(real, memGet(p)); });
    return realGet(p);
  };
  DC.put = function (p, v) {
    if (DC.isGuest()) return guestOp(function () { memSet(p, v); return v; });
    return fetch(DC.url(p), { method: 'PUT', body: JSON.stringify(v) }).then(function (r) { if (!r.ok) throw new Error('저장 실패'); return r.json(); });
  };
  DC.patch = function (p, v) {
    if (DC.isGuest()) return guestOp(function () { memSet(p, v, true); return v; });
    return fetch(DC.url(p), { method: 'PATCH', body: JSON.stringify(v) }).then(function (r) { if (!r.ok) throw new Error('저장 실패'); return r.json(); });
  };
  DC.post = function (p, v) {
    if (DC.isGuest()) return guestOp(function () { var k = 'g' + Date.now() + (++memSeq); memSet(p + '/' + k, v); return { name: k }; });
    return fetch(DC.url(p), { method: 'POST', body: JSON.stringify(v) }).then(function (r) { if (!r.ok) throw new Error('저장 실패'); return r.json(); });
  };
  DC.del = function (p) {
    if (DC.isGuest()) return guestOp(function () { memSet(p, null); return null; });
    return fetch(DC.url(p), { method: 'DELETE' });
  };

  // 반 키 = '학년-반' (예: '1-3'). 학년이 달라도 반 번호가 겹치므로 반드시 학년을 포함한다.
  DC.myBan = function () { if (DC.student.isGuest) return DC.student.grade + '-' + DC.student.ban; return DC.student.isTeacher ? TEACHER_BAN : (DC.student.grade + '-' + DC.student.ban); };
  DC.banLabel = function (b) { if (b === TEACHER_BAN) return '교사 테스트'; var p = String(b).split('-'); return p.length === 2 ? p[0] + '학년 ' + p[1] + '반' : b + '반'; };

  // ---------- 페이지 시작 ----------
  // opts: { title, subtitle, needLogin(default true) }
  DC.start = function (opts) {
    opts = opts || {};
    if (opts.needLogin !== false) {
      DC.student = window.requireSrLogin();
      if (!DC.student) return new Promise(function () {});
      if (DC.student.isGuest && !DC.student.grade) { // 반 선택 기능 이전의 체험 계정 → 다시 반을 고르게 한다
        window.clearSrStudent(); location.href = 'index.html'; return new Promise(function () {});
      }
    }
    return fetch(DB_URL + '/config/current.json').then(function (r) { return r.json(); }).then(function (cfg) {
      DC.cfg = cfg || { year: new Date().getFullYear(), sem: 1 };
      var head = document.getElementById('dc-head');
      if (head) {
        head.innerHTML =
          '<div class="header"><h1>' + DC.esc(opts.title || '미래를 여는 디지털 시민') + '</h1>' +
          (opts.subtitle ? '<p>' + DC.esc(opts.subtitle) + '</p>' : '') + '</div>' +
          (DC.student ? '<div class="who-banner"><span>✓ ' + DC.esc(window.srWhoLabel(DC.student)) + '</span>' +
            '<div class="links"><a href="index.html">← 활동 목록</a></div></div>' : '') +
          (DC.isGuest() ? '<div class="dc-guest-bar">🧪 <b>체험 모드 · ' + DC.esc(DC.banLabel(DC.myBan())) + '</b> — 친구들의 글은 볼 수 있지만, 내가 쓴 글·좋아요·댓글은 <b>서버에 저장되지 않아요.</b> 새로고침하거나 페이지를 나가면 사라져요.</div>' : '');
      }
      return DC.cfg;
    });
  };

  // ---------- 입력 필드 렌더 ----------
  // field: { id, label, type, hint, placeholder, options:[..], example, rows, prefix, suffix, answer(ox 정답) }
  // type: text | textarea | number | radio | checks | stars | ox | rate3(잘함/보통/노력) | info(입력 없음, 안내문)
  DC.RATE3 = ['잘함', '보통', '노력'];

  function fieldHtml(formId, f, val) {
    var name = formId + '__' + f.id;
    var h = '';
    if (f.type === 'info') return '<div class="dc-info">' + (f.html || DC.nl2br(f.label)) + '</div>';
    h += '<label class="field-label">' + DC.esc(f.label) + '</label>';
    if (f.hint) h += '<div class="dc-hint">' + DC.nl2br(f.hint) + '</div>';
    if (f.example) h += '<div class="dc-example">예) ' + DC.nl2br(f.example) + '</div>';
    var ph = f.placeholder ? ' placeholder="' + DC.escAttr(f.placeholder) + '"' : '';
    var data = ' data-form="' + formId + '" data-fid="' + DC.escAttr(f.id) + '"';
    if (f.type === 'textarea') {
      h += wrapAffix(f, '<textarea id="' + name + '"' + data + ' rows="' + (f.rows || 3) + '"' + ph + '>' + DC.esc(val || '') + '</textarea>');
    } else if (f.type === 'text' || f.type === 'number') {
      h += wrapAffix(f, '<input type="' + (f.type === 'number' ? 'number' : 'text') + '" id="' + name + '"' + data + ph + ' value="' + DC.escAttr(val === undefined || val === null ? '' : val) + '">');
    } else if (f.type === 'radio' || f.type === 'ox' || f.type === 'rate3' || f.type === 'stars') {
      var opts = f.type === 'ox' ? ['O', 'X'] : f.type === 'rate3' ? DC.RATE3 : f.type === 'stars' ? ['1', '2', '3'] : f.options;
      h += '<div class="dc-choices' + (f.type === 'stars' ? ' stars' : '') + '">';
      opts.forEach(function (o, i) {
        var lab = f.type === 'stars' ? '★'.repeat(i + 1) + '☆'.repeat(opts.length - i - 1) : o;
        h += '<label class="dc-choice"><input type="radio" name="' + name + '"' + data + ' value="' + DC.escAttr(o) + '"' + (String(val) === String(o) ? ' checked' : '') + '><span>' + DC.esc(lab) + '</span></label>';
      });
      h += '</div>';
    } else if (f.type === 'checks') {
      var arr = Array.isArray(val) ? val : [];
      h += '<div class="dc-choices col">';
      f.options.forEach(function (o) {
        h += '<label class="dc-choice"><input type="checkbox" name="' + name + '"' + data + ' value="' + DC.escAttr(o) + '"' + (arr.indexOf(o) >= 0 ? ' checked' : '') + '><span>' + DC.esc(o) + '</span></label>';
      });
      h += '</div>';
    }
    return h;
  }
  function wrapAffix(f, inner) {
    if (!f.prefix && !f.suffix) return inner;
    return '<div class="dc-affix">' + (f.prefix ? '<span>' + DC.esc(f.prefix) + '</span>' : '') + inner + (f.suffix ? '<span>' + DC.esc(f.suffix) + '</span>' : '') + '</div>';
  }
  function readField(formId, f, root) {
    var name = formId + '__' + f.id;
    if (f.type === 'checks') {
      return Array.prototype.map.call(root.querySelectorAll('input[name="' + name + '"]:checked'), function (e) { return e.value; });
    }
    if (f.type === 'radio' || f.type === 'ox' || f.type === 'rate3' || f.type === 'stars') {
      var c = root.querySelector('input[name="' + name + '"]:checked');
      return c ? c.value : '';
    }
    var el = root.querySelector('#' + CSS.escape(name));
    return el ? el.value.trim() : '';
  }
  DC.isEmpty = function (v) { return v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length); };
  DC.answerText = function (f, v) {
    if (DC.isEmpty(v)) return '';
    if (f.type === 'stars') return '★'.repeat(+v) + '☆'.repeat(3 - v);
    if (Array.isArray(v)) return v.join(', ');
    return String(v) + (f.suffix ? f.suffix : '');
  };

  // ---------- 개인 응답 폼 ----------
  // opts: { mount, key, fields, title, hint, saveLabel, groups:[{title, fields:[...]}] (fields 대신 사용 가능),
  //         onLoad(rec), onSaved(rec), required:[fieldId...] , showSaved(default true) }
  // 폼은 폴링하지 않는다(처음 1회 로드 + 저장 시 갱신). 그래서 입력이 지워질 일이 없다.
  var formSeq = 0;
  DC.allFields = function (opts) {
    if (opts.fields) return opts.fields;
    var out = [];
    (opts.groups || []).forEach(function (g) { out = out.concat(g.fields); });
    return out;
  };
  DC.form = function (opts) {
    var root = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    var formId = 'f' + (++formSeq);
    var fields = DC.allFields(opts);
    var path = opts.key + '/' + DC.myBan() + '/' + DC.student.id;
    var api = { record: null, el: root };

    root.innerHTML = '<div class="loading-state">불러오는 중...</div>';
    DC.get(path).then(function (rec) {
      api.record = rec;
      var ans = (rec && rec.answers) || {};
      var body = '';
      if (opts.groups) {
        opts.groups.forEach(function (g) {
          body += '<div class="dc-group">' + (g.title ? '<div class="dc-group-title">' + DC.esc(g.title) + '</div>' : '') +
            g.fields.map(function (f) { return fieldHtml(formId, f, ans[f.id]); }).join('') + '</div>';
        });
      } else {
        body = fields.map(function (f) { return fieldHtml(formId, f, ans[f.id]); }).join('');
      }
      root.innerHTML = '<div class="card">' +
        (opts.title ? '<h2>' + DC.esc(opts.title) + '</h2>' : '') +
        (opts.hint ? '<p class="hint">' + DC.nl2br(opts.hint) + '</p>' : '') +
        body +
        '<div class="error-msg" id="' + formId + '_err"></div>' +
        '<div class="ok-msg" id="' + formId + '_ok"></div>' +
        '<button class="btn" id="' + formId + '_btn">' + DC.esc(opts.saveLabel || '💾 저장하기') + '</button>' +
        (opts.showSaved === false ? '' : '<div class="dc-saved" id="' + formId + '_saved"></div>') +
        '</div>';
      renderSaved();
      document.getElementById(formId + '_btn').onclick = save;
      if (opts.onLoad) opts.onLoad(rec, api);
    }).catch(function (e) { root.innerHTML = '<div class="error-msg show">' + DC.esc(e.message) + '</div>'; });

    function renderSaved() {
      var box = document.getElementById(formId + '_saved');
      if (!box) return;
      var rec = api.record;
      if (!rec || !rec.answers) { box.innerHTML = '<div class="dc-saved-title">' + (DC.isGuest() ? '🧪 체험 모드 (저장 안 됨)' : '💾 서버에 저장된 내용') + '</div><div class="dc-muted">' + (DC.isGuest() ? '버튼을 누르면 결과를 이 화면에서만 확인할 수 있어요.' : '아직 저장한 내용이 없어요.') + '</div>'; return; }
      var rows = fields.filter(function (f) { return f.type !== 'info' && !DC.isEmpty(rec.answers[f.id]); }).map(function (f) {
        return '<div class="dc-saved-row"><b>' + DC.esc(f.short || f.label) + '</b><div>' + DC.nl2br(DC.answerText(f, rec.answers[f.id])) + '</div></div>';
      }).join('');
      box.innerHTML = '<div class="dc-saved-title">' + (DC.isGuest() ? '🧪 체험 모드 임시 내용 <span class="dc-muted">(저장 안 됨)</span>' : '💾 서버에 저장된 내용 <span class="dc-muted">(' + DC.fmtTime(rec.updatedAt) + ')</span>') + '</div>' + rows;
    }
    api.values = function () {
      var ans = {};
      fields.forEach(function (f) { if (f.type !== 'info') ans[f.id] = readField(formId, f, root); });
      return ans;
    };
    function save() {
      var err = document.getElementById(formId + '_err'), ok = document.getElementById(formId + '_ok');
      err.classList.remove('show'); ok.classList.remove('show');
      var ans = api.values();
      var missing = (opts.required || []).filter(function (id) { return DC.isEmpty(ans[id]); });
      if (missing.length) {
        var labs = missing.map(function (id) { var f = fields.filter(function (x) { return x.id === id; })[0]; return f ? (f.short || f.label) : id; });
        err.textContent = '아직 비어 있는 칸이 있어요: ' + labs.join(', ');
        err.classList.add('show'); return;
      }
      if (opts.validate) { var msg = opts.validate(ans); if (msg) { err.textContent = msg; err.classList.add('show'); return; } }
      var btn = document.getElementById(formId + '_btn');
      btn.disabled = true; btn.textContent = '저장 중...';
      var s = DC.student;
      var rec = { id: s.id, name: s.name, ban: DC.myBan(), num: s.num || 0, answers: ans, updatedAt: Date.now() };
      DC.put(path, rec).then(function () {
        api.record = rec;
        renderSaved();
        ok.textContent = DC.isGuest() ? '🧪 체험 모드라 서버에는 저장되지 않았어요. (이 화면에서만 임시로 보여요)' : '저장되었어요! (' + DC.fmtTime(rec.updatedAt) + ')';
        ok.classList.add('show');
        if (opts.onSaved) opts.onSaved(rec, api);
        document.dispatchEvent(new CustomEvent('dc-saved', { detail: { key: opts.key, record: rec } }));
      }).catch(function (e) {
        err.textContent = e.message + ' — 인터넷 연결을 확인하고 다시 눌러 주세요.'; err.classList.add('show');
      }).then(function () { btn.disabled = false; btn.textContent = opts.saveLabel || '💾 저장하기'; });
    }
    return api;
  };

  // ---------- 우리 반 게시판 (다른 친구 응답 보기 + 좋아요 + 댓글) ----------
  // opts: { mount, key, fields (보여줄 필드), title, hint, pollMs(8000), likes(true), comments(true),
  //         requireOwn(true: 내가 먼저 저장해야 친구 글 공개), cardHtml(rec)→html (선택, 직접 카드 본문 그리기),
  //         sort('likes'|'recent'), extraTop(records)→html (선택, 목록 위 요약/차트), commentPlaceholder }
  // 댓글 입력창이 있는 영역을 폴링으로 다시 그리므로 drafts 캐시로 입력값·포커스를 보존한다.
  DC.board = function (opts) {
    var root = typeof opts.mount === 'string' ? document.querySelector(opts.mount) : opts.mount;
    var bid = 'b' + (++formSeq);
    var ban = DC.myBan();
    var state = { recs: {}, likes: {}, comments: {}, sort: opts.sort || 'recent', viewBan: ban, bans: null };
    var drafts = {};
    var useLikes = opts.likes !== false, useComments = opts.comments !== false;
    var isT = DC.student.isTeacher;

    root.innerHTML = '<div class="dc-board">' +
      (opts.title ? '<div class="dc-board-title">' + DC.esc(opts.title) + '</div>' : '') +
      (opts.hint ? '<p class="hint">' + DC.nl2br(opts.hint) + '</p>' : '') +
      (isT ? '<select class="dc-ban-select" id="' + bid + '_ban"></select>' : '') +
      '<div class="sort-row"><button class="sort-btn" data-s="recent">최신순</button>' +
      (useLikes ? '<button class="sort-btn" data-s="likes">좋아요순</button>' : '') + '</div>' +
      '<div id="' + bid + '_top"></div><div id="' + bid + '_list"><div class="loading-state">불러오는 중...</div></div></div>';
    root.querySelectorAll('.sort-btn').forEach(function (b) {
      b.onclick = function () { state.sort = b.dataset.s; paint(); };
    });
    if (isT) {
      DC.get(opts.key + '?shallow=true').catch(function () { return null; }).then(function (d) {
        var bans = Object.keys(d || {}).sort();
        if (bans.indexOf(ban) < 0) bans.unshift(ban);
        var sel = document.getElementById(bid + '_ban');
        sel.innerHTML = bans.map(function (b) { return '<option value="' + b + '">' + DC.banLabel(b) + '</option>'; }).join('');
        sel.value = state.viewBan;
        sel.onchange = function () { state.viewBan = sel.value; load(); };
      });
    }

    function load() {
      var b = state.viewBan;
      return Promise.all([
        DC.get(opts.key + '/' + b),
        useLikes ? DC.get(opts.key + '__likes/' + b) : null,
        useComments ? DC.get(opts.key + '__comments/' + b) : null,
      ]).then(function (r) {
        state.recs = r[0] || {}; state.likes = r[1] || {}; state.comments = r[2] || {};
        paint();
      }).catch(function () {});
    }

    function capture() {
      root.querySelectorAll('input[data-cdraft]').forEach(function (el) { drafts[el.dataset.cdraft] = el.value; });
    }

    function paint() {
      capture();
      var ae = document.activeElement, focusKey = null, selS = 0, selE = 0;
      if (ae && ae.dataset && ae.dataset.cdraft && root.contains(ae)) { focusKey = ae.dataset.cdraft; selS = ae.selectionStart; selE = ae.selectionEnd; }
      root.querySelectorAll('.sort-btn').forEach(function (b) { b.classList.toggle('active', b.dataset.s === state.sort); });

      var mine = state.recs[DC.student.id];
      var list = Object.keys(state.recs).map(function (k) { return state.recs[k]; }).filter(function (r) { return r && r.answers; });
      var top = document.getElementById(bid + '_top');
      top.innerHTML = opts.extraTop ? opts.extraTop(list) : '';
      var listEl = document.getElementById(bid + '_list');
      if (opts.requireOwn !== false && !mine && !DC.canPeek()) {
        listEl.innerHTML = '<div class="dc-locked">🔒 내 답을 먼저 저장하면 우리 반 친구들(' + list.length + '명)의 생각을 볼 수 있어요.</div>';
        return;
      }
      if (!list.length) { listEl.innerHTML = '<div class="empty-state">아직 올라온 글이 없어요.</div>'; return; }
      var likeCount = function (r) { return Object.keys(state.likes[r.id] || {}).length; };
      list.sort(function (a, b) {
        if (state.sort === 'likes') return likeCount(b) - likeCount(a) || (b.updatedAt - a.updatedAt);
        return b.updatedAt - a.updatedAt;
      });
      listEl.innerHTML = list.map(function (r) {
        var isMe = r.id === DC.student.id;
        var body = opts.cardHtml ? opts.cardHtml(r) : (opts.fields || []).filter(function (f) { return !DC.isEmpty(r.answers[f.id]); }).map(function (f) {
          return '<div class="dc-post-row"><b>' + DC.esc(f.short || f.label) + '</b><div>' + DC.nl2br(DC.answerText(f, r.answers[f.id])) + '</div></div>';
        }).join('');
        var lk = state.likes[r.id] || {}, liked = !!lk[DC.student.id];
        var likeNames = Object.keys(lk).map(function (k) { return lk[k].name; }).join(', ');
        var cm = state.comments[r.id] || {};
        var cmHtml = Object.keys(cm).sort(function (a, b) { return cm[a].ts - cm[b].ts; }).map(function (ck) {
          var c = cm[ck];
          var canDel = c.id === DC.student.id || isT;
          return '<div class="comment-row"><span class="comment-text"><b>' + DC.esc(c.name) + '</b> ' + DC.esc(c.text) + '</span>' +
            (canDel ? '<button class="comment-del-btn" data-owner="' + DC.escAttr(r.id) + '" data-ck="' + DC.escAttr(ck) + '">삭제</button>' : '') + '</div>';
        }).join('');
        var dk = 'c_' + r.id;
        return '<div class="post-card' + (isMe ? ' mine' : '') + '">' +
          '<div class="post-author">' + (r.num ? r.num + '번 ' : '') + DC.esc(r.name) + (isMe ? ' <span class="me-tag">나</span>' : '') + ' · ' + DC.fmtTime(r.updatedAt) + '</div>' +
          body +
          (useLikes ? '<div class="post-actions"><button class="like-btn' + (liked ? ' liked' : '') + '" data-like="' + DC.escAttr(r.id) + '">' + (liked ? '❤️' : '🤍') + ' ' + Object.keys(lk).length + '</button><span class="like-names">' + DC.esc(likeNames) + '</span></div>' : '') +
          (useComments ? '<div class="comment-list">' + cmHtml + '</div>' +
            '<div class="comment-input-row"><input type="text" maxlength="200" placeholder="' + DC.escAttr(opts.commentPlaceholder || '친구에게 한마디 (구체적으로 칭찬하거나 질문해요)') + '" data-cdraft="' + DC.escAttr(dk) + '" value="' + DC.escAttr(drafts[dk] || '') + '"><button data-cmt="' + DC.escAttr(r.id) + '">등록</button></div>' : '') +
          '</div>';
      }).join('');

      if (focusKey) {
        var el = root.querySelector('input[data-cdraft="' + CSS.escape(focusKey) + '"]');
        if (el) { el.focus(); try { el.setSelectionRange(selS, selE); } catch (e) {} }
      }
    }

    root.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      var b = state.viewBan;
      if (t.dataset.like) {
        var owner = t.dataset.like, p = opts.key + '__likes/' + b + '/' + owner + '/' + DC.student.id;
        var liked = state.likes[owner] && state.likes[owner][DC.student.id];
        t.disabled = true;
        (liked ? DC.del(p) : DC.put(p, { name: DC.student.name, ts: Date.now() })).then(load);
      } else if (t.dataset.cmt) {
        var ow = t.dataset.cmt, dk = 'c_' + ow;
        var input = root.querySelector('input[data-cdraft="' + CSS.escape(dk) + '"]');
        var text = (input.value || '').trim();
        if (!text) return;
        t.disabled = true;
        DC.post(opts.key + '__comments/' + b + '/' + ow, { id: DC.student.id, name: DC.student.name, text: text, ts: Date.now() }).then(function () {
          delete drafts[dk]; input.value = ''; return load();
        });
      } else if (t.dataset.ck) {
        if (!confirm('댓글을 삭제할까요?')) return;
        DC.del(opts.key + '__comments/' + b + '/' + t.dataset.owner + '/' + t.dataset.ck).then(load);
      }
    });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.dataset && e.target.dataset.cdraft && !e.isComposing) {
        e.preventDefault();
        var btn = e.target.parentNode.querySelector('button[data-cmt]'); if (btn) btn.click();
      }
    });
    document.addEventListener('dc-saved', function (e) { if (e.detail.key === opts.key) load(); });

    load();
    setInterval(function () { if (!document.hidden) load(); }, opts.pollMs || 8000);
    return { reload: load, state: state };
  };

  // ---------- 집계 / 막대 차트 (HTML 가로 막대 — SVG 잘림 문제 없음) ----------
  // DC.tally(records, fieldId, options?) → [{label, value}]  (checks 배열도 처리)
  DC.tally = function (records, fid, options) {
    var counts = {};
    (options || []).forEach(function (o) { counts[o] = 0; });
    records.forEach(function (r) {
      var v = r.answers && r.answers[fid];
      if (DC.isEmpty(v)) return;
      (Array.isArray(v) ? v : [v]).forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
    });
    return Object.keys(counts).map(function (k) { return { label: k, value: counts[k] }; });
  };
  // items: [{label, value, highlight?}], opts: { title, unit('명'), max(막대 100% 기준값, 생략 시 최댓값) }
  DC.barsHtml = function (items, opts) {
    opts = opts || {};
    var max = opts.max || Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    var total = items.reduce(function (s, i) { return s + i.value; }, 0);
    return '<div class="dc-bars">' + (opts.title ? '<div class="dc-bars-title">' + DC.esc(opts.title) + '</div>' : '') +
      items.map(function (i) {
        var pct = Math.round(i.value / max * 100);
        return '<div class="dc-bar-row' + (i.highlight ? ' hl' : '') + '"><div class="dc-bar-label">' + DC.esc(i.label) + '</div>' +
          '<div class="dc-bar-track"><div class="dc-bar-fill" style="width:' + pct + '%"></div></div>' +
          '<div class="dc-bar-val">' + i.value + (opts.unit === undefined ? '명' : opts.unit) + '</div></div>';
      }).join('') + (opts.showTotal ? '<div class="dc-muted" style="text-align:right">응답 ' + total + '</div>' : '') + '</div>';
  };

  // 클립보드 복사 버튼 헬퍼
  DC.copy = function (text, btn) {
    var done = function () { if (btn) { var t = btn.textContent; btn.textContent = '복사됨 ✓'; setTimeout(function () { btn.textContent = t; }, 1500); } };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); done(); }
  };
})();
