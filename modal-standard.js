/* ============================================================
   modal-standard.js — มาตรฐานหน้าต่างโมดัล (ไฟล์เดียวกันใช้ร่วมทุกระบบ ทุกหน้า)
   ------------------------------------------------------------
   โมดัลทุกตัว (รวมที่สร้างใหม่ในอนาคต) จะได้หน้าตาเดียวกันอัตโนมัติ ถ้าเขียนโครงอย่างใดอย่างหนึ่งนี้:

     <div class="modal-overlay | modal-backdrop | modal-bg">
       <div class="modal-box | modal">
         <div class="modal-head | modal-h"> …ชื่อเรื่อง… <button class="modal-close">✕</button></div>
         <div class="modal-body | modal-b"> …เนื้อหา… </div>
         <div class="modal-foot | modal-f | modal-actions | cd-foot">
           <button>ลบ…</button>        ← ปุ่มลบ: ไปชิดซ้ายเอง
           <button>ปิด / ยกเลิก</button>
           <button class="btn-primary">แก้ไข / บันทึก</button>   ← ปุ่มหลักอยู่ขวาสุดเสมอ
         </div>
       </div>
     </div>

   สิ่งที่ไฟล์นี้บังคับให้เหมือนกัน
     1) กล่องโค้งมน 20px + เส้นส้มเรืองแสงวิ่งโค้งตามมุมบน (สไตล์เดียวกับเส้นใต้หัวแท็บ)
        — ไม่แสดงในหน้าต่างบอกสถานะ (บันทึกสำเร็จ/ลบสำเร็จ/แจ้งเตือน) ซึ่งไม่มีส่วนหัว
     2) หัวกับท้ายตรึงอยู่กับที่ — เฉพาะ "เนื้อหา" เลื่อนขึ้น-ลง แถบเลื่อนอยู่ระหว่างหัวกับท้าย
     3) ปุ่มลบชิดซ้าย · ปุ่มปิด/ยกเลิก/แก้ไข/บันทึก ชิดขวา (ปุ่มหลักขวาสุด)
        (กล่องยืนยันที่มีแค่ [ยกเลิก][ลบ] ไม่ย้ายปุ่ม)
     4) ขนาดมีแค่ 3 ขนาด: S 420 · M 640 (ค่าเริ่มต้น) · L 960 — เลือกด้วย class modal-s / modal-m / modal-l บนกล่อง
        (ไม่ใส่ class ก็ได้ ระบบดูความกว้างเดิมแล้วปัดเข้าขนาดที่ใกล้สุดให้ ห้ามตั้ง max-width เองอีก)
   แถวปุ่มที่ฝังท้ายเนื้อหา (เช่น .actions) จะถูกยกออกมาเป็นท้ายโมดัลให้เอง
   และตามดูโมดัลที่ถูกสร้าง/เติมเนื้อหาทีหลังด้วย JS ให้เอง (MutationObserver)
   ============================================================ */
(function(){
  if (window.ModalStd) return;

  var BOX_SEL = [
    '.modal-overlay > .modal-box', '.modal-overlay > .modal',
    '.modal-backdrop > .modal', '.modal-backdrop > .modal-box',
    '.modal-bg > .modal', '.modal-bg > .modal-box'
  ].join(',');

  var CSS = [
    '@keyframes mstdGlow{to{background-position:200% 0}}',

    /* พื้นหลังเบลอ: ไม่เลื่อนทั้งแผ่น + กล่องอยู่กลางจอ */
    'html .mstd-overlay{align-items:center;overflow:hidden}',

    /* กล่องโมดัล: โค้งมน + ตัดขอบ + ไม่สูงเกินจอ */
    'html body .mstd-box{position:relative;border-radius:20px;overflow:hidden !important;',
    '  max-height:calc(100vh - 40px) !important;max-height:calc(100dvh - 40px) !important}',

    /* ขนาดมาตรฐาน 3 ขนาด: S 420 (ยืนยัน/แจ้งเตือน/ฟอร์มสั้น) · M 640 (ฟอร์มทั่วไป ค่าเริ่มต้น) · L 960 (รายละเอียด/ตารางในโมดัล) */
    'html body .mstd-s{max-width:420px !important}',
    'html body .mstd-m{max-width:640px !important}',
    'html body .mstd-l{max-width:960px !important}',

    /* เส้นส้มเรืองแสงโค้งตามมุมบน (เป็นขอบบนกล่องที่โค้งไปตามมุม) — ใช้เฉพาะโมดัลที่มีหัว */
    'html body .mstd-split{border-top:0 !important}',
    '.mstd-split::before{content:"";position:absolute;left:0;right:0;top:0;height:40px;clip-path:inset(0 0 14px 0);z-index:8;pointer-events:none;box-sizing:border-box;',
    '  border-radius:20px 20px 0 0;border-top:4px solid transparent;',
    '  background:linear-gradient(90deg,#e0620f,#f07a1f,#ffa24d,#f07a1f,#e0620f) border-box;background-size:200% 100%;',
    '  -webkit-mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;',
    '  mask:linear-gradient(#000 0 0) padding-box,linear-gradient(#000 0 0);mask-composite:exclude;',
    '  animation:mstdGlow 2.4s linear infinite}',
    /* แสงนวลใต้เส้น */
    '.mstd-split::after{content:"";position:absolute;left:0;right:0;top:0;height:16px;z-index:7;pointer-events:none;',
    '  border-radius:20px 20px 0 0;background:linear-gradient(rgba(240,122,31,.38),rgba(240,122,31,0))}',
    '@media(prefers-reduced-motion:reduce){.mstd-split::before{animation:none}}',

    /* โมดัลที่มีหัว+เนื้อหา: หัว/ท้ายตรึง เนื้อหาเลื่อน */
    'html body .mstd-split{display:flex !important;flex-direction:column !important}',
    '.mstd-split > *{flex:none}',
    '.mstd-split.mstd-hasfoot{padding-bottom:0 !important}',
    '.mstd-split > .mstd-body{flex:1 1 auto !important;min-height:0 !important;overflow-y:auto !important;overflow-x:hidden !important;',
    '  scrollbar-width:thin;scrollbar-color:#c3cad3 transparent;overscroll-behavior:contain}',
    '.mstd-body::-webkit-scrollbar{width:8px}',
    '.mstd-body::-webkit-scrollbar-track{background:transparent;margin:4px 0}',
    '.mstd-body::-webkit-scrollbar-thumb{background:#c3cad3;border-radius:8px}',
    '.mstd-body::-webkit-scrollbar-thumb:hover{background:#9aa6b2}',

    /* หน้าต่างบอกสถานะ/แจ้งเตือน (ไม่มีหัว): ไม่มีเส้นส้ม เลื่อนทั้งกล่องถ้าสูงเกิน */
    'html body .mstd-plain{overflow-x:hidden !important;overflow-y:auto !important}',

    /* ปุ่มท้ายโมดัล: ลบ = ซ้ายสุด · ปุ่มหลัก = ขวาสุด (ยกเว้นแถบขั้นตอนของใบสั่งการที่มีปุ่มย้อนกลับ/ถัดไปของตัวเอง) */
    '.mstd-foot:not(.dw-wizard-footer){display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
    '.mstd-foot:not(.dw-wizard-footer) > .mstd-del{order:-1;margin-right:auto}',
    '.mstd-foot:not(.dw-wizard-footer) > .btn-primary{order:5}',
    '.mstd-foot.mstd-hoisted{padding:14px 22px;border-top:1px solid #e3e6ea;background:#fff;justify-content:flex-end}',
    '.mstd-foot:not(.dw-wizard-footer):not(.dwv-foot):not(.ma-foot):not(.modal-plain-footer){justify-content:flex-end}'
  ].join('\n');

  function injectCss(){
    if (document.getElementById('modal-standard-css')) return;
    var st = document.createElement('style');
    st.id = 'modal-standard-css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function hasTok(el, re){
    var cl = el.classList;
    for (var i = 0; i < cl.length; i++) if (re.test(cl[i])) return true;
    return false;
  }
  var RE_HEAD = /^(modal-head|modal-h|dwv-hd)$/;
  var RE_BODY = /^(modal-body|modal-b|dwv-body)$/;
  var RE_FOOT = /(^|-)(foot|footer|f|actions)$/;
  var RE_ROWCLS = /^(actions|modal-actions|modal-foot|modal-f|toolbar)$/;

  function btnText(b){
    return (b.textContent || '').replace(/^[^A-Za-z0-9฀-๿]+/, '').trim();
  }
  /* ปุ่มลบ = ข้อความขึ้นต้น "ลบ" / id มี delete|remove / class crew-delete-btn
     (ไม่ดูสีแดงอย่างเดียว เพราะปุ่ม "ตกลง/ยืนยัน" ในกล่องยืนยันก็สีแดง ต้องอยู่ขวา) */
  function isDelete(b){
    if (b.classList.contains('crew-delete-btn')) return true;
    if (/delete|remove/i.test(b.id || '')) return true;
    return /^ลบ/.test(btnText(b));
  }
  function isPrimary(b){
    return /primary/.test(b.className || '');
  }

  function normFoot(foot){
    if (foot.classList.contains('dw-wizard-footer')) return;
    var btns = foot.querySelectorAll('button');
    var del = [], others = [];
    for (var i = 0; i < btns.length; i++){
      (isDelete(btns[i]) ? del : others).push(btns[i]);
    }
    if (!del.length) return;
    /* กล่องยืนยันที่มีแค่ [ยกเลิก][ลบ] ไม่ต้องย้าย — ย้ายเฉพาะท้ายฟอร์มที่มีปุ่มบันทึก/แก้ไข หรือมีปุ่มอื่นตั้งแต่ 2 ปุ่ม */
    var hasMain = others.length >= 2 || others.some(isPrimary);
    if (!hasMain) return;
    del.forEach(function(b){
      b.classList.add('mstd-del');
      if (b.parentNode !== foot) foot.insertBefore(b, foot.firstChild);   /* อยู่ในกล่องซ้อน → ย้ายขึ้นมาให้ชิดซ้ายจริง */
    });
  }

  /* แถวปุ่มที่ถูกเขียนฝังท้าย body (เช่น .actions หรือ <div style="display:flex;justify-content:flex-end">[ลบ][บันทึก]</div>)
     → ยกออกมาเป็นท้ายโมดัลจริง จะได้ตรึงอยู่กับที่และเรียงปุ่มตามมาตรฐาน */
  function findActionRow(body){
    var last = body.lastElementChild;
    while (last && last.classList.contains('mstd-sentinel')) last = last.previousElementSibling;
    if (!last || last.tagName !== 'DIV') return null;
    var st = last.getAttribute('style') || '';
    var byStyle = /justify-content:\s*(flex-end|space-between)/.test(st);
    var byClass = false;
    for (var c = 0; c < last.classList.length; c++) if (RE_ROWCLS.test(last.classList[c])) byClass = true;
    if (!byStyle && !byClass) return null;
    var kids = last.children;
    if (!kids.length) return null;
    for (var i = 0; i < kids.length; i++){
      if (kids[i].tagName === 'BUTTON') continue;
      if (kids[i].tagName === 'DIV' && kids[i].children.length && !kids[i].querySelector(':scope > :not(button)')) continue;
      return null;
    }
    return last;
  }
  function hoistActions(box, body){
    var old = box.querySelector(':scope > .mstd-hoisted');
    if (old){
      if (body.querySelector(':scope > .mstd-sentinel')) return old;   /* เนื้อหายังเป็นชุดเดิม ปุ่มที่ยกออกยังใช้ได้ */
      old.remove();                                                      /* เนื้อหาถูกวาดใหม่แล้ว → ปุ่มเก่าค้าง ลบทิ้ง */
    }
    var row = findActionRow(body);
    if (!row) return null;
    var foot = document.createElement('div');
    foot.className = 'modal-foot mstd-hoisted';
    while (row.firstChild) foot.appendChild(row.firstChild);
    row.remove();
    var s = document.createElement('i');
    s.className = 'mstd-sentinel';
    s.hidden = true;
    body.appendChild(s);
    body.parentNode.insertBefore(foot, body.nextSibling);
    return foot;
  }

  /* เลือกขนาด: ใส่ class modal-s / modal-m / modal-l เองได้ — ถ้าไม่ใส่ จะดูความกว้างเดิมแล้วปัดเข้าขนาดที่ใกล้สุด
     (≤480 → S · ≤800 → M · กว้างกว่านั้น → L · ไม่ระบุ → M) */
  function sizeBox(box){
    var cl = box.classList;
    if (cl.contains('mstd-s') || cl.contains('mstd-m') || cl.contains('mstd-l')) return;
    var s = cl.contains('modal-s') ? 's' : cl.contains('modal-m') ? 'm' : cl.contains('modal-l') ? 'l' : '';
    if (!s){
      var mw = parseFloat(getComputedStyle(box).maxWidth);
      s = isNaN(mw) ? 'm' : mw <= 480 ? 's' : mw <= 800 ? 'm' : 'l';
    }
    cl.add('mstd-' + s);
  }

  function normBox(box){
    var kids = Array.prototype.slice.call(box.children);
    var head = null, body = null, foot = null, k;
    for (k = 0; k < kids.length; k++){ if (hasTok(kids[k], RE_HEAD)) { head = kids[k]; break; } }
    for (k = 0; k < kids.length; k++){ if (hasTok(kids[k], RE_BODY)) { body = kids[k]; break; } }
    for (k = kids.length - 1; k >= 0; k--){
      var c = kids[k];
      if (c === head || c === body) continue;
      if (hasTok(c, RE_FOOT) || RE_FOOT.test(c.id || '')) { foot = c; break; }
    }
    /* มีหัวแต่ไม่มีส่วนเนื้อหา → ห่อเนื้อหาที่เหลือให้อัตโนมัติ (เนื้อหาโมดัลที่สร้างด้วย JS) */
    if (head && !body){
      var wrap = document.createElement('div');
      wrap.className = 'modal-body';
      wrap.style.padding = '20px 22px 22px';
      var mv = [];
      kids.forEach(function(c){ if (c !== head && c !== foot && !hasTok(c, /^modal-tabs$/)) mv.push(c); });
      if (mv.length){
        box.insertBefore(wrap, mv[0]);
        mv.forEach(function(c){ wrap.appendChild(c); });
        body = wrap;
      }
    }
    box.classList.add('mstd-box');
    sizeBox(box);
    if (box.parentNode) box.parentNode.classList.add('mstd-overlay');
    if (head && body){
      box.classList.add('mstd-split');
      box.classList.remove('mstd-plain');
      head.classList.add('mstd-head');
      body.classList.add('mstd-body');
      if (!foot || foot.classList.contains('mstd-hoisted')) foot = hoistActions(box, body);
      box.classList.toggle('mstd-hasfoot', !!foot);
      if (foot){ foot.classList.add('mstd-foot'); normFoot(foot); }
    } else {
      box.classList.add('mstd-plain');
      box.classList.remove('mstd-split');
    }
  }

  var queued = false;
  function scan(){
    queued = false;
    var boxes = document.querySelectorAll(BOX_SEL);
    for (var i = 0; i < boxes.length; i++){
      try { normBox(boxes[i]); } catch(e){}
    }
  }
  function schedule(){
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(scan);
  }

  function start(){
    injectCss();
    scan();
    if (window.MutationObserver){
      new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    }
  }

  window.ModalStd = { scan: scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
