/* ==========================================================================
   drafts.js — ตาราง "รายการร่าง" (ใช้ร่วมกันทั้ง 4 ระบบ: อุบัติเหตุ / โจรกรรม / ชี้แนวเขต / ขออนุญาต)
   ไฟล์นี้เหมือนกันทุกระบบ ต่างกันแค่ค่าที่แต่ละหน้า index.html ส่งเข้า DRAFTS.init({...})

   แนวคิด
     - ร่าง = เรื่องที่เพิ่งเกิด ยังไม่ได้บันทึกเคสเต็ม ใช้ติดตามจนส่งเอกสารถึงแขวง
     - กำหนด = วันเริ่มนับ + 10 วันทำการ (ไม่นับเสาร์-อาทิตย์/วันหยุดนักขัตฤกษ์)
     - ร่างผูกกับเคสผ่าน caseId  เมื่อเคสมีวันส่งแขวง (หรือเรื่องจบ) ร่างปิดเองโดยไม่ต้องกรอกซ้ำ
     - เคสที่บันทึกตรงในฟอร์มโดยไม่มีร่าง ระบบสร้างร่างให้เอง (แจ้งเตือน LINE มาจากตารางร่างที่เดียว)
   ข้อมูลร่าง (คอลเลกชัน drafts): { id, startDate, highway, km, caseId, status:'open'|'cancelled', source, note, createdAt, createdBy }
   ========================================================================== */
(function () {
  'use strict';
  var LIMIT_DAYS = 10, WARN_LEFT = 3;
  // วันหยุดนักขัตฤกษ์สำรอง (ใช้เมื่อยังโหลดรายการจริงจาก Apps Script ไม่ได้) — ตั้งค่า window.DRAFT_HOLIDAY_URL ใน index.html เพื่อดึงรายการจริง
  var HOL_FALLBACK = ['2026-10-13', '2026-10-23', '2026-12-05', '2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01'];
  var HOL_KEY = 'cn_draft_holidays_v1';
  var CFG = null, drafts = [], holSet = null, started = false, pendingId = null, pendingExisting = '', editingDraftId = null, showClosed = false;

  /* ---------- วันที่ / วันทำการ ---------- */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function parse(s) { var a = String(s).slice(0, 10).split('-'); return new Date(+a[0], +a[1] - 1, +a[2]); }
  function loadHolidays() {
    var list = HOL_FALLBACK.slice();
    try { var c = JSON.parse(localStorage.getItem(HOL_KEY) || 'null'); if (c && Array.isArray(c.dates)) list = c.dates; } catch (e) { /* ข้าม */ }
    holSet = {}; list.forEach(function (d) { holSet[String(d).slice(0, 10)] = 1; });
  }
  function fetchHolidays() {
    var url = window.DRAFT_HOLIDAY_URL;
    if (!url || !/^https:\/\/script\.google\.com\/.+\/exec/.test(url)) return;
    fetch(url + (url.indexOf('?') < 0 ? '?' : '&') + 'a=holidays').then(function (r) { return r.json(); }).then(function (j) {
      if (!j || !Array.isArray(j.holidays) || !j.holidays.length) return;
      try { localStorage.setItem(HOL_KEY, JSON.stringify({ dates: j.holidays, at: Date.now() })); } catch (e) { /* ข้าม */ }
      loadHolidays(); render();
    }).catch(function () { /* ใช้ค่าสำรอง */ });
  }
  function isWork(d) { var w = d.getDay(); return w !== 0 && w !== 6 && !holSet[ymd(d)]; }
  function addWork(startStr, n) {
    var d = parse(startStr), c = 0;
    while (c < n) { d.setDate(d.getDate() + 1); if (isWork(d)) c++; }
    return ymd(d);
  }
  // จำนวนวันทำการจาก "วันนี้" ถึง "วันครบกำหนด" (บวก = เหลือ, 0 = วันนี้, ลบ = เลยกำหนด)
  function workLeft(todayStr, dueStr) {
    if (dueStr === todayStr) return 0;
    var a = parse(todayStr), b = parse(dueStr), c = 0, step = a < b ? 1 : -1;
    var d = new Date(a.getTime());
    while (ymd(d) !== ymd(b)) { d.setDate(d.getDate() + step); if (isWork(d)) c += step; if (Math.abs(c) > 400) break; }
    return c;
  }

  /* ---------- ข้อมูล ---------- */
  function esc(s) { return window.escapeHtml ? window.escapeHtml(s) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tdate(s) { return window.formatThaiDate ? window.formatThaiDate(s) : String(s || ''); }
  function toast(m) { if (window.showToast) window.showToast(m); }
  function fmtKm(n) { return window.formatKm ? window.formatKm(n) : String(n); }
  function d10(s) { var m = String(s || '').match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : ''; }
  function caseDocs() { return (window.FBL && FBL.docs) ? FBL.docs(CFG.caseCol) : []; }
  function findCase(id) { var a = caseDocs(); for (var i = 0; i < a.length; i++) if (a[i].__id === id || a[i].id === id) return a[i]; return null; }
  function byId(id) { for (var i = 0; i < drafts.length; i++) if (drafts[i].id === id) return drafts[i]; return null; }
  function newId() { return 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }

  // สถานะของร่างหนึ่งรายการ: { hide, state:'open'|'sent'|'done'|'cancelled', start, due, left, c }
  function viewOf(d, t) {
    if (d.status === 'cancelled') return { state: 'cancelled', start: d.startDate };
    var c = d.caseId ? findCase(d.caseId) : null;
    if (d.caseId && (!c || c.deletedAt)) return { hide: true };
    var start = d10(c ? CFG.startOf(c) : '') || d.startDate;
    if (!start) return { hide: true };
    var sent = c ? d10(CFG.sentOf(c)) : '';
    var done = c ? !!CFG.doneOf(c) : false;
    var due = addWork(start, LIMIT_DAYS);
    var left = workLeft(t, due);
    return { state: sent ? 'sent' : (done ? 'done' : 'open'), start: start, due: due, left: left, c: c, sent: sent };
  }

  /* ---------- หน้าตา ---------- */
  function injectCss() {
    if (document.getElementById('draftCss')) return;
    var s = document.createElement('style'); s.id = 'draftCss';
    s.textContent =
      '#draftCard .dr-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px;margin-bottom:10px}' +
      '#draftCard .dr-sum{display:flex;flex-wrap:wrap;gap:6px;font-size:13px}' +
      '.dr-chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}' +
      '.dr-chip.g{background:#E1F5EE;color:#085041}.dr-chip.y{background:#FAEEDA;color:#633806}.dr-chip.r{background:#FCEBEB;color:#791F1F}.dr-chip.n{background:#EEE;color:#555}' +
      '#draftCard .dr-add{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;padding:10px 12px;border:1px dashed #cfcfcf;border-radius:10px;margin-bottom:12px}' +
      '#draftCard .dr-add .field{margin:0;min-width:130px}' +
      '#draftCard .dr-add .field.grow{flex:1;min-width:150px}' +
      '#draftCard table{width:100%;border-collapse:collapse;font-size:14px}' +
      '#draftCard th{text-align:left;font-weight:600;color:#666;padding:6px 8px;border-bottom:1px solid #e3e3e3;white-space:nowrap}' +
      '#draftCard td{padding:8px;border-bottom:1px solid #f0f0f0;vertical-align:middle}' +
      '#draftCard tr.dr-row{cursor:pointer}#draftCard tr.dr-row:hover{background:#f7fafc}' +
      '#draftCard tr.dr-row.r{background:#fff6f6}#draftCard tr.dr-row.y{background:#fffaf0}' +
      '#draftCard .dr-btn{padding:4px 10px;border-radius:8px;border:1px solid #bbb;background:#fff;cursor:pointer;font:inherit;font-size:13px;white-space:nowrap}' +
      '#draftCard .dr-btn.pri{background:#185FA5;border-color:#185FA5;color:#fff}' +
      '#draftCard .dr-empty{padding:14px;color:#888;text-align:center}' +
      '#draftCard .dr-warn{padding:10px 12px;border-radius:8px;background:#FAEEDA;color:#633806;margin-bottom:10px;font-size:14px}' +
      '#draftCard .dr-note{color:#777;font-size:12px}' +
      '@media(max-width:700px){#draftCard th.hm,#draftCard td.hm{display:none}}';
    document.head.appendChild(s);
  }

  function chip(v) {
    if (v.state === 'cancelled') return '<span class="dr-chip n">ยกเลิกแล้ว</span>';
    if (v.state === 'sent') return '<span class="dr-chip g">ส่งแขวงแล้ว ' + esc(tdate(v.sent)) + '</span>';
    if (v.state === 'done') return '<span class="dr-chip n">เรื่องจบแล้ว</span>';
    if (v.left < 0) return '<span class="dr-chip r">เลยกำหนด ' + (-v.left) + ' วันทำการ</span>';
    if (v.left === 0) return '<span class="dr-chip r">ครบกำหนดวันนี้</span>';
    if (v.left <= WARN_LEFT) return '<span class="dr-chip y">เหลือ ' + v.left + ' วันทำการ</span>';
    return '<span class="dr-chip g">เหลือ ' + v.left + ' วันทำการ</span>';
  }

  function hwOptions(sel) {
    var list = (CFG.highways && CFG.highways()) || [];
    return '<option value="">— เลือก —</option>' + list.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(sel) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
    }).join('');
  }

  function render() {
    var el = document.getElementById('draftPanel');
    if (!el || !CFG) return;
    injectCss();
    // เก็บค่าที่กำลังพิมพ์ในช่องเพิ่มร่างไว้ (มีข้อมูลใหม่จากเครื่องอื่นเข้ามาแล้ววาดตารางใหม่ ค่าที่พิมพ์ค้างต้องไม่หาย)
    var keep = null;
    if (document.getElementById('drDate') && !editingDraftId) keep = { date: document.getElementById('drDate').value, hw: document.getElementById('drHw').value, km: document.getElementById('drKm').value, note: document.getElementById('drNote').value };
    var t = today();
    var rows = [], counts = { open: 0, warn: 0, over: 0 };
    drafts.forEach(function (d) {
      var v = viewOf(d, t); if (v.hide) return;
      var isClosed = v.state !== 'open';
      if (isClosed) {
        // แสดงเฉพาะเมื่อติ๊ก "แสดงที่ปิดแล้ว" (ส่งแล้ว/จบ/ยกเลิก) — จำกัด 30 วันล่าสุดจากวันเริ่มนับ
        if (!showClosed) return;
        if (v.start && workLeft(t, v.start) < -60 && v.state !== 'cancelled') return;
      } else {
        counts.open++;
        if (v.left < 0 || v.left === 0) counts.over++; else if (v.left <= WARN_LEFT) counts.warn++;
      }
      rows.push({ d: d, v: v, closed: isClosed });
    });
    rows.sort(function (a, b) {
      if (a.closed !== b.closed) return a.closed ? 1 : -1;
      var ka = a.closed ? '' : String(a.v.due), kb = b.closed ? '' : String(b.v.due);
      return ka < kb ? -1 : ka > kb ? 1 : (String(a.d.startDate) < String(b.d.startDate) ? 1 : -1);
    });

    var failed = window.FBL && FBL.watchFailed && FBL.watchFailed.drafts;
    var editing = editingDraftId ? byId(editingDraftId) : null;
    var html = '<div class="card" id="draftCard"><div class="section-title"><span class="num">▤</span> รายการร่าง — ติดตามจนส่งเอกสารถึงแขวง</div>';
    if (failed) html += '<div class="dr-warn">ยังอ่านรายการร่างไม่ได้ (' + esc(failed) + ') — ถ้าเพิ่งติดตั้งฟีเจอร์นี้ ให้วาง firestore.rules ใหม่ใน Firebase Console ก่อน</div>';
    html += '<div class="dr-head"><div class="dr-sum">' +
      '<span class="dr-chip n">ค้าง ' + counts.open + '</span>' +
      (counts.warn ? '<span class="dr-chip y">ใกล้ครบ ' + counts.warn + '</span>' : '') +
      (counts.over ? '<span class="dr-chip r">ครบ/เลยกำหนด ' + counts.over + '</span>' : '') +
      '</div><label style="margin-left:auto;font-size:13px;cursor:pointer"><input type="checkbox" id="drShowClosed"' + (showClosed ? ' checked' : '') + '> แสดงที่ปิดแล้ว</label></div>';

    html += '<div class="dr-add">' +
      '<div class="field"><label>' + esc(CFG.startLabel) + ' <span class="req">*</span></label><input type="date" id="drDate" max="' + t + '" value="' + esc(editing ? editing.startDate : t) + '"></div>' +
      '<div class="field"><label>ทล. <span class="req">*</span></label><select id="drHw">' + hwOptions(editing ? editing.highway : '') + '</select></div>' +
      '<div class="field"><label>กม. <span class="req">*</span></label><input type="text" id="drKm" placeholder="เช่น 145+200" value="' + esc(editing ? fmtKm(editing.km) : '') + '" style="width:130px"></div>' +
      '<div class="field grow"><label>หมายเหตุ</label><input type="text" id="drNote" value="' + esc(editing ? (editing.note || '') : '') + '"></div>' +
      '<div><button type="button" class="btn btn-primary" id="drAdd">' + (editing ? 'บันทึกการแก้ไขร่าง' : '＋ เพิ่มร่าง') + '</button>' +
      (editing ? ' <button type="button" class="btn btn-outline" id="drCancelEdit">ยกเลิก</button>' : '') + '</div></div>';

    if (!rows.length) {
      html += '<div class="dr-empty">ยังไม่มีรายการร่างที่ค้างอยู่</div>';
    } else {
      html += '<div style="overflow-x:auto"><table><thead><tr><th>' + esc(CFG.startLabel) + '</th><th>ทล. / กม.</th><th class="hm">ครบกำหนด</th><th>สถานะ</th><th>เคส</th><th></th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var d = r.d, v = r.v, cls = r.closed ? '' : (v.left <= 0 ? 'r' : (v.left <= WARN_LEFT ? 'y' : ''));
        html += '<tr class="dr-row ' + cls + '" data-id="' + esc(d.id) + '">' +
          '<td>' + esc(tdate(v.start)) + '</td>' +
          '<td>ทล.' + esc(d.highway) + ' กม.' + esc(fmtKm(d.km)) + (d.note ? '<div class="dr-note">' + esc(d.note) + '</div>' : '') + '</td>' +
          '<td class="hm">' + (v.due ? esc(tdate(v.due)) : '-') + '</td>' +
          '<td>' + chip(v) + '</td>' +
          '<td>' + (d.caseId ? '<span class="dr-chip g">บันทึกเคสแล้ว</span>' : '<span class="dr-chip n">ยังไม่บันทึกเคส</span>') + '</td>' +
          '<td style="white-space:nowrap">' +
            (d.status === 'cancelled' ? '' :
              (d.caseId ? '<button type="button" class="dr-btn pri" data-act="open">เปิดเคส</button>' : '<button type="button" class="dr-btn pri" data-act="make">บันทึกเคส</button> <button type="button" class="dr-btn" data-act="edit">แก้ไข</button>') +
              (r.closed ? '' : ' <button type="button" class="dr-btn" data-act="cancel">ยกเลิกร่าง</button>')) +
          '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '<div class="dr-note" style="margin-top:8px">กำหนดส่ง = ' + esc(CFG.startLabel) + ' + ' + LIMIT_DAYS + ' วันทำการ · เมื่อกรอก "ส่งเอกสารถึงแขวง" ในเคส ร่างจะปิดเอง · แจ้งเตือน LINE: เหลือ ' + WARN_LEFT + ' วันทำการ และวันครบกำหนด</div></div>';
    el.innerHTML = html;
    if (keep) {
      document.getElementById('drDate').value = keep.date || t; document.getElementById('drHw').value = keep.hw;
      document.getElementById('drKm').value = keep.km; document.getElementById('drNote').value = keep.note;
    }
    bind(el);
  }

  function bind(el) {
    var q = function (id) { return el.querySelector('#' + id); };
    q('drShowClosed').onchange = function () { showClosed = this.checked; render(); };
    q('drAdd').onclick = onAdd;
    if (q('drCancelEdit')) q('drCancelEdit').onclick = function () { editingDraftId = null; render(); };
    el.querySelectorAll('tr.dr-row').forEach(function (tr) {
      var id = tr.getAttribute('data-id');
      tr.onclick = function (ev) { if (ev.target.closest('button')) return; var d = byId(id); if (d && d.status !== 'cancelled') (d.caseId ? openCase(d) : makeCase(d)); };
      tr.querySelectorAll('button[data-act]').forEach(function (b) {
        b.onclick = function () {
          var d = byId(id); if (!d) return; var a = b.getAttribute('data-act');
          if (a === 'make') makeCase(d); else if (a === 'open') openCase(d);
          else if (a === 'edit') { editingDraftId = id; render(); var x = document.getElementById('drDate'); if (x) x.scrollIntoView({ block: 'center' }); }
          else if (a === 'cancel') cancelDraft(d);
        };
      });
    });
  }

  /* ---------- การกระทำ ---------- */
  function who() { return (window.FBL && FBL.user && FBL.user.name) || ''; }
  async function save(d) {
    try { await FBL.saveDraft(d); return true; }
    catch (e) { console.error('draft save failed', e); toast('บันทึกร่างไม่สำเร็จ: ' + (FBL.errorText ? FBL.errorText(e) : (e && e.message))); return false; }
  }
  async function onAdd() {
    var date = document.getElementById('drDate').value, hw = document.getElementById('drHw').value;
    var km = CFG.parseKm(document.getElementById('drKm').value), note = document.getElementById('drNote').value.trim();
    if (!date) return toast('กรุณากรอก' + CFG.startLabel);
    if (date > today()) return toast(CFG.startLabel + 'เป็นวันในอนาคตไม่ได้');
    if (!hw) return toast('กรุณาเลือกทางหลวง (ทล.)');
    if (km === null || km === undefined) return toast('กรุณากรอก กม. ให้ถูกรูปแบบ เช่น 145+200');
    if (editingDraftId) {
      var ok = await save({ id: editingDraftId, startDate: date, highway: String(hw), km: km, note: note });
      if (ok) { editingDraftId = null; toast('แก้ไขร่างแล้ว'); }
      return;
    }
    var dup = drafts.some(function (d) { return d.status !== 'cancelled' && d.startDate === date && String(d.highway) === String(hw) && Number(d.km) === km; }) ||
      caseDocs().some(function (c) { return !c.deletedAt && d10(CFG.startOf(c)) === date && String(c.highway) === String(hw) && Number(c.km) === km; });
    if (dup && !window.confirm('มีร่างหรือเคสวันที่ ทล. และ กม. เดียวกันอยู่แล้ว ต้องการเพิ่มซ้ำหรือไม่')) return;
    var rec = { id: newId(), startDate: date, highway: String(hw), km: km, caseId: '', status: 'open', source: 'web', note: note, createdAt: new Date().toISOString(), createdBy: who() };
    if (await save(rec)) toast('เพิ่มร่างแล้ว ครบกำหนด ' + tdate(addWork(date, LIMIT_DAYS)));
  }
  async function cancelDraft(d) {
    if (!window.confirm('ยกเลิกร่าง ทล.' + d.highway + ' กม.' + fmtKm(d.km) + ' ?\n(ร่างจะไม่ถูกติดตามและไม่แจ้งเตือนอีก)')) return;
    if (await save({ id: d.id, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: who() })) toast('ยกเลิกร่างแล้ว');
  }
  function makeCase(d) {
    // openNew ล้างฟอร์มก่อน (ล้างค่าค้างด้วย) จึงตั้งค่าร่างที่รอผูกหลังเรียก · ถ้าหน้านั้นเลือกเปิดเรื่องเดิมแทน (ชี้แนวเขต) จะคืน { existingId }
    var r = CFG.openNew({ startDate: d.startDate, highway: d.highway, km: d.km, draftId: d.id });
    pendingId = d.id;
    pendingExisting = (r && r.existingId) ? String(r.existingId) : '';
  }
  function openCase(d) { pendingId = null; CFG.openCase(d.caseId); }

  /* ---------- เชื่อมกับการบันทึกเคส ---------- */
  // เรียกหลังบันทึกเคสสำเร็จ (ก่อน clearForm) — ผูกร่าง / สร้างร่างอัตโนมัติ / ซิงก์ วันที่-ทล.-กม.
  async function afterCaseSaved(rec, isNew) {
    if (!CFG) return;
    try {
      var start = d10(CFG.startOf(rec)), hw = String(rec.highway == null ? '' : rec.highway), km = Number(rec.km);
      var p = pendingId ? byId(pendingId) : null, pe = pendingExisting; pendingId = null; pendingExisting = '';
      if (p && !p.caseId && (isNew || pe === String(rec.id))) { await FBL.saveDraft({ id: p.id, caseId: rec.id, startDate: start || p.startDate, highway: hw, km: km }); return; }
      var linked = null;
      drafts.forEach(function (d) { if (d.caseId === rec.id && d.status !== 'cancelled') linked = d; });
      if (linked) {
        if (linked.startDate !== start || String(linked.highway) !== hw || Number(linked.km) !== km)
          await FBL.saveDraft({ id: linked.id, startDate: start || linked.startDate, highway: hw, km: km });
        return;
      }
      if (!start) return;
      // เรื่องที่ส่งแขวงแล้ว/จบแล้ว ไม่ต้องมีร่าง · เรื่องเก่ากว่า ~1 เดือนที่แค่เปิดมาแก้ ก็ไม่สร้างให้ (กันร่างค้างล้นจากข้อมูลย้อนหลัง)
      if (d10(CFG.sentOf(rec)) || CFG.doneOf(rec)) return;
      if (!isNew && workLeft(today(), start) < -22) return;
      var match = null;
      drafts.forEach(function (d) { if (!d.caseId && d.status !== 'cancelled' && d.startDate === start && String(d.highway) === hw && Number(d.km) === km) match = d; });
      if (match) { await FBL.saveDraft({ id: match.id, caseId: rec.id }); return; }
      await FBL.saveDraft({ id: 'a-' + rec.id, startDate: start, highway: hw, km: km, caseId: rec.id, status: 'open', source: 'auto', note: '', createdAt: new Date().toISOString(), createdBy: who() });
    } catch (e) { console.error('draft link failed', e); toast('บันทึกเคสแล้ว แต่ผูกกับรายการร่างไม่สำเร็จ'); }
  }

  /* ---------- เริ่มทำงาน ---------- */
  function start() {
    if (!CFG || started || !window.FBL || !FBL.watch) return;
    started = true;
    loadHolidays(); fetchHolidays();
    FBL.watch('drafts', function (col, docs) { drafts = docs.map(norm); render(); }).then(function (docs) { drafts = docs.map(norm); render(); });
  }
  function norm(d) {
    return { id: d.id || d.__id, startDate: d10(d.startDate), highway: String(d.highway == null ? '' : d.highway), km: Number(d.km),
      caseId: d.caseId || '', status: d.status === 'cancelled' ? 'cancelled' : 'open', source: d.source || '', note: d.note || '', createdAt: d.createdAt || '', createdBy: d.createdBy || '' };
  }

  window.DRAFTS = {
    init: function (cfg) { CFG = cfg; loadHolidays(); },
    start: start,
    render: render,
    afterCaseSaved: afterCaseSaved,
    clearPending: function () { pendingId = null; pendingExisting = ''; },
    pendingId: function () { return pendingId; },
    addWorkdays: addWork,
    workLeft: workLeft
  };
})();
