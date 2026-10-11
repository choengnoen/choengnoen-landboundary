/* ==========================================================================
   drafts.js — ตาราง "รายการร่าง" (ใช้ร่วมกันทั้ง 4 ระบบ: อุบัติเหตุ / โจรกรรม / ชี้แนวเขต / ขออนุญาต)
   ไฟล์นี้เหมือนกันทุกระบบ ต่างกันแค่ค่าที่แต่ละหน้า index.html ส่งเข้า DRAFTS.init({...})

   แนวคิด
     - ร่าง = เรื่องที่เพิ่งเกิด ยังไม่ได้บันทึกเคสเต็ม ใช้ติดตามจนส่งเอกสารถึงแขวง
     - กำหนด = วันเริ่มนับ + 10 วันทำการ (ไม่นับเสาร์-อาทิตย์/วันหยุดนักขัตฤกษ์)
     - ร่างผูกกับเคสผ่าน caseId  เมื่อเคสมีวันส่งแขวง (หรือเรื่องจบ) ร่างปิดเองโดยไม่ต้องกรอกซ้ำ
     - เคสที่บันทึกตรงในฟอร์มโดยไม่มีร่าง ระบบสร้างร่างให้เอง (แจ้งเตือน LINE มาจากตารางร่างที่เดียว)
   ข้อมูลร่าง (คอลเลกชัน drafts): { id, startDate, highway, km, caseId, status:'open'|'cancelled', source, note, createdAt, createdBy }

   หน้าตา (แบบ "จัดกลุ่มสามช่วง"): แบ่งเป็น เลยกำหนด/ครบวันนี้ · ใกล้ครบ (≤3 วันทำการ) · ยังมีเวลา แต่ละเรื่องบรรทัดเดียว
     คลิกบรรทัด = เปิดฟอร์มบันทึกเคส · ปุ่ม "＋ เพิ่มร่าง" และไอคอนแก้ไข = หน้าต่างลอยกรอกข้อมูลร่าง
   ระบบอุบัติเหตุ (sys:'accident') แสดงเฉพาะร่างที่ยังไม่บันทึกเคส · ระบบอื่นมีตัวเลือก "แสดงที่ปิดแล้ว"
   ========================================================================== */
(function () {
  'use strict';
  var LIMIT_DAYS = 10, WARN_LEFT = 3;
  // วันหยุดนักขัตฤกษ์สำรอง (ใช้เมื่อยังโหลดรายการจริงจาก Apps Script ไม่ได้) — ตั้งค่า window.DRAFT_HOLIDAY_URL ใน index.html เพื่อดึงรายการจริง
  var HOL_FALLBACK = ['2026-10-13', '2026-10-23', '2026-12-05', '2026-12-07', '2026-12-10', '2026-12-31', '2027-01-01'];
  var HOL_KEY = 'cn_draft_holidays_v1';
  // URL Web app (ลงท้าย /exec) ของ Apps Script "แจ้งเตือน LINE" — ใส่แล้วหน้าเว็บจะดึงรายการวันหยุดตัวเดียวกับที่ LINE ใช้ (ตาราง public_holidays ของระบบบริหารหมวด) ให้วันครบกำหนดตรงกัน · เว้นว่าง = ใช้รายการสำรองข้างบน
  var HOLIDAY_URL = '';
  var CFG = null, drafts = [], holSet = null, started = false, pendingId = null, pendingExisting = '', editingDraftId = null, ACC = false;

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
    var url = window.DRAFT_HOLIDAY_URL || HOLIDAY_URL;
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
    var a = parse(todayStr), b = parse(dueStr), c = 0;
    // เหลือ = จำนวนวันทำการหลังวันนี้ถึงวันครบกำหนด (รวมวันครบกำหนด) · เลย = จำนวนวันทำการหลังวันครบกำหนดถึงวันนี้ (รวมวันนี้)
    var from = a < b ? a : b, to = a < b ? ymd(b) : ymd(a);
    var d = new Date(from.getTime());
    while (ymd(d) !== to) { d.setDate(d.getDate() + 1); if (isWork(d)) c++; if (c > 400) break; }
    return a < b ? c : -c;
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
    return { state: sent ? 'sent' : (done ? 'done' : 'open'), start: start, due: due, left: left, c: c, sent: sent, over: due < t };
  }

  /* ---------- หน้าตา ---------- */
  function injectCss() {
    if (document.getElementById('draftCss')) return;
    var s = document.createElement('style'); s.id = 'draftCss';
    s.textContent =
      '.dr-chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:13px;font-weight:600;white-space:nowrap}' +
      '.dr-chip.g{background:#E1F5EE;color:#085041}.dr-chip.y{background:#FAEEDA;color:#633806}.dr-chip.r{background:#FCEBEB;color:#791F1F}.dr-chip.n{background:#EEE;color:#555}' +
      '#draftCard .dr-top{display:flex;flex-wrap:wrap;align-items:center;gap:8px 8px;margin-bottom:14px}' +
      '#draftCard .dr-top .sp{flex:1}' +
      '#draftCard .dr-gp{border:1px solid var(--line,#e3e3e3);border-radius:12px;overflow:hidden;margin-bottom:12px}' +
      '#draftCard .dr-gh{display:flex;align-items:center;gap:9px;padding:9px 14px;font-family:Kanit,Sarabun,sans-serif;font-weight:600;font-size:14.5px}' +
      '#draftCard .dr-gh i{width:9px;height:9px;border-radius:50%;flex:none}' +
      '#draftCard .dr-gh .c{margin-left:auto;font-family:Sarabun,sans-serif;font-size:13px}' +
      '#draftCard .dr-gh.r{background:#FCEBEB;color:#791F1F}#draftCard .dr-gh.r i{background:#d64545}' +
      '#draftCard .dr-gh.y{background:#FAEEDA;color:#633806}#draftCard .dr-gh.y i{background:#e59a14}' +
      '#draftCard .dr-gh.g{background:#E1F5EE;color:#085041}#draftCard .dr-gh.g i{background:#1f9d6b}' +
      '#draftCard .dr-gh.n{background:#EEE;color:#555}#draftCard .dr-gh.n i{background:#aaa}' +
      '#draftCard .dr-ln{display:flex;align-items:center;gap:12px;padding:11px 14px;border-top:1px solid #f0f0f0;background:#fff;cursor:pointer}' +
      '#draftCard .dr-ln:hover{background:#f7fafc}#draftCard .dr-ln:focus-visible{outline:2px solid var(--amber-500,#f07a1f);outline-offset:-2px}' +
      '#draftCard .dr-t{font-family:Kanit,Sarabun,sans-serif;font-weight:600;font-size:15px;min-width:150px;flex:0 1 auto;color:var(--ink,#182430)}' +
      '#draftCard .dr-s,#draftCard .dr-k{margin-left:14px}#draftCard .dr-n{margin-left:6px;flex:1;min-width:0;color:#777;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#draftCard .dr-d{color:#555;font-size:13.5px;white-space:nowrap}' +
      '#draftCard .dr-act{display:flex;gap:2px;margin-left:2px}' +
      '#draftCard .dr-ib{border:none;background:transparent;width:32px;height:32px;border-radius:8px;cursor:pointer;color:#8a929c;display:inline-grid;place-items:center;padding:0}' +
      '#draftCard .dr-ib:hover{background:#eef1f4;color:var(--ink,#182430)}#draftCard .dr-ib.del:hover{background:var(--rust-bg,#fbeae7);color:var(--rust,#c1402f)}' +
      '#draftCard .dr-ib:focus-visible{outline:2px solid var(--amber-500,#f07a1f);outline-offset:1px}' +
      '#draftCard .dr-empty{padding:18px;color:#888;text-align:center}' +
      '#draftCard .dr-warn{padding:10px 12px;border-radius:8px;background:#FAEEDA;color:#633806;margin-bottom:10px;font-size:14px}' +
      '#draftCard .dr-note{color:#777;font-size:12px}' +
      '@media(max-width:700px){#draftCard .dr-ln{flex-wrap:wrap;gap:6px 10px}#draftCard .dr-t{min-width:0}#draftCard .dr-d{display:none}#draftCard .dr-n{order:9;flex-basis:100%}}' +
      /* หน้าต่างลอยกรอกข้อมูลร่าง (z-index 45: ต่ำกว่า toast=50 เพื่อให้ข้อความแจ้งเตือนเห็นอยู่ด้านบน) */
      '#drModal{position:fixed;inset:0;z-index:45;background:rgba(7,27,48,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:18px}' +
      '#drModal .dm{background:#fff;border-radius:16px;width:100%;max-width:480px;max-height:92vh;overflow:auto;box-shadow:var(--shadow-lg,0 16px 40px -14px rgba(7,27,48,.35))}' +
      '#drModal .dm-h{display:flex;align-items:center;gap:10px;padding:16px 20px;border-bottom:1px solid var(--line,#e3e3e3)}' +
      '#drModal .dm-h b{font-family:Kanit,Sarabun,sans-serif;font-size:17px;flex:1;color:var(--navy-900,#0a2540)}' +
      '#drModal .dm-x{border:none;background:var(--paper-2,#eee);width:32px;height:32px;border-radius:50%;font-size:18px;cursor:pointer;line-height:1}' +
      '#drModal .dm-b{padding:16px 20px;display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
      '#drModal .dm-b .full{grid-column:1/-1}' +
      '#drModal .dm-b input,#drModal .dm-b select{width:100%}' +
      '#drModal .dm-f{display:flex;gap:8px;align-items:center;padding:12px 20px;border-top:1px solid var(--line,#e3e3e3);background:#fafaf8;flex-wrap:wrap}' +
      '#drModal .dm-f .sp{flex:1}#drModal .dm-del{color:var(--rust,#c1402f)}' +
      '@media(max-width:560px){#drModal{align-items:flex-end;padding:0}#drModal .dm{max-width:none;border-radius:16px 16px 0 0}}';
    document.head.appendChild(s);
  }

  function chip(v) {
    if (v.state === 'cancelled') return '<span class="dr-chip n">ยกเลิกแล้ว</span>';
    if (v.state === 'sent') return '<span class="dr-chip g">ส่งแขวงแล้ว ' + esc(tdate(v.sent)) + '</span>';
    if (v.state === 'done') return '<span class="dr-chip n">เรื่องจบแล้ว</span>';
    if (v.left < 0) return '<span class="dr-chip r">เลยกำหนด ' + (-v.left) + ' วันทำการ</span>';
    if (v.left === 0 && v.over) return '<span class="dr-chip r">เลยกำหนดแล้ว</span>';   // ครบกำหนดก่อนวันนี้ แต่วันนี้ไม่ใช่วันทำการ (เสาร์-อาทิตย์/วันหยุด)
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

  // ไอคอนเส้นบาง (ดินสอ / ถังขยะ) สีตาม currentColor
  var ICON_EDIT = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  var ICON_DEL = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>';

  // " ตอน <ชื่อตอน>" ต่อท้าย ทล. (ดึงจากข้อมูลสายทางของแต่ละระบบผ่าน CFG.sectionOf · ไม่มีชื่อตอนก็ไม่แสดง)
  function sectionText(hw) {
    var s = '';
    try { s = CFG.sectionOf ? String(CFG.sectionOf(hw) || '').trim() : ''; } catch (e) { s = ''; }
    s = s.replace(/^ตอน\s*/, '');
    return s ? '<span class="dr-s">ตอน ' + esc(s) + '</span>' : '';
  }

  // บรรทัดเดียวของหนึ่งร่าง
  function rowHtml(r) {
    var d = r.d, v = r.v, closed = r.closed;
    var canEdit = !d.caseId && d.status !== 'cancelled';
    var canCancel = ACC ? true : !closed;
    return '<div class="dr-ln" role="button" tabindex="0" data-id="' + esc(d.id) + '">' +
      '<span class="dr-t">ทล.' + esc(d.highway) + sectionText(d.highway) + '<span class="dr-k">กม.' + esc(fmtKm(d.km)) + '</span></span>' +
      '<span class="dr-n">' + esc(d.note || '') + '</span>' +
      '<span class="dr-d">' + (v.due ? 'ครบ ' + esc(tdate(v.due)) : esc(tdate(v.start))) + '</span>' +
      chip(v) + (d.caseId ? '<span class="dr-chip g">บันทึกเคสแล้ว</span>' : '') +
      '<span class="dr-act">' +
        (canEdit ? '<button type="button" class="dr-ib" data-act="edit" title="แก้ไขร่าง" aria-label="แก้ไขร่าง">' + ICON_EDIT + '</button>' : '') +
        (canCancel && d.status !== 'cancelled' ? '<button type="button" class="dr-ib del" data-act="cancel" title="' + (ACC ? 'ลบร่าง' : 'ยกเลิกร่าง') + '" aria-label="' + (ACC ? 'ลบร่าง' : 'ยกเลิกร่าง') + '">' + ICON_DEL + '</button>' : '') +
      '</span></div>';
  }

  function render() {
    var el = document.getElementById('draftPanel');
    if (!el || !CFG) return;
    injectCss();
    var t = today();
    var rows = [], counts = { open: 0, warn: 0, over: 0 };
    drafts.forEach(function (d) {
      var v = viewOf(d, t); if (v.hide) return;
      // ร่างที่ปิดแล้ว (ส่งแขวงแล้ว / เรื่องจบ / ยกเลิก) ไม่แสดงในตารางนี้ — เรื่องที่จบแล้วไปดูที่ตารางในหน้ารายการ
      if (v.state !== 'open') return;
      counts.open++;
      if (v.left <= 0) counts.over++; else if (v.left <= WARN_LEFT) counts.warn++;
      rows.push({ d: d, v: v, closed: false });
    });
    rows.sort(function (a, b) {
      if (a.closed !== b.closed) return a.closed ? 1 : -1;
      var ka = a.closed ? '' : String(a.v.due), kb = b.closed ? '' : String(b.v.due);
      return ka < kb ? -1 : ka > kb ? 1 : (String(a.d.startDate) < String(b.d.startDate) ? 1 : -1);
    });

    var failed = window.FBL && FBL.watchFailed && FBL.watchFailed.drafts;
    var html = '<div class="card" id="draftCard"><div class="section-title">รายการร่าง</div>';
    if (failed) html += '<div class="dr-warn">ยังอ่านรายการร่างไม่ได้ (' + esc(failed) + ') — ถ้าเพิ่งติดตั้งฟีเจอร์นี้ ให้วาง firestore.rules ใหม่ใน Firebase Console ก่อน</div>';
    html += '<div class="dr-top">' +
      '<span class="dr-chip n">รอดำเนินการ ' + counts.open + ' เรื่อง</span>' +
      '<span class="sp"></span>' +
      '<button type="button" class="btn btn-outline" id="drAddBtn">ร่างรายการ</button>' +
      '<button type="button" class="btn btn-primary" id="drNewBtn">＋ รายการใหม่</button></div>';

    if (!rows.length) {
      html += '<div class="dr-empty">ยังไม่มีรายการร่างที่ค้างอยู่</div>';
    } else {
      var groups = [
        { k: 'r', title: 'เลยกำหนด / ครบกำหนดวันนี้', f: function (r) { return !r.closed && r.v.left <= 0; } },
        { k: 'y', title: 'ใกล้ครบกำหนด · เหลือไม่เกิน ' + WARN_LEFT + ' วันทำการ', f: function (r) { return !r.closed && r.v.left > 0 && r.v.left <= WARN_LEFT; } },
        { k: 'g', title: 'อยู่ในกำหนด · เหลือมากกว่า ' + WARN_LEFT + ' วันทำการ', f: function (r) { return !r.closed && r.v.left > WARN_LEFT; } }
      ];
      groups.forEach(function (g) {
        var list = rows.filter(g.f); if (!list.length) return;
        html += '<div class="dr-gp"><div class="dr-gh ' + g.k + '"><i></i>' + g.title + '<span class="c">' + list.length + ' เรื่อง</span></div>' + list.map(rowHtml).join('') + '</div>';
      });
    }
    html += '</div>';
    el.innerHTML = html;
    bind(el);
  }

  function bind(el) {
    var q = function (id) { return el.querySelector('#' + id); };
    q('drAddBtn').onclick = function () { openModal(null); };
    // "＋ รายการใหม่" = เปิดฟอร์มเต็มว่าง ๆ ได้เลยโดยไม่ต้องมีร่าง (บันทึกแล้วระบบสร้างร่างติดตามให้เองใน afterCaseSaved)
    q('drNewBtn').onclick = function () { if (CFG.openBlank) CFG.openBlank(); };
    el.querySelectorAll('.dr-ln').forEach(function (row) {
      var id = row.getAttribute('data-id');
      function go() { var d = byId(id); if (!d || d.status === 'cancelled') return; if (d.caseId) openCase(d); else makeCase(d); }
      row.onclick = function (ev) { if (ev.target.closest('button')) return; go(); };
      row.onkeydown = function (ev) { if (ev.target === row && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); go(); } };
      row.querySelectorAll('button[data-act]').forEach(function (b) {
        b.onclick = function () {
          var d = byId(id); if (!d) return; var a = b.getAttribute('data-act');
          if (a === 'edit') openModal(id); else if (a === 'cancel') cancelDraft(d);
        };
      });
    });
  }

  /* ---------- หน้าต่างลอย เพิ่ม/แก้ไขร่าง ---------- */
  function onKey(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    var m = document.getElementById('drModal'); if (m) m.remove();
    document.removeEventListener('keydown', onKey);
    editingDraftId = null;
  }
  function openModal(id) {
    closeModal(); injectCss();
    editingDraftId = id || null;
    var d = id ? byId(id) : null, t = today();
    var m = document.createElement('div'); m.id = 'drModal';
    m.innerHTML =
      '<div class="dm" role="dialog" aria-modal="true"><div class="dm-h"><b>' + (d ? 'แก้ไขรายการร่าง' : 'เพิ่มรายการร่าง') + '</b><button type="button" class="dm-x" id="drClose" aria-label="ปิด">×</button></div>' +
      '<div class="dm-b">' +
        '<div class="field full"><label>' + esc(CFG.startLabel) + ' <span class="req">*</span></label><input type="date" id="drDate" max="' + t + '" value="' + esc(d ? d.startDate : t) + '"></div>' +
        '<div class="field"><label>ทล. <span class="req">*</span></label><select id="drHw">' + hwOptions(d ? d.highway : '') + '</select></div>' +
        '<div class="field"><label>กม. <span class="req">*</span></label><input type="text" id="drKm" placeholder="เช่น 145+200" value="' + esc(d ? fmtKm(d.km) : '') + '"></div>' +
        '<div class="field full"><label>หมายเหตุ</label><input type="text" id="drNote" value="' + esc(d ? (d.note || '') : '') + '"></div>' +
      '</div>' +
      '<div class="dm-f">' + (d ? '<button type="button" class="btn btn-outline dm-del" id="drDel">🗑 ' + (ACC ? 'ลบร่าง' : 'ยกเลิกร่าง') + '</button>' : '') + '<span class="sp"></span>' +
        '<button type="button" class="btn btn-outline" id="drCancelEdit">ยกเลิก</button>' +
        '<button type="button" class="btn btn-primary" id="drAdd">' + (d ? 'บันทึกการแก้ไข' : '＋ เพิ่มร่าง') + '</button></div></div>';
    document.body.appendChild(m);
    m.addEventListener('mousedown', function (e) { if (e.target === m) closeModal(); });
    document.getElementById('drClose').onclick = closeModal;
    document.getElementById('drCancelEdit').onclick = closeModal;
    document.getElementById('drAdd').onclick = onAdd;
    if (d) document.getElementById('drDel').onclick = function () { cancelDraft(d).then(function (ok) { if (ok) closeModal(); }); };
    m.addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); onAdd(); } });
    document.addEventListener('keydown', onKey);
    var first = document.getElementById(d ? 'drKm' : 'drHw'); if (first) first.focus(); // แก้ไขร่าง: ไม่โฟกัสช่องวันที่ (กันแถบน้ำเงินคลุมวัน)
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
      if (ok) { toast('แก้ไขร่างแล้ว'); closeModal(); }
      return;
    }
    var dup = drafts.some(function (d) { return d.status !== 'cancelled' && d.startDate === date && String(d.highway) === String(hw) && Number(d.km) === km; }) ||
      caseDocs().some(function (c) { return !c.deletedAt && d10(CFG.startOf(c)) === date && String(c.highway) === String(hw) && Number(c.km) === km; });
    if (dup && !(await ask('เพิ่มร่างซ้ำหรือไม่ ?', 'ทล.' + hw + ' กม.' + fmtKm(km), 'มีร่างหรือเคสวันที่ ทล. และ กม. เดียวกันอยู่แล้ว', 'เพิ่มซ้ำ', false))) return;
    var rec = { id: newId(), startDate: date, highway: String(hw), km: km, caseId: '', status: 'open', source: 'web', note: note, createdAt: new Date().toISOString(), createdBy: who() };
    if (await save(rec)) { toast('เพิ่มร่างแล้ว ครบกำหนด ' + tdate(addWork(date, LIMIT_DAYS))); closeModal(); }
  }
  /* กล่องยืนยันของระบบเอง (หน้าตาเดียวกับกล่องลบรายการ/ออกจากฟอร์ม — ไม่ใช้ confirm() ของเบราว์เซอร์) · Esc / คลิกฉากหลัง / ปุ่ม × / ปุ่ม กลับ = ยกเลิก */
  function ask(title, strong, msg, okLabel, danger) {
    return new Promise(function (resolve) {
      var dlg = document.createElement('div'); dlg.className = 'modal-backdrop'; dlg.id = 'drAsk';
      dlg.innerHTML = '<div class="modal" role="alertdialog" aria-modal="true" style="max-width:420px"><div class="modal-head"><h3>' + esc(title) + '</h3><button class="modal-close" id="drAskX" type="button" aria-label="ปิด">×</button></div>' +
        '<div class="modal-body"><p style="margin:10px 0 2px;font-weight:600;color:var(--navy-900)">' + esc(strong) + '</p><p style="margin:0">' + esc(msg) + '</p>' +
        '<div class="actions" style="margin-top:16px"><button class="btn btn-outline" id="drAskNo" type="button">กลับ</button>' +
        '<button class="btn ' + (danger ? 'btn-danger' : 'btn-primary') + '" id="drAskOk" type="button">' + esc(okLabel) + '</button></div></div></div>';
      document.body.appendChild(dlg);
      function done(v) { document.removeEventListener('keydown', onK, true); dlg.remove(); resolve(v); }
      function onK(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } }
      document.addEventListener('keydown', onK, true);
      dlg.addEventListener('mousedown', function (e) { if (e.target === dlg) done(false); });
      document.getElementById('drAskX').onclick = function () { done(false); };
      document.getElementById('drAskNo').onclick = function () { done(false); };
      document.getElementById('drAskOk').onclick = function () { done(true); };
      document.getElementById('drAskNo').focus();
    });
  }
  async function cancelDraft(d) {
    // ลบ/ยกเลิก = ตั้งสถานะ "cancelled" (สมาชิกทุกคนทำได้ · ไม่ต้องแก้ Rules · LINE เลิกติดตามร่างนี้) · คืนค่า true เมื่อทำสำเร็จ
    var word = ACC ? 'ลบร่าง' : 'ยกเลิกร่าง';
    if (!(await ask(word + 'นี้หรือไม่ ?', 'ทล.' + d.highway + ' กม.' + fmtKm(d.km), (ACC ? 'ร่างจะหายจากตาราง และระบบจะไม่แจ้งเตือนอีก' : 'ร่างจะไม่ถูกติดตาม และระบบจะไม่แจ้งเตือนอีก'), word, true))) return false;
    if (await save({ id: d.id, status: 'cancelled', cancelledAt: new Date().toISOString(), cancelledBy: who() })) { toast(word + 'แล้ว'); return true; }
    return false;
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
    init: function (cfg) { CFG = cfg; ACC = cfg && cfg.sys === 'accident'; loadHolidays(); },
    start: start,
    render: render,
    afterCaseSaved: afterCaseSaved,
    clearPending: function () { pendingId = null; pendingExisting = ''; },
    pendingId: function () { return pendingId; },
    addWorkdays: addWork,
    workLeft: workLeft
  };
})();
