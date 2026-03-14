/* ========================================
   IMG-CORPUS LITE — Single file app
   One image, annotate, comment, export
   ======================================== */
(function () {
'use strict';

// ========== STATE ==========
var S = {
    image: null,        // {name, dataUrl, metadata, tags, notes, annotations, canvasObjects}
    categories: [],
    annotationLevels: ['Nivel 1', 'Nivel 2', 'Nivel 3'],
    activeTool: 'select',
    activeCategory: null,
    canvasBg: '#111118',
};

var canvas = null, currentZoom = 1;
var isDrawing = false, drawStart = null, tempShape = null;

// ========== HELPERS ==========
function uid() { return Date.now().toString(36) + Math.random().toString(36).substr(2, 6); }
function esc(s) { return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : ''; }
function catColor(id) { var c = S.categories.find(function (x) { return x.id === id; }); return c ? c.color : '#888'; }
function hasCats() { return S.categories.length > 0; }
function cA(h, a) { if (!h || h.charAt(0) !== '#') return 'rgba(136,136,136,' + a + ')'; return 'rgba(' + parseInt(h.slice(1, 3), 16) + ',' + parseInt(h.slice(3, 5), 16) + ',' + parseInt(h.slice(5, 7), 16) + ',' + a + ')'; }
function isInput() { var t = document.activeElement; if (!t) return false; var n = t.tagName.toLowerCase(); return n === 'input' || n === 'textarea' || n === 'select' || t.isContentEditable; }

function toast(msg) {
    var c = document.getElementById('toastContainer');
    var el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = '<span class="material-symbols-outlined">check_circle</span>' + msg;
    c.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('visible'); });
    setTimeout(function () { el.classList.remove('visible'); setTimeout(function () { el.remove(); }, 250); }, 2500);
}

function openModal(id) { document.getElementById(id).classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

// ========== IMAGE LOADING ==========
function loadImage(file) {
    if (!file || !file.type.startsWith('image/')) return;
    var r = new FileReader();
    r.onload = function (ev) {
        S.image = {
            name: file.name, dataUrl: ev.target.result,
            metadata: { source: '', author: '', date: '', medium: '', context: '' },
            tags: [], notes: [], annotations: [], canvasObjects: []
        };
        document.getElementById('imageName').textContent = file.name;
        loadImageToCanvas();
        renderAll();
        toast('Imagen cargada.');
    };
    r.readAsDataURL(file);
}

function loadImageToCanvas() {
    if (!canvas || !S.image) return;
    canvas.clear();
    canvas.setBackgroundColor(S.canvasBg, canvas.renderAll.bind(canvas));

    fabric.Image.fromURL(S.image.dataUrl, function (img) {
        var el = document.getElementById('canvasContainer'), cw = el.clientWidth, ch = el.clientHeight;
        var sc = Math.min(cw * 0.9 / img.width, ch * 0.9 / img.height, 1);
        img.set({ left: cw / 2, top: ch / 2, originX: 'center', originY: 'center', scaleX: sc, scaleY: sc, selectable: false, evented: false, hoverCursor: 'default' });
        canvas.setBackgroundImage(img, function () {
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            currentZoom = 1; updZoom();

            if (S.image.canvasObjects && S.image.canvasObjects.length) {
                fabric.util.enlivenObjects(S.image.canvasObjects, function (objs) {
                    objs.forEach(function (o) { canvas.add(o); });
                    rebuildBadges();
                    canvas.renderAll();
                });
            } else {
                rebuildBadges();
                canvas.renderAll();
            }
            document.getElementById('canvasEmpty').classList.add('hidden');
        });
    }, { crossOrigin: 'anonymous' });
}

function saveCanvasState() {
    if (!canvas || !S.image) return;
    S.image.canvasObjects = canvas.getObjects()
        .filter(function (o) { return !o._isBadge; })
        .map(function (o) { return o.toObject(['annotationId', 'annotationNumber', 'categoryId', 'isAnnotation']); });

    canvas.getObjects().filter(function (o) { return o._isBadge; }).forEach(function (b) {
        var ann = (S.image.annotations || []).find(function (a) { return a.id === b.annotationId; });
        if (ann && ann.badges) {
            var bb = ann.badges.find(function (x) { return x.uid === b._badgeUid; });
            if (bb) { bb.x = b.left; bb.y = b.top; }
        }
    });
}

// ========== CANVAS INIT ==========
function initCanvas() {
    var el = document.getElementById('canvasContainer'), rect = el.getBoundingClientRect();
    canvas = new fabric.Canvas('mainCanvas', {
        width: rect.width, height: rect.height - 4,
        backgroundColor: S.canvasBg, selection: true, preserveObjectStacking: true
    });

    window.addEventListener('resize', function () {
        var r = el.getBoundingClientRect();
        if (r.width > 0) { canvas.setWidth(r.width); canvas.setHeight(r.height - 4); canvas.renderAll(); }
    });

    canvas.on('mouse:down', onDown);
    canvas.on('mouse:move', onMove);
    canvas.on('mouse:up', onUp);
    canvas.on('path:created', function (o) { if (S.activeTool === 'freedraw') finalize(o.path); });
    canvas.on('object:modified', function (o) {
        if (o.target && o.target.annotationId && !o.target._isBadge) { reposBadge(o.target); saveCanvasState(); }
    });
    canvas.on('selection:created', onSel);
    canvas.on('selection:updated', onSel);
    canvas.on('selection:cleared', function () {
        document.querySelectorAll('.ann-item').forEach(function (e) { e.classList.remove('selected'); });
    });

    // Zoom
    canvas.on('mouse:wheel', function (o) {
        var z = canvas.getZoom() * (0.999 ** o.e.deltaY);
        z = Math.min(Math.max(0.1, z), 10);
        canvas.zoomToPoint({ x: o.e.offsetX, y: o.e.offsetY }, z);
        currentZoom = z; updZoom();
        o.e.preventDefault(); o.e.stopPropagation();
    });

    // Pan
    var pan = false, ps = null, spacePan = false;
    canvas.on('mouse:down', function (o) {
        if (o.e.altKey || o.e.button === 1 || spacePan) {
            pan = true; ps = { x: o.e.clientX, y: o.e.clientY };
            el.classList.add('panning-active'); canvas.selection = false;
        }
    });
    canvas.on('mouse:move', function (o) {
        if (!pan) return;
        var v = canvas.viewportTransform;
        v[4] += o.e.clientX - ps.x; v[5] += o.e.clientY - ps.y;
        ps = { x: o.e.clientX, y: o.e.clientY };
        canvas.requestRenderAll();
    });
    canvas.on('mouse:up', function () {
        if (pan) { pan = false; el.classList.remove('panning-active'); if (!spacePan) applyTool(S.activeTool); }
    });

    document.addEventListener('keydown', function (e) {
        if (e.code === 'Space' && !e.repeat && !isInput()) {
            e.preventDefault(); spacePan = true; el.classList.add('panning');
            canvas.selection = false; canvas.forEachObject(function (o) { o.selectable = false; });
        }
    });
    document.addEventListener('keyup', function (e) {
        if (e.code === 'Space' && spacePan) {
            spacePan = false; el.classList.remove('panning'); el.classList.remove('panning-active');
            applyTool(S.activeTool);
        }
    });

    // Hover highlight: canvas → panel
    canvas.on('mouse:over', function (o) {
        if (o.target && o.target.annotationId && !o.target._isBadge) {
            document.querySelectorAll('.ann-item').forEach(function (el) {
                el.classList.toggle('hover-highlight', el.dataset.ann === o.target.annotationId);
            });
        }
    });
    canvas.on('mouse:out', function () {
        document.querySelectorAll('.ann-item.hover-highlight').forEach(function (el) { el.classList.remove('hover-highlight'); });
    });
}

// ========== TOOLS ==========
function applyTool(t) {
    if (!canvas) return;
    canvas.isDrawingMode = false; canvas.selection = true;
    canvas.defaultCursor = 'default'; canvas.hoverCursor = 'move';
    canvas.forEachObject(function (o) { if (!o._isBadge) o.selectable = true; });

    if (t === 'freedraw') {
        if (!hasCats()) { openModal('modalCategory'); setTool('select'); return; }
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = catColor(S.activeCategory);
        canvas.freeDrawingBrush.width = 3; canvas.selection = false;
    } else if (t !== 'select') {
        canvas.defaultCursor = 'crosshair'; canvas.selection = false;
        canvas.forEachObject(function (o) { o.selectable = false; });
    }
}

function setTool(t) {
    S.activeTool = t;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(function (b) {
        b.classList.toggle('active', b.dataset.tool === t);
    });
    applyTool(t);
}

function ptr(e) { return canvas.getPointer(e.e); }

function onDown(opt) {
    var t = S.activeTool;
    if (t === 'select' || t === 'freedraw') return;
    if (!hasCats()) { openModal('modalCategory'); return; }
    var p = ptr(opt);

    if (t === 'marker') { mkMarker(p.x, p.y); return; }
    if (t === 'text') { mkText(p.x, p.y); return; }

    isDrawing = true; drawStart = p;
    var c = catColor(S.activeCategory);

    if (t === 'rect') {
        tempShape = new fabric.Rect({ left: p.x, top: p.y, width: 0, height: 0, fill: cA(c, .12), stroke: c, strokeWidth: 2, strokeDashArray: [6, 3], selectable: false });
        canvas.add(tempShape);
    } else if (t === 'ellipse') {
        tempShape = new fabric.Ellipse({ left: p.x, top: p.y, rx: 0, ry: 0, fill: cA(c, .12), stroke: c, strokeWidth: 2, strokeDashArray: [6, 3], selectable: false });
        canvas.add(tempShape);
    } else if (t === 'arrow') {
        tempShape = new fabric.Line([p.x, p.y, p.x, p.y], { stroke: c, strokeWidth: 2.5, selectable: false });
        canvas.add(tempShape);
    }
}

function onMove(opt) {
    if (!isDrawing || !tempShape) return;
    var p = ptr(opt), t = S.activeTool;
    if (t === 'rect') tempShape.set({ left: Math.min(drawStart.x, p.x), top: Math.min(drawStart.y, p.y), width: Math.abs(p.x - drawStart.x), height: Math.abs(p.y - drawStart.y) });
    else if (t === 'ellipse') tempShape.set({ left: Math.min(drawStart.x, p.x), top: Math.min(drawStart.y, p.y), rx: Math.abs(p.x - drawStart.x) / 2, ry: Math.abs(p.y - drawStart.y) / 2 });
    else if (t === 'arrow') tempShape.set({ x2: p.x, y2: p.y });
    canvas.renderAll();
}

function onUp(opt) {
    if (!isDrawing) return; isDrawing = false;
    var t = S.activeTool, p = ptr(opt);
    if (t === 'rect' || t === 'ellipse') {
        if (Math.abs(p.x - drawStart.x) < 5 && Math.abs(p.y - drawStart.y) < 5) { canvas.remove(tempShape); tempShape = null; return; }
        finalize(tempShape);
    } else if (t === 'arrow') {
        var dx = p.x - drawStart.x, dy = p.y - drawStart.y;
        if (Math.sqrt(dx * dx + dy * dy) < 10) { canvas.remove(tempShape); tempShape = null; return; }
        canvas.remove(tempShape);
        var ar = mkArrow(drawStart.x, drawStart.y, p.x, p.y);
        canvas.add(ar); finalize(ar);
    }
    tempShape = null;
}

function mkArrow(x1, y1, x2, y2) {
    var c = catColor(S.activeCategory), a = Math.atan2(y2 - y1, x2 - x1), hl = 16, ha = Math.PI / 7;
    var hx1 = x2 - hl * Math.cos(a - ha), hy1 = y2 - hl * Math.sin(a - ha);
    var hx2 = x2 - hl * Math.cos(a + ha), hy2 = y2 - hl * Math.sin(a + ha);
    return new fabric.Path('M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 + ' M ' + hx1 + ' ' + hy1 + ' L ' + x2 + ' ' + y2 + ' L ' + hx2 + ' ' + hy2, {
        fill: '', stroke: c, strokeWidth: 2.5, strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true
    });
}

function mkText(x, y) {
    var inp = prompt('Texto (máx. 5 palabras):');
    if (!inp || !inp.trim()) return;
    var w = inp.trim().split(/\s+/).slice(0, 5).join(' ');
    var c = catColor(S.activeCategory);
    var t = new fabric.IText(w, { left: x, top: y, fontFamily: 'IBM Plex Sans,sans-serif', fontSize: 16, fontWeight: '600', fill: c, stroke: '#000', strokeWidth: .3, selectable: true, editable: false });
    canvas.add(t); finalize(t);
}

function mkMarker(x, y) {
    if (!S.image) return;
    var cat = S.activeCategory, c = catColor(cat);
    var id = uid(), num = (S.image.annotations ? S.image.annotations.length : 0) + 1, bu = uid();
    canvas.add(mkBadge(x, y, num, c, id, bu));
    canvas.renderAll();
    if (!S.image.annotations) S.image.annotations = [];
    S.image.annotations.push({ id: id, number: num, categoryId: cat, levels: {}, type: 'marker', badges: [{ uid: bu, x: x, y: y }], _pending: true });
    saveCanvasState(); renderAnnotations();
    autoFocus(id);
}

function finalize(shape) {
    if (!S.image) return;
    var id = uid(), num = (S.image.annotations ? S.image.annotations.length : 0) + 1;
    var cat = S.activeCategory, c = catColor(cat);
    shape.set({ annotationId: id, annotationNumber: num, categoryId: cat, isAnnotation: true, selectable: true });
    var b = shape.getBoundingRect(), bx = b.left + b.width + 6, by = b.top - 6, bu = uid();
    canvas.add(mkBadge(bx, by, num, c, id, bu));
    canvas.renderAll();
    if (!S.image.annotations) S.image.annotations = [];
    S.image.annotations.push({ id: id, number: num, categoryId: cat, levels: {}, type: S.activeTool, badges: [{ uid: bu, x: bx, y: by }], _pending: true });
    saveCanvasState(); renderAnnotations();
    autoFocus(id);
}

function mkBadge(x, y, n, c, aid, buid) {
    var ci = new fabric.Circle({ radius: 12, fill: c, originX: 'center', originY: 'center' });
    var tx = new fabric.Text(String(n), { fontSize: 11, fontFamily: 'IBM Plex Mono,monospace', fontWeight: '700', fill: '#0d0d12', originX: 'center', originY: 'center' });
    return new fabric.Group([ci, tx], { left: x, top: y, selectable: false, evented: false, hoverCursor: 'default', _isBadge: true, _badgeUid: buid, annotationId: aid });
}

function rebuildBadges() {
    if (!S.image || !S.image.annotations) return;
    S.image.annotations.forEach(function (a) {
        var c = catColor(a.categoryId);
        (a.badges || []).forEach(function (b) { canvas.add(mkBadge(b.x, b.y, a.number, c, a.id, b.uid)); });
    });
}

function reposBadge(shape) {
    if (!shape.annotationId) return;
    var b = shape.getBoundingRect(), bx = b.left + b.width + 6, by = b.top - 6;
    var badge = canvas.getObjects().find(function (o) { return o._isBadge && o.annotationId === shape.annotationId; });
    if (badge) {
        badge.set({ left: bx, top: by }); badge.setCoords();
        if (S.image) {
            var ann = (S.image.annotations || []).find(function (a) { return a.id === shape.annotationId; });
            if (ann && ann.badges) { var bb = ann.badges.find(function (x) { return x.uid === badge._badgeUid; }); if (bb) { bb.x = bx; bb.y = by; } }
        }
    }
}

function autoFocus(annId) {
    setTimeout(function () {
        var d = document.querySelector('.ann-note-display[data-ann="' + annId + '"]');
        if (d) d.click();
    }, 120);
}

function onSel(opt) {
    var obj = opt.selected && opt.selected[0];
    if (obj && obj.annotationId) {
        document.querySelectorAll('.ann-item').forEach(function (e) {
            e.classList.toggle('selected', e.dataset.ann === obj.annotationId);
        });
    }
}

function deleteSelected() {
    if (!canvas) return;
    var active = canvas.getActiveObjects();
    if (!active.length) return;
    active.forEach(function (obj) {
        if (obj.annotationId) {
            canvas.getObjects().filter(function (o) { return o.annotationId === obj.annotationId; }).forEach(function (o) { canvas.remove(o); });
            if (S.image && S.image.annotations) S.image.annotations = S.image.annotations.filter(function (a) { return a.id !== obj.annotationId; });
        }
        canvas.remove(obj);
    });
    canvas.discardActiveObject(); canvas.renderAll();
    saveCanvasState(); renderAnnotations();
}

function updateAnnotationColors(annId, catId) {
    if (!canvas) return;
    var c = catColor(catId);
    canvas.getObjects().forEach(function (o) {
        if (o.annotationId !== annId) return;
        if (o._isBadge) { if (o._objects && o._objects[0]) o._objects[0].set('fill', c); }
        else { if (o.stroke) o.set('stroke', c); if (o.fill && o.fill !== '' && o.type !== 'path') o.set('fill', cA(c, .12)); }
        o.categoryId = catId;
    });
    canvas.renderAll(); saveCanvasState();
}

function updZoom() { document.getElementById('zoomLevel').textContent = Math.round(currentZoom * 100) + '%'; }

// ========== RENDER ALL ==========
function renderAll() {
    renderCategories();
    updateCategorySelect();
    renderAnnotations();
    renderNotes();
    renderMetadata();
    renderTags();
    renderLevels();
}

// ========== CATEGORIES ==========
function renderCategories() {
    var c = document.getElementById('categoriesList');
    if (!S.categories.length) { c.innerHTML = '<p style="color:var(--t3);font-size:10px;padding:3px 0">Sin categorías. Crea una para empezar a anotar.</p>'; return; }
    c.innerHTML = S.categories.map(function (cat) {
        return '<div class="category-item"><span class="cat-dot" style="background:' + cat.color + '"></span><span class="cat-name">' + esc(cat.name) + '</span><button class="cat-rm" data-id="' + cat.id + '">&times;</button></div>';
    }).join('');
    c.querySelectorAll('.cat-rm').forEach(function (b) {
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            S.categories = S.categories.filter(function (x) { return x.id !== b.dataset.id; });
            if (S.activeCategory === b.dataset.id) S.activeCategory = S.categories.length ? S.categories[0].id : null;
            renderCategories(); updateCategorySelect();
        });
    });
}

function updateCategorySelect() {
    var sel = document.getElementById('toolCategory');
    sel.innerHTML = S.categories.length
        ? S.categories.map(function (c) { return '<option value="' + c.id + '">' + esc(c.name) + '</option>'; }).join('')
        : '<option value="" disabled>Crea una categoría</option>';
    if (S.activeCategory) sel.value = S.activeCategory;
}

// ========== NOTES ==========
function renderNotes() {
    var c = document.getElementById('notesList');
    if (!S.image) { c.innerHTML = '<p style="color:var(--t3);font-size:10px">Carga una imagen.</p>'; return; }
    if (!S.image.notes) S.image.notes = [];
    if (!S.image.notes.length) { c.innerHTML = '<p style="color:var(--t3);font-size:10px">Sin notas. Usa + para agregar.</p>'; return; }

    c.innerHTML = S.image.notes.map(function (note, idx) {
        var empty = !note.text.trim();
        return '<div class="note-item" data-note="' + note.id + '">' +
            '<div class="note-item-hdr"><span class="note-item-label">Nota ' + (idx + 1) + '</span>' +
            '<button class="note-item-rm" data-note="' + note.id + '">&times;</button></div>' +
            '<div class="note-display' + (empty ? ' empty' : '') + '" data-note="' + note.id + '">' + (empty ? 'Clic para escribir...' : esc(note.text)) + '</div>' +
            '<textarea class="note-textarea hidden" data-note="' + note.id + '">' + esc(note.text) + '</textarea></div>';
    }).join('');

    wireNoteEditing(c);
}

function wireNoteEditing(c) {
    c.querySelectorAll('.note-display[data-note]').forEach(function (el) {
        el.addEventListener('click', function () {
            var ta = c.querySelector('textarea[data-note="' + el.dataset.note + '"]');
            if (!ta) return; el.classList.add('hidden'); ta.classList.remove('hidden'); ta.focus();
        });
    });
    c.querySelectorAll('.note-textarea[data-note]').forEach(function (el) {
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } });
        el.addEventListener('blur', function () {
            var note = S.image.notes.find(function (n) { return n.id === el.dataset.note; });
            if (note) note.text = el.value;
            renderNotes();
        });
    });
    c.querySelectorAll('.note-item-rm').forEach(function (b) {
        b.addEventListener('click', function (e) {
            e.stopPropagation();
            S.image.notes = S.image.notes.filter(function (n) { return n.id !== b.dataset.note; });
            renderNotes();
        });
    });
}

// ========== ANNOTATIONS ==========
function renderAnnotations() {
    var container = document.getElementById('annList');
    var countEl = document.getElementById('annCount');
    if (!S.image || !S.image.annotations || !S.image.annotations.length) {
        container.innerHTML = '<p style="color:var(--t3);font-size:11px;padding:4px 0">Sin anotaciones. Usa las herramientas del toolbar.</p>';
        countEl.textContent = '0'; return;
    }
    countEl.textContent = S.image.annotations.length;
    var levels = S.annotationLevels;

    container.innerHTML = S.image.annotations.map(function (ann) {
        var cat = S.categories.find(function (x) { return x.id === ann.categoryId; });
        var cc = cat ? cat.color : '#888';
        var catOpts = S.categories.map(function (c) {
            return '<option value="' + c.id + '"' + (c.id === ann.categoryId ? ' selected' : '') + '>' + esc(c.name) + '</option>';
        }).join('');

        var fieldsHTML = levels.map(function (lvl) {
            var val = ann.levels[lvl] || '';
            var empty = !val.trim();
            return '<div class="ann-field"><div class="ann-field-label">' + esc(lvl) + '</div>' +
                '<div class="ann-note-display' + (empty ? ' empty' : '') + '" data-ann="' + ann.id + '" data-key="' + esc(lvl) + '">' + (empty ? 'Clic para escribir...' : esc(val)) + '</div>' +
                '<textarea class="ann-note-edit hidden" data-ann="' + ann.id + '" data-key="' + esc(lvl) + '">' + esc(val) + '</textarea></div>';
        }).join('');

        return '<div class="ann-item" data-ann="' + ann.id + '" style="border-left-color:' + cc + '">' +
            '<div class="ann-hdr"><span class="ann-num" style="background:' + cc + '">' + ann.number + '</span>' +
            '<select class="ann-cat-sel" data-ann="' + ann.id + '">' + catOpts + '</select>' +
            '<button class="ann-del" data-ann="' + ann.id + '"><span class="material-symbols-outlined">close</span></button></div>' +
            fieldsHTML + '</div>';
    }).join('');

    wireAnnotationEditing(container);
    wireAnnotationHover();
}

function wireAnnotationEditing(c) {
    // Display → edit
    c.querySelectorAll('.ann-note-display').forEach(function (el) {
        el.addEventListener('click', function (e) {
            e.stopPropagation();
            var ta = c.querySelector('textarea[data-ann="' + el.dataset.ann + '"][data-key="' + el.dataset.key + '"]');
            if (!ta) return; el.classList.add('hidden'); ta.classList.remove('hidden'); ta.focus();
        });
    });

    // Edit fields
    c.querySelectorAll('.ann-note-edit').forEach(function (el) {
        el.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
            if (e.key === 'Tab') {
                e.preventDefault(); el.blur();
                var all = Array.from(c.querySelectorAll('.ann-note-edit'));
                var idx = all.indexOf(el);
                var next = e.shiftKey ? all[idx - 1] : all[idx + 1];
                if (next) {
                    var disp = c.querySelector('.ann-note-display[data-ann="' + next.dataset.ann + '"][data-key="' + next.dataset.key + '"]');
                    if (disp) setTimeout(function () { disp.click(); }, 50);
                }
            }
        });
        el.addEventListener('blur', function () {
            var ann = S.image.annotations.find(function (a) { return a.id === el.dataset.ann; });
            if (!ann) return;
            ann.levels[el.dataset.key] = el.value;

            if (ann._pending) {
                var allEmpty = S.annotationLevels.every(function (lvl) { return !(ann.levels[lvl] || '').trim(); });
                if (allEmpty) {
                    if (canvas) { canvas.getObjects().filter(function (o) { return o.annotationId === ann.id; }).forEach(function (o) { canvas.remove(o); }); canvas.renderAll(); }
                    S.image.annotations = S.image.annotations.filter(function (a) { return a.id !== ann.id; });
                    saveCanvasState(); renderAnnotations(); return;
                }
                delete ann._pending;
            }
            saveCanvasState();
            var disp = c.querySelector('.ann-note-display[data-ann="' + el.dataset.ann + '"][data-key="' + el.dataset.key + '"]');
            if (disp) { var t = el.value.trim(); disp.textContent = t || 'Clic para escribir...'; disp.classList.toggle('empty', !t); disp.classList.remove('hidden'); }
            el.classList.add('hidden');
        });
    });

    // Category change
    c.querySelectorAll('.ann-cat-sel').forEach(function (el) {
        el.addEventListener('change', function () {
            var ann = S.image.annotations.find(function (a) { return a.id === el.dataset.ann; });
            if (!ann) return;
            ann.categoryId = el.value;
            updateAnnotationColors(ann.id, el.value);
            renderAnnotations();
        });
    });

    // Delete
    c.querySelectorAll('.ann-del').forEach(function (el) {
        el.addEventListener('click', function () {
            if (canvas) { canvas.getObjects().filter(function (o) { return o.annotationId === el.dataset.ann; }).forEach(function (o) { canvas.remove(o); }); canvas.renderAll(); }
            S.image.annotations = S.image.annotations.filter(function (a) { return a.id !== el.dataset.ann; });
            saveCanvasState(); renderAnnotations();
        });
    });

    // Click annotation → select on canvas
    c.querySelectorAll('.ann-item').forEach(function (el) {
        el.addEventListener('click', function (e) {
            if (e.target.closest('.ann-note-display,.ann-note-edit,.ann-cat-sel,.ann-del')) return;
            if (!canvas) return;
            var obj = canvas.getObjects().find(function (o) { return o.annotationId === el.dataset.ann && !o._isBadge; });
            if (obj) { canvas.setActiveObject(obj); canvas.renderAll(); }
        });
    });
}

function wireAnnotationHover() {
    document.querySelectorAll('.ann-item').forEach(function (el) {
        el.addEventListener('mouseenter', function () {
            if (!canvas) return;
            canvas.getObjects().forEach(function (obj) {
                if (obj.annotationId === el.dataset.ann && !obj._isBadge) {
                    obj._origSW = obj.strokeWidth;
                    obj.set({ strokeWidth: (obj.strokeWidth || 2) + 2 });
                }
            }); canvas.renderAll();
        });
        el.addEventListener('mouseleave', function () {
            if (!canvas) return;
            canvas.getObjects().forEach(function (obj) {
                if (obj.annotationId === el.dataset.ann && !obj._isBadge && obj._origSW !== undefined) {
                    obj.set({ strokeWidth: obj._origSW }); delete obj._origSW;
                }
            }); canvas.renderAll();
        });
    });
}

// ========== METADATA ==========
function renderMetadata() {
    var c = document.getElementById('metaFields');
    if (!S.image) { c.innerHTML = '<p style="color:var(--t3);font-size:10px">Carga una imagen.</p>'; return; }
    var fields = [
        { key: 'source', label: 'Fuente' }, { key: 'author', label: 'Autor' },
        { key: 'date', label: 'Fecha' }, { key: 'medium', label: 'Medio' },
        { key: 'context', label: 'Contexto', multi: true }
    ];
    c.innerHTML = fields.map(function (f) {
        var val = S.image.metadata[f.key] || '';
        if (f.multi) return '<div class="mf"><label>' + f.label + '</label><textarea data-key="' + f.key + '" placeholder="' + f.label + '...">' + esc(val) + '</textarea></div>';
        return '<div class="mf"><label>' + f.label + '</label><input type="text" data-key="' + f.key + '" value="' + esc(val) + '" placeholder="' + f.label + '..."></div>';
    }).join('');
    c.querySelectorAll('input,textarea').forEach(function (el) {
        el.addEventListener('input', function () { S.image.metadata[el.dataset.key] = el.value; });
    });
}

// ========== TAGS ==========
function renderTags() {
    var c = document.getElementById('tagsCloud');
    if (!S.image) { c.innerHTML = ''; return; }
    c.innerHTML = (S.image.tags || []).map(function (t) {
        return '<span class="tag-chip">' + esc(t) + '<button class="tag-rm" data-tag="' + esc(t) + '">&times;</button></span>';
    }).join('');
    c.querySelectorAll('.tag-rm').forEach(function (b) {
        b.addEventListener('click', function () {
            S.image.tags = S.image.tags.filter(function (t) { return t !== b.dataset.tag; });
            renderTags();
        });
    });
}

function addTag() {
    if (!S.image) return;
    var raw = document.getElementById('tagInput').value.trim().toLowerCase();
    if (!raw) return;
    raw.split(',').map(function (t) { return t.trim(); }).filter(Boolean)
        .forEach(function (t) { if (S.image.tags.indexOf(t) < 0) S.image.tags.push(t); });
    document.getElementById('tagInput').value = '';
    renderTags();
}

// ========== LEVELS ==========
function renderLevels() {
    var c = document.getElementById('levelsList');
    c.innerHTML = S.annotationLevels.map(function (lvl, idx) {
        return '<div class="level-item"><span class="level-name" contenteditable="true" data-idx="' + idx + '">' + esc(lvl) + '</span>' +
            '<button class="level-rm" data-idx="' + idx + '">&times;</button></div>';
    }).join('');

    c.querySelectorAll('.level-name').forEach(function (el) {
        el.addEventListener('blur', function () {
            var idx = parseInt(el.dataset.idx), old = S.annotationLevels[idx], nw = el.textContent.trim();
            if (!nw || nw === old) { el.textContent = old; return; }
            S.annotationLevels[idx] = nw;
            if (S.image) (S.image.annotations || []).forEach(function (a) {
                if (a.levels && a.levels[old] !== undefined) { a.levels[nw] = a.levels[old]; delete a.levels[old]; }
            });
            renderAnnotations();
        });
        el.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    });

    c.querySelectorAll('.level-rm').forEach(function (b) {
        b.addEventListener('click', function () {
            if (S.annotationLevels.length <= 1) { alert('Debe haber al menos un nivel.'); return; }
            var idx = parseInt(b.dataset.idx), name = S.annotationLevels[idx];
            if (!confirm('¿Eliminar nivel "' + name + '"?')) return;
            S.annotationLevels.splice(idx, 1);
            if (S.image) (S.image.annotations || []).forEach(function (a) { if (a.levels) delete a.levels[name]; });
            renderLevels(); renderAnnotations();
        });
    });
}

// ========== EXPORT ==========
function exportJSON() {
    if (!S.image) { alert('Carga una imagen primero.'); return; }
    saveCanvasState();
    var data = {
        _schema: 'img-corpus-lite-v1',
        exportDate: new Date().toISOString(),
        annotationLevels: S.annotationLevels,
        categories: S.categories,
        image: {
            name: S.image.name, metadata: S.image.metadata,
            tags: S.image.tags,
            notes: (S.image.notes || []).map(function (n) { return n.text; }),
            annotations: (S.image.annotations || []).map(function (a) {
                var cat = S.categories.find(function (x) { return x.id === a.categoryId; });
                return { number: a.number, category: cat ? cat.name : '', type: a.type, levels: a.levels || {} };
            })
        }
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'img-corpus-lite_' + S.image.name.replace(/\.[^.]+$/, '') + '.json';
    a.click(); URL.revokeObjectURL(a.href);
    toast('JSON exportado.');
}

function exportReport() {
    if (!S.image) { alert('Carga una imagen primero.'); return; }
    saveCanvasState();

    var snapUrl = canvas ? canvas.toDataURL({ format: 'png', multiplier: 1.5 }) : S.image.dataUrl;
    var date = new Date().toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });
    var img = S.image;

    var metaHTML = '';
    var mf = [['Fuente', img.metadata.source], ['Autor', img.metadata.author], ['Fecha', img.metadata.date], ['Medio', img.metadata.medium], ['Contexto', img.metadata.context]];
    mf = mf.filter(function (f) { return f[1]; });
    if (mf.length) metaHTML = '<table class="meta">' + mf.map(function (f) { return '<tr><td class="ml">' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td></tr>'; }).join('') + '</table>';

    var tagsHTML = img.tags.length ? '<div class="tags">' + img.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join(' ') + '</div>' : '';

    var notesHTML = '';
    (img.notes || []).forEach(function (n, i) {
        if (n.text.trim()) notesHTML += '<div class="note"><strong>Nota ' + (i + 1) + ':</strong><br>' + esc(n.text).replace(/\n/g, '<br>') + '</div>';
    });

    var annHTML = '';
    if (img.annotations && img.annotations.length) {
        annHTML = '<h3>Anotaciones</h3>';
        img.annotations.forEach(function (ann) {
            var cat = S.categories.find(function (x) { return x.id === ann.categoryId; });
            annHTML += '<div class="ann"><span class="ann-n" style="background:' + (cat ? cat.color : '#888') + '">' + ann.number + '</span><div class="ann-body">';
            if (cat) annHTML += '<span class="ann-cat">' + esc(cat.name) + '</span>';
            S.annotationLevels.forEach(function (lvl) {
                var val = ann.levels[lvl];
                if (val && val.trim()) annHTML += '<div class="ann-f"><em>' + esc(lvl) + ':</em> ' + esc(val) + '</div>';
            });
            annHTML += '</div></div>';
        });
    }

    var html = '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' + esc(img.name) + ' — img-corpus lite</title><style>' +
        '@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap");' +
        '*{box-sizing:border-box;margin:0;padding:0}body{font-family:"IBM Plex Sans",sans-serif;color:#1a1a2e;background:#fff;line-height:1.6;padding:40px;max-width:860px;margin:0 auto}' +
        'h1{font-size:22px;margin-bottom:4px}h3{font-size:16px;margin:16px 0 8px;padding-bottom:4px;border-bottom:1px solid #ddd}' +
        '.sub{color:#888;font-size:12px;font-family:"IBM Plex Mono",monospace;margin-bottom:16px}' +
        '.img-frame{margin:16px 0;text-align:center}.img-frame img{max-width:100%;height:auto;border:1px solid #e0e0e0;border-radius:4px}' +
        '.meta{width:100%;margin-bottom:12px;border-collapse:collapse;font-size:13px}.meta td{padding:3px 8px;border-bottom:1px solid #f0f0f0}.ml{font-weight:600;color:#555;width:100px;text-transform:uppercase;font-size:11px;letter-spacing:.3px}' +
        '.tags{margin-bottom:12px;display:flex;flex-wrap:wrap;gap:4px}.tag{background:#e8f5f3;color:#2a8a80;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:500}' +
        '.note{background:#f8f8fc;padding:10px;border-radius:6px;margin-bottom:10px;font-size:13px}' +
        '.ann{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px}' +
        '.ann-n{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;color:#fff;font-size:11px;font-weight:700;font-family:"IBM Plex Mono",monospace;flex-shrink:0}' +
        '.ann-body{flex:1}.ann-cat{font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#888;font-weight:600}.ann-f{margin-top:3px}.ann-f em{color:#666;font-style:italic}' +
        '.foot{margin-top:30px;padding-top:10px;border-top:1px solid #ddd;font-size:11px;color:#999;font-family:"IBM Plex Mono",monospace;text-align:center}' +
        '@media print{body{padding:20px}}' +
        '</style></head><body>' +
        '<h1>' + esc(img.name) + '</h1>' +
        '<div class="sub">' + date + ' · img-corpus lite</div>' +
        '<div class="img-frame"><img src="' + snapUrl + '"></div>' +
        metaHTML + tagsHTML + notesHTML + annHTML +
        '<div class="foot">Generado con img-corpus lite · ' + date + '</div>' +
        '<script>var b=document.createElement("button");b.textContent="Guardar como PDF";b.style.cssText="position:fixed;bottom:16px;right:16px;padding:8px 16px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;cursor:pointer;font:600 13px sans-serif;z-index:999";b.onclick=function(){window.print()};document.body.appendChild(b)<\/script>' +
        '</body></html>';

    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'informe_' + img.name.replace(/\.[^.]+$/, '') + '.html';
    a.click(); URL.revokeObjectURL(a.href);
    toast('Informe HTML generado.');
}

// ========== RESIZE HANDLE ==========
function initResize() {
    var handle = document.getElementById('resizeRight');
    var panel = document.getElementById('rightPanel');
    var startX, startW;
    handle.addEventListener('mousedown', function (e) {
        e.preventDefault(); startX = e.clientX; startW = panel.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
        function onMove(e) {
            var nw = startW - (e.clientX - startX);
            panel.style.width = Math.max(200, Math.min(500, nw)) + 'px';
            if (canvas) { var r = document.getElementById('canvasContainer').getBoundingClientRect(); canvas.setWidth(r.width); canvas.setHeight(r.height - 4); canvas.renderAll(); }
        }
        function onUp() {
            handle.classList.remove('dragging'); document.body.style.cursor = ''; document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
        }
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
}

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', function () {
    initCanvas();
    initResize();

    // Tabs
    document.querySelectorAll('.rpanel-tab').forEach(function (tab) {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.rpanel-tab').forEach(function (t) { t.classList.remove('active'); });
            document.querySelectorAll('.rpanel-content').forEach(function (p) { p.classList.remove('active'); });
            tab.classList.add('active');
            var id = 'rp' + tab.dataset.rp.charAt(0).toUpperCase() + tab.dataset.rp.slice(1);
            var el = document.getElementById(id);
            if (el) el.classList.add('active');
        });
    });

    // Modals
    document.querySelectorAll('.modal-x').forEach(function (b) {
        b.addEventListener('click', function () { b.closest('.modal-overlay').classList.remove('active'); });
    });
    document.querySelectorAll('.modal-overlay').forEach(function (o) {
        o.addEventListener('click', function (e) { if (e.target === o) o.classList.remove('active'); });
    });

    // File input
    var fileInput = document.getElementById('fileInput');
    document.getElementById('btnUpload').addEventListener('click', function () { fileInput.click(); });
    document.getElementById('btnChangeImage').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) { if (e.target.files.length) loadImage(e.target.files[0]); e.target.value = ''; });

    // Drop zone: entire canvas area
    var cw = document.getElementById('canvasContainer');
    cw.addEventListener('dragover', function (e) { e.preventDefault(); cw.classList.add('drag-over'); });
    cw.addEventListener('dragleave', function () { cw.classList.remove('drag-over'); });
    cw.addEventListener('drop', function (e) { e.preventDefault(); cw.classList.remove('drag-over'); if (e.dataTransfer.files.length) loadImage(e.dataTransfer.files[0]); });
    // Also on empty state click
    document.getElementById('canvasEmpty').addEventListener('click', function (e) {
        if (e.target.closest('.btn')) return;
        fileInput.click();
    });

    // Toolbar
    document.querySelectorAll('.tool-btn[data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
    document.getElementById('btnZoomIn').addEventListener('click', function () { if (!canvas) return; currentZoom = Math.min(currentZoom * 1.2, 10); canvas.setZoom(currentZoom); updZoom(); });
    document.getElementById('btnZoomOut').addEventListener('click', function () { if (!canvas) return; currentZoom = Math.max(currentZoom / 1.2, 0.1); canvas.setZoom(currentZoom); updZoom(); });
    document.getElementById('btnZoomFit').addEventListener('click', function () { if (!canvas) return; canvas.setViewportTransform([1, 0, 0, 1, 0, 0]); currentZoom = 1; updZoom(); });
    document.getElementById('btnDeleteSel').addEventListener('click', deleteSelected);

    // BG toggle
    document.querySelectorAll('.bg-btn').forEach(function (b) {
        b.addEventListener('click', function () {
            document.querySelectorAll('.bg-btn').forEach(function (x) { x.classList.remove('active'); }); b.classList.add('active');
            S.canvasBg = b.dataset.bg;
            if (canvas) canvas.setBackgroundColor(b.dataset.bg, canvas.renderAll.bind(canvas));
        });
    });

    // Category select
    document.getElementById('toolCategory').addEventListener('change', function (e) { S.activeCategory = e.target.value; });

    // Category modal
    document.getElementById('btnAddCategory').addEventListener('click', function () {
        document.getElementById('catName').value = '';
        document.getElementById('catColor').value = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        openModal('modalCategory');
        setTimeout(function () { document.getElementById('catName').focus(); }, 100);
    });
    document.getElementById('btnCatApply').addEventListener('click', function () {
        var name = document.getElementById('catName').value.trim(), color = document.getElementById('catColor').value;
        if (!name) return;
        var cat = { id: 'cat-' + uid(), name: name, color: color };
        S.categories.push(cat); S.activeCategory = cat.id;
        renderCategories(); updateCategorySelect();
        closeModal('modalCategory');
        toast('Categoría "' + name + '" creada.');
    });

    // Notes
    document.getElementById('btnAddNote').addEventListener('click', function () {
        if (!S.image) return;
        if (!S.image.notes) S.image.notes = [];
        var note = { id: uid(), text: '' };
        S.image.notes.push(note);
        renderNotes();
        setTimeout(function () { var d = document.querySelector('.note-display[data-note="' + note.id + '"]'); if (d) d.click(); }, 50);
    });

    // Levels
    document.getElementById('btnAddLevel').addEventListener('click', function () {
        var name = prompt('Nombre del nuevo nivel:');
        if (!name || !name.trim()) return;
        name = name.trim();
        if (S.annotationLevels.indexOf(name) >= 0) { alert('Ya existe.'); return; }
        S.annotationLevels.push(name);
        renderLevels(); renderAnnotations();
        toast('Nivel "' + name + '" agregado.');
    });

    // Tags
    document.getElementById('btnAddTag').addEventListener('click', addTag);
    document.getElementById('tagInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') addTag(); });

    // Export
    document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
    document.getElementById('btnExportReport').addEventListener('click', exportReport);

    // Keyboard
    document.addEventListener('keydown', function (e) {
        if (isInput()) return;
        if (e.code === 'Space') return;
        if (e.ctrlKey || e.metaKey) return;
        switch (e.key.toLowerCase()) {
            case 'v': setTool('select'); break; case 'r': setTool('rect'); break;
            case 'e': setTool('ellipse'); break; case 'd': setTool('freedraw'); break;
            case 'a': setTool('arrow'); break; case 't': setTool('text'); break;
            case 'm': setTool('marker'); break; case 'escape': setTool('select'); break;
            case 'delete': case 'backspace': deleteSelected(); break;
        }
    });

    // Initial render
    renderAll();
});

})();
