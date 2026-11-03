// Injected into the page after axe-core and window.__a11y_cfg (profile patterns).
// Uses axe.commons for role and accessible-name computation. Every function returns plain JSON.
window.__a11y = (() => {
  const cfg = window.__a11y_cfg || {};
  const anyOf = (list) => (list && list.length ? new RegExp(list.map((p) => `(?:${p})`).join('|')) : /$^/);
  const VOLATILE_CLASS = anyOf(cfg.volatile_class_patterns);
  const VOLATILE_ID = anyOf(cfg.volatile_id_patterns);
  const INTERACTIVE = new Set(['button', 'link', 'checkbox', 'radio', 'combobox', 'textbox', 'searchbox', 'menuitem',
    'menuitemcheckbox', 'menuitemradio', 'tab', 'switch', 'option', 'slider', 'spinbutton', 'listbox', 'treeitem']);
  const FIELDS = new Set(['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton']);
  const NATIVE_FOCUS = 'a[href],button,input,select,textarea,summary,iframe,[contenteditable="true"],audio[controls],video[controls]';

  const shown = (el) => !!el && el.checkVisibility({opacityProperty: true, visibilityProperty: true}) &&
    el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0;
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  function selector(el) {
    if (el.id && !VOLATILE_ID.test(el.id) && document.querySelectorAll('#' + CSS.escape(el.id)).length === 1) return '#' + CSS.escape(el.id);
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement; n = n.parentElement) {
      let part = n.localName;
      const cls = [...n.classList].filter((c) => !VOLATILE_CLASS.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map(CSS.escape).join('.');
      const sib = n.parentElement ? [...n.parentElement.children].filter((c) => c.localName === n.localName) : [];
      if (sib.length > 1) part += `:nth-of-type(${sib.indexOf(n) + 1})`;
      parts.unshift(part);
      const s = parts.join(' > ');
      if (document.querySelectorAll(s).length === 1) return s;
    }
    return parts.join(' > ');
  }
  const html = (el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 800);
  const box = (el) => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height}; };
  const info = (el) => ({selector: selector(el), html: html(el), box: box(el)});

  let ready = false;
  function setup() { if (ready) axe.teardown(); axe.setup(document.documentElement); ready = true; }
  const role = (el) => axe.commons.aria.getRole(el) || null;
  const name = (el) => { const v = axe.utils.getNodeFromTree(el); return v ? axe.commons.text.accessibleTextVirtual(v).trim() : ''; };
  const exposed = (el) => !el.closest('[aria-hidden="true"],[inert]');
  function* ancestors(el) { for (let a = el; a && a !== document.body; a = a.parentElement) yield a; }

  function interactive() {
    setup();
    return [...document.querySelectorAll('body *')].filter((el) => INTERACTIVE.has(role(el)) && shown(el) && exposed(el));
  }

  // Visible text that labels a control: own text for buttons/links/tabs; associated label for fields.
  function visibleLabel(el, r) {
    if (FIELDS.has(r) || r === 'checkbox' || r === 'radio' || r === 'switch' || r === 'slider') {
      const sources = new Set();
      for (const l of el.labels || []) if (shown(l)) sources.add(l);
      const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
      for (const id of ids) { const t = document.getElementById(id); if (t && shown(t)) sources.add(t); }
      const wrap = el.closest('label'); if (wrap && shown(wrap)) sources.add(wrap); // each label counted once
      return [...sources].map((t) => t.innerText).join(' ').trim();
    }
    return (el.innerText || '').trim();
  }

  // Visible text positioned as a label next to a field (left or above, within a short distance).
  function adjacentLabel(el) {
    const b = el.getBoundingClientRect();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      if (!t.textContent.trim() || el.contains(t)) continue;
      const p = t.parentElement; if (!shown(p)) continue;
      // text inside another control is that control's label, not this field's
      if ([...ancestors(p)].some((a) => INTERACTIVE.has(role(a)))) continue;
      // text sharing a container with other controls (a table row, a toolbar) labels those, not this field
      const box2 = p.parentElement;
      if (box2 && !box2.contains(el) && [...box2.querySelectorAll('*')].some((d) => INTERACTIVE.has(role(d)))) continue;
      const range = document.createRange(); range.selectNodeContents(t);
      const r = range.getBoundingClientRect();
      const left = r.right <= b.left + 2 && b.left - r.right < 32 && Math.abs((r.top + r.bottom) / 2 - (b.top + b.bottom) / 2) < b.height / 2;
      const above = r.bottom <= b.top + 2 && b.top - r.bottom < 24 && Math.abs(r.left - b.left) < 16;
      if (left || above) return t.textContent.trim();
    }
    return '';
  }

  function treeChecks() {
    const els = interactive();
    const out = [];
    const groups = new Map();
    for (const el of els) {
      const r = role(el), n = name(el), vis = visibleLabel(el, r);
      if (!n) {
        const title = r === 'button' ? 'Button: Button does not have a name'
          : FIELDS.has(r) ? 'Form field: Form field is missing an accessible name' : 'Accessible name missing';
        out.push({title, ...info(el), data: {role: r}});
      } else if (vis && norm(vis).length > 1 && !/^\p{N}+$/u.test(norm(vis))) {
        const nv = norm(vis), nn = norm(n);
        if (!(' ' + nn + ' ').includes(' ' + nv + ' ')) {
          const allWords = nv.split(' ').every((w) => nn.split(' ').includes(w));
          out.push({title: allWords ? 'Accessible name has interspersed words' : 'Accessible name does not contain visible label',
            ...info(el), data: {role: r, name: n, visible: vis.slice(0, 120)}});
        }
      }
      if (n && ['button', 'link', 'combobox', 'menuitem', 'textbox', 'checkbox', 'switch', 'tab'].includes(r)) {
        const k = r + '|' + norm(n);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(el);
      }
      // a popup listbox is labelled by the control that opens it; only form fields need their own visible label
      if (FIELDS.has(r) && !(r === 'listbox' && el.localName !== 'select') && !visibleLabel(el, r) && !adjacentLabel(el)) {
        const ph = el.getAttribute('placeholder');
        const title = ph ? 'Label is not persistent'
          : (r === 'combobox' || r === 'listbox') ? 'Select or dropdown control missing a visible label' : 'Visible label missing';
        out.push({title, ...info(el), data: {role: r, name: n, placeholder: ph}});
      }
    }
    for (const [k, list] of groups) {
      if (list.length < 2) continue;
      const hrefs = new Set(list.map((e) => e.getAttribute('href')).filter(Boolean));
      if (k.startsWith('link|') && hrefs.size < 2) continue;
      out.push({title: 'Controls have same name but different actions', ...info(list[0]),
        data: {role: k.split('|')[0], name: name(list[0]), count: list.length, others: list.slice(1, 4).map(selector)}});
    }
    // Heading order
    let prev = null;
    for (const h of document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"]')) {
      if (!shown(h) || !exposed(h)) continue;
      const lvl = parseInt(h.getAttribute('aria-level') || h.localName.slice(1), 10) || 2;
      if (prev !== null && lvl > prev + 1) out.push({title: 'Heading levels are out of order', ...info(h), data: {level: lvl, previous: prev}});
      prev = lvl;
    }
    return out;
  }

  // Clickable-looking elements that keyboard users cannot reach.
  function keyboardChecks() {
    setup();
    const out = [];
    const focusable = (el) => (el.matches(NATIVE_FOCUS) && !el.disabled) || el.tabIndex >= 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!shown(el) || !exposed(el) || el.matches('label, label *, option')) continue;
      const pointer = getComputedStyle(el).cursor === 'pointer' || el.hasAttribute('onclick');
      if (!pointer) continue;
      const parent = el.parentElement;
      if (parent && getComputedStyle(parent).cursor === 'pointer') continue; // report the outermost element only
      if (focusable(el) || el.parentElement?.closest(NATIVE_FOCUS + ',[tabindex]:not([tabindex="-1"])')) continue;
      if ([...el.querySelectorAll('*')].some((d) => focusable(d) && shown(d))) continue;
      // Roving tabindex: items of a composite widget (tabs, menus, trees, grids, listboxes, toolbars) are reached
      // with the arrow keys, so tabindex=-1 on inactive items is correct when another item in the widget is tabbable.
      const widget = el.closest('[role=tablist],[role=menu],[role=menubar],[role=tree],[role=grid],[role=treegrid],[role=listbox],[role=radiogroup],[role=toolbar]');
      if (widget && widget !== el && [...widget.querySelectorAll('[tabindex="0"],[tabindex]:not([tabindex="-1"])')].some((d) => d !== el && shown(d))) continue;
      const r = role(el), n = name(el);
      out.push({title: 'Function cannot be performed by keyboard alone', ...info(el), data: {role: r, name: n}});
      if (!INTERACTIVE.has(r)) {
        out.push({title: n ? 'Button: Button does not have a role' : 'Button: Button is missing both a role and a name', ...info(el), data: {role: r, name: n}});
      }
    }
    return out;
  }

  function tabbables() {
    return [...document.querySelectorAll('body *')].filter((el) => el.tabIndex >= 0 && shown(el) && !el.disabled).length;
  }

  // State of the focused element during the focus walk.
  function focusState() {
    const el = document.activeElement;
    if (!el || el === document.body || el === document.documentElement) return null;
    const r = el.getBoundingClientRect();
    const pts = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]
      .map(([fx, fy]) => [r.left + r.width * fx, r.top + r.height * fy]);
    const inView = r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
    const covered = inView ? pts.filter(([x, y]) => {
      const top = document.elementFromPoint(x, y);
      return top && !(el === top || el.contains(top) || top.contains(el));
    }).length : 0;
    let anc = el.parentElement; const chain = [];
    while (anc && anc !== document.body) { chain.push(selector(anc)); anc = anc.parentElement; }
    return {...info(el), visible: shown(el), area: r.width * r.height, inView, covered, points: pts.length,
      text: (el.innerText || '').trim().slice(0, 60), ancestors: chain.slice(0, 8)};
  }

  // Interactive elements and text blocks visible at the current viewport (for reflow/zoom comparison).
  function layoutSnapshot() {
    setup();
    const items = {};
    for (const el of interactive()) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let reachable = true;
      const sx = document.documentElement.scrollWidth > innerWidth + 2;
      if (r.right > innerWidth + 1 || r.left < -1) reachable = sx; // off-screen sideways: only reachable by horizontal scroll
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (/(hidden|clip)/.test(s.overflowX + s.overflowY)) {
          const ar = a.getBoundingClientRect();
          if (cx < ar.left || cx > ar.right || cy < ar.top || cy > ar.bottom) { reachable = false; break; }
        }
      }
      items[selector(el)] = {role: role(el), name: name(el).slice(0, 80), html: html(el), box: box(el), reachable};
    }
    const texts = [...document.querySelectorAll('body *')].filter((el) => shown(el) &&
      [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()));
    const overlaps = [];
    const rects = texts.slice(0, 1500).map((el) => [el, el.getBoundingClientRect()]);
    for (let i = 0; i < rects.length && overlaps.length < 50; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [a, ra] = rects[i], [b, rb] = rects[j];
        if (a.contains(b) || b.contains(a)) continue;
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 2 && h > 2 && w * h > 0.2 * Math.min(ra.width * ra.height, rb.width * rb.height)) {
          overlaps.push({a: info(a), b: selector(b)});
          break;
        }
      }
    }
    return {width: innerWidth, scrollWidth: document.documentElement.scrollWidth, items, overlaps};
  }

  // Text elements whose content is clipped (overflow hidden/clip or ellipsis).
  function clipped() {
    const res = {};
    for (const el of document.querySelectorAll('body *')) {
      if (!shown(el) || ![...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim())) continue;
      const s = getComputedStyle(el);
      const hides = /(hidden|clip)/.test(s.overflowX + s.overflowY) || s.textOverflow === 'ellipsis';
      if (hides && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) res[selector(el)] = html(el);
    }
    return res;
  }

  // ---- Exploration: what can be acted on, what is open, what text is visible ----
  const DIALOG = 'dialog[open],[role="dialog"],[role="alertdialog"]';
  const POPUP = '[role="menu"],[role="listbox"],[role="tree"],[role="tooltip"],[role="grid"]';
  const LIVE = '[aria-live]:not([aria-live="off"]),[role="status"],[role="alert"],[role="log"],output';

  function inventory() {
    setup();
    const seen = new Set();
    const items = [];
    const add = (el, kind) => {
      if (seen.has(el)) return;
      seen.add(el);
      const r = role(el);
      items.push({selector: selector(el), kind, role: r, name: name(el).slice(0, 60) || (el.innerText || '').trim().slice(0, 40),
        tag: el.localName, html: html(el).slice(0, 400), disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true', expanded: el.getAttribute('aria-expanded'), haspopup: el.getAttribute('aria-haspopup'),
        href: el.getAttribute('href'), title: el.getAttribute('title'), inDialog: !!el.closest(DIALOG), editable: el.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,[contenteditable="true"],[role="textbox"],[role="searchbox"],[role="combobox"]')});
    };
    // Controls count even when visually transparent (custom checkboxes draw an image over an opacity-0 input).
    const sized = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && el.checkVisibility({visibilityProperty: true}); };
    for (const el of document.querySelectorAll('body *')) if (INTERACTIVE.has(role(el)) && sized(el) && exposed(el)) add(el, 'control');
    for (const el of document.querySelectorAll('body *')) {
      if (seen.has(el) || !shown(el) || !exposed(el)) continue;
      const st = getComputedStyle(el);
      if ((st.cursor === 'pointer' || el.hasAttribute('onclick')) && !el.matches('label') && !(el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer')
        && ![...seen].some((s) => s.contains(el) || el.contains(s))) add(el, 'clickable');
      else if ((el.hasAttribute('title') || el.hasAttribute('aria-describedby') || el.hasAttribute('data-tooltip')) && !el.closest('a,button')) add(el, 'hover');
      else if (el.tabIndex >= 0 && !el.matches(NATIVE_FOCUS) && ![...seen].some((x) => x.contains(el))) add(el, 'focusable');
    }
    const open = [...document.querySelectorAll(`${DIALOG},${POPUP}`)].filter(shown).map((el) => ({selector: selector(el), role: el.getAttribute('role') || el.localName, name: name(el).slice(0, 60)}));
    const sig = location.pathname + location.hash + '|' + open.map((o) => o.role + ':' + o.name).join(',') + '|' + items.map((i) => i.role + ':' + i.name).sort().join(',');
    let h = 0; for (let i = 0; i < sig.length; i++) h = (h * 31 + sig.charCodeAt(i)) | 0;
    return {url: location.href, title: document.title, signature: (h >>> 0).toString(36), open, items, active: document.activeElement && document.activeElement !== document.body ? selector(document.activeElement) : null};
  }

  // Visible text blocks keyed by selector, with whether they sit in a live region / dialog / popup.
  function textBlocks() {
    const out = {};
    for (const el of document.querySelectorAll('body *')) {
      // visible text, exposed to assistive tech or not, so text behind a closing modal is not "new"
      if (!shown(el)) continue;
      const own = [...el.childNodes].filter((c) => c.nodeType === 3).map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (own.length < 2) continue;
      // Labels, list items and control text are content, not status messages.
      const content = !!el.closest('label,li,[role="listitem"],[role="row"],button,a,select,option,[role="option"],[role="menuitem"]');
      // error or hint text a field points to with aria-describedby / aria-errormessage is read with that field
      const described = [...ancestors(el)].some((a) => a.id && document.querySelector(`[aria-describedby~="${CSS.escape(a.id)}"],[aria-errormessage="${CSS.escape(a.id)}"]`));
      out[selector(el)] = {text: own.slice(0, 200), live: !!el.closest(LIVE), container: !!el.closest(`${DIALOG},${POPUP}`), content, described, exposed: exposed(el), html: html(el), box: box(el)};
    }
    return out;
  }

  function dialogState(sel) {
    const d = document.querySelector(sel);
    if (!d) return null;
    const active = document.activeElement;
    const modalAttr = d.getAttribute('aria-modal') === 'true' || (d.localName === 'dialog' && d.matches(':modal'));
    const others = [...document.body.children].filter((c) => !c.contains(d) && shown(c));
    const backgroundHidden = others.every((c) => c.inert || c.getAttribute('aria-hidden') === 'true');
    // Visually modal: a layer outside the dialog covers the page corners (a backdrop).
    const corners = [[4, 4], [innerWidth - 4, 4], [4, innerHeight - 4], [innerWidth - 4, innerHeight - 4]];
    const backdrop = corners.filter(([x, y]) => { const t = document.elementFromPoint(x, y); if (!t || d.contains(t)) return false;
      const r = t.getBoundingClientRect(); return r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9 && getComputedStyle(t).position === 'fixed'; }).length >= 3;
    return {focusInside: !!active && d.contains(active), modal: modalAttr, backgroundHidden, backdrop, ...info(d), name: name(d)};
  }

  function describes(triggerSel, popupText) {
    const t = document.querySelector(triggerSel);
    if (!t) return true;
    setup();
    const ids = ((t.getAttribute('aria-describedby') || '') + ' ' + (t.getAttribute('aria-labelledby') || '')).split(/\s+/).filter(Boolean);
    const refText = ids.map((id) => document.getElementById(id)?.textContent || '').join(' ');
    const desc = name(t) + ' ' + refText;
    return norm(desc).includes(norm(popupText).slice(0, 40));
  }

  const present = (sel) => { const el = document.querySelector(sel); return !!el && shown(el); };
  const activeSelector = () => (document.activeElement && document.activeElement !== document.body ? selector(document.activeElement) : null);

  return {treeChecks, keyboardChecks, tabbables, focusState, layoutSnapshot, clipped,
    inventory, textBlocks, dialogState, describes, present, activeSelector};
})();
