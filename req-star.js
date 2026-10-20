/* ============================================================
   req-star.js — มาตรฐานดอกจัน (*) ช่องบังคับกรอก "สีแดงชัดเจน" ทุกระบบ
   ไฟล์เดียวกันคัดลอกไว้ทุก 2. Github_* (ห้ามแก้เฉพาะระบบ)
   - ดอกจันที่เป็น <span class="req"> / "dw-req" / "req-star" → แดงชัด หนา
   - ดอกจันที่เป็นตัวอักษรท้ายข้อความใน <label> (เช่น "สายทาง *") → ห่อให้อัตโนมัติ
     รวมถึงฟอร์มที่สร้างทีหลังด้วย JS (ดักด้วย MutationObserver)
   ฟอร์มใหม่ในอนาคต: เขียน label แบบ "ชื่อช่อง *" หรือ <span class="req">*</span> ก็ได้ ไม่ต้องเขียน CSS สี
   ============================================================ */
(function () {
  'use strict';
  var RED = '#e11d1d';
  var CLS = 'req-star';

  try {
    var st = document.createElement('style');
    st.setAttribute('data-req-star', '1');
    st.textContent =
      '.req,.dw-req,.' + CLS + ',label .req,.field label .req,.modal-field label .req{' +
      'color:' + RED + '!important;font-weight:700!important;-webkit-text-fill-color:' + RED + '!important}';
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}

  function isSkippable(node) {
    var p = node.parentNode;
    return !p || /^(SCRIPT|STYLE|TEXTAREA|OPTION|INPUT|SELECT|CODE|PRE)$/.test(p.nodeName) ||
      (p.classList && p.classList.contains(CLS));
  }

  function wrapText(tn) {
    var m = /^([\s\S]*?\S)(\s*)\*(\s*)$/.exec(tn.nodeValue);
    if (!m) return;
    var before = m[1];
    // ต้องมีตัวอักษรจริงก่อนดอกจัน (กันเคสนิพจน์/คูณ) และไม่ใช่ดอกจันซ้อน
    if (/[*+\-\/=<>]$/.test(before)) return;
    var span = document.createElement('span');
    span.className = CLS;
    span.textContent = '*';
    tn.nodeValue = before + (m[2] ? ' ' : '');
    tn.parentNode.insertBefore(span, tn.nextSibling);
    if (m[3]) tn.parentNode.insertBefore(document.createTextNode(m[3]), span.nextSibling);
  }

  function scan(root) {
    if (!root || !root.querySelectorAll) return;
    var labels = root.matches && root.matches('label,legend') ? [root] : [];
    labels = labels.concat([].slice.call(root.querySelectorAll('label,legend')));
    labels.forEach(function (lb) {
      // ข้อความของ label เอง (ไม่ลงไปใน input/select ภายใน)
      var kids = [].slice.call(lb.childNodes);
      kids.forEach(function (n) {
        if (n.nodeType === 3 && !isSkippable(n)) wrapText(n);
      });
      // <span>*</span> ล้วน ๆ ที่ไม่มี class
      [].slice.call(lb.querySelectorAll('span,b,i,small,em,strong')).forEach(function (el) {
        if (el.children.length === 0 && el.textContent.trim() === '*' && !el.classList.contains(CLS)) {
          el.classList.add(CLS);
        }
      });
    });
  }

  var queued = false;
  function later() {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(function () {
      queued = false;
      scan(document.body);
    });
  }

  function start() {
    scan(document.body);
    try {
      new MutationObserver(later).observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
