/* ========================================
   IMG-CORPUS \u2014 Annotator (v2 rewrite)
   Fabric.js canvas, drawing tools, annotations
   
   Architecture:
   - Badges are NOT serialized. Recreated from annotation data.
   - Each annotation stores badges[] with {uid, x, y}.
   - saveCurrentCanvasState only saves non-badge objects.
   - Shapes link to annotations via annotationId.
   ======================================== */

(function() {

let canvas = null;
let currentZoom = 1;
let isDrawing = false;
let drawStart = null;
let tempShape = null;

// Polygon state
let polyPoints = [];
let polyLines = [];
let polyDots = [];

// ========== CANVAS INIT ==========
IC.initCanvas = function() {
    const container = document.getElementById('canvasContainer');
    const rect = container.getBoundingClientRect();

    canvas = new fabric.Canvas('mainCanvas', {
        width: rect.width,
        height: rect.height - 4,
        backgroundColor: (IC.state.canvasBg || '#111118'),
        selection: true,
        preserveObjectStacking: true,
    });
    IC.canvas = canvas;

    window.addEventListener('resize', function() {
        var r = container.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
            canvas.setWidth(r.width);
            canvas.setHeight(r.height - 4);
            canvas.renderAll();
        }
    });

    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    canvas.on('selection:created', onSelectionChanged);
    canvas.on('selection:updated', onSelectionChanged);
    canvas.on('selection:cleared', onSelectionCleared);

    canvas.on('path:created', function(opt) {
        if (IC.state.activeTool !== 'freedraw') return;
        finalizeShape(opt.path);
    });

    // When shape moves, reposition its badge
    canvas.on('object:modified', function(opt) {
        var obj = opt.target;
        if (obj && obj.annotationId && !obj._isBadge) {
            repositionBadge(obj);
            IC.saveCurrentCanvasState();
        }
    });

    // Wheel zoom
    canvas.on('mouse:wheel', function(opt) {
        var delta = opt.e.deltaY;
        var zoom = canvas.getZoom();
        zoom *= 0.999 ** delta;
        zoom = Math.min(Math.max(0.1, zoom), 10);
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        currentZoom = zoom;
        updateZoomDisplay();
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    // Pan with Alt+drag
    var isPanning = false, panStart = null;
    canvas.on('mouse:down', function(opt) {
        if (opt.e.altKey || opt.e.button === 1) {
            isPanning = true;
            panStart = { x: opt.e.clientX, y: opt.e.clientY };
            canvas.defaultCursor = 'grabbing';
            canvas.selection = false;
        }
    });
    canvas.on('mouse:move', function(opt) {
        if (!isPanning) return;
        var vpt = canvas.viewportTransform;
        vpt[4] += opt.e.clientX - panStart.x;
        vpt[5] += opt.e.clientY - panStart.y;
        panStart = { x: opt.e.clientX, y: opt.e.clientY };
        canvas.requestRenderAll();
    });
    canvas.on('mouse:up', function() {
        if (isPanning) { isPanning = false; IC.applyTool(IC.state.activeTool); }
    });
};

// ========== LOAD IMAGE ==========
// NOTE: caller must save canvas state BEFORE changing currentImageId
IC.loadImageToCanvas = function(imgData) {
    if (!canvas) return;

    canvas.clear();
    canvas.setBackgroundColor((IC.state.canvasBg || '#111118'), canvas.renderAll.bind(canvas));
    cancelPolygon();

    fabric.Image.fromURL(imgData.dataUrl, function(img) {
        var el = document.getElementById('canvasContainer');
        var cw = el.clientWidth, ch = el.clientHeight;
        var scale = Math.min((cw * 0.9) / img.width, (ch * 0.9) / img.height, 1);

        img.set({
            left: cw / 2, top: ch / 2,
            originX: 'center', originY: 'center',
            scaleX: scale, scaleY: scale,
            selectable: false, evented: false, hoverCursor: 'default',
        });

        canvas.setBackgroundImage(img, function() {
            canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
            currentZoom = 1;
            updateZoomDisplay();

            if (imgData.canvasObjects && imgData.canvasObjects.length > 0) {
                fabric.util.enlivenObjects(imgData.canvasObjects, function(objects) {
                    objects.forEach(function(o) { canvas.add(o); });
                    recreateBadges(imgData);
                    canvas.renderAll();
                });
            } else {
                recreateBadges(imgData);
                canvas.renderAll();
            }
            IC.showCanvasEmpty(false);
        });
    }, { crossOrigin: 'anonymous' });
};

// ========== SAVE CANVAS STATE ==========
IC.saveCurrentCanvasState = function() {
    if (!canvas || !IC.state.currentImageId) return;
    var img = IC.getCurrentImage();
    if (!img) return;

    // Save only non-badge objects
    img.canvasObjects = canvas.getObjects()
        .filter(function(o) { return !o._isBadge && !o._isPolyTemp; })
        .map(function(o) {
            return o.toObject(['annotationId', 'annotationNumber', 'categoryId', 'isAnnotation']);
        });

    // Update badge positions from canvas
    canvas.getObjects().filter(function(o) { return o._isBadge; }).forEach(function(badge) {
        var ann = (img.annotations || []).find(function(a) { return a.id === badge.annotationId; });
        if (ann && ann.badges) {
            var b = ann.badges.find(function(bb) { return bb.uid === badge._badgeUid; });
            if (b) { b.x = badge.left; b.y = badge.top; }
        }
    });
};

// ========== RECREATE BADGES ==========
function recreateBadges(imgData) {
    if (!imgData.annotations) return;
    imgData.annotations.forEach(function(ann) {
        var color = IC.getCategoryColor(ann.categoryId);
        (ann.badges || []).forEach(function(b) {
            canvas.add(makeBadge(b.x, b.y, ann.number, color, ann.id, b.uid));
        });
    });
}

// ========== TOOL APPLICATION ==========
IC.applyTool = function(tool) {
    if (!canvas) return;
    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.defaultCursor = 'default';
    canvas.hoverCursor = 'move';
    canvas.forEachObject(function(o) { if (!o._isBadge) o.selectable = true; });

    var ms = document.getElementById('markerNumberSelect');
    ms.classList.toggle('hidden', tool !== 'marker');
    if (tool === 'marker') IC.updateMarkerSelect();

    if (tool !== 'polygon' && polyPoints.length > 0) cancelPolygon();

    if (tool === 'freedraw') {
        if (!IC.hasCategories()) { IC.openModal('modalAddCategory'); IC.setTool('select'); return; }
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = IC.getCategoryColor(IC.state.activeCategory);
        canvas.freeDrawingBrush.width = 3;
        canvas.selection = false;
    } else if (tool !== 'select') {
        canvas.defaultCursor = 'crosshair';
        canvas.selection = false;
        canvas.forEachObject(function(o) { o.selectable = false; });
    }
};

// ========== MOUSE EVENTS ==========
function ptr(e) { return canvas.getPointer(e.e); }

function onMouseDown(opt) {
    var tool = IC.state.activeTool;
    if (tool === 'select' || tool === 'freedraw') return;
    if (!IC.hasCategories()) { IC.openModal('modalAddCategory'); return; }

    var p = ptr(opt);

    if (tool === 'polygon') { handlePolygonClick(p); return; }
    if (tool === 'marker')  { createMarkerAtPoint(p.x, p.y); return; }
    if (tool === 'text')    { createTextAtPoint(p.x, p.y); return; }

    isDrawing = true;
    drawStart = p;
    var color = IC.getCategoryColor(IC.state.activeCategory);

    if (tool === 'rect') {
        tempShape = new fabric.Rect({
            left: p.x, top: p.y, width: 0, height: 0,
            fill: colorAlpha(color, 0.12), stroke: color,
            strokeWidth: 2, strokeDashArray: [6, 3], selectable: false,
        });
        canvas.add(tempShape);
    } else if (tool === 'ellipse') {
        tempShape = new fabric.Ellipse({
            left: p.x, top: p.y, rx: 0, ry: 0,
            fill: colorAlpha(color, 0.12), stroke: color,
            strokeWidth: 2, strokeDashArray: [6, 3], selectable: false,
        });
        canvas.add(tempShape);
    } else if (tool === 'arrow') {
        tempShape = new fabric.Line([p.x, p.y, p.x, p.y], {
            stroke: color, strokeWidth: 2.5, selectable: false,
        });
        canvas.add(tempShape);
    }
}

function onMouseMove(opt) {
    if (!isDrawing || !tempShape) return;
    var p = ptr(opt), tool = IC.state.activeTool;

    if (tool === 'rect') {
        tempShape.set({
            left: Math.min(drawStart.x, p.x), top: Math.min(drawStart.y, p.y),
            width: Math.abs(p.x - drawStart.x), height: Math.abs(p.y - drawStart.y),
        });
    } else if (tool === 'ellipse') {
        tempShape.set({
            left: Math.min(drawStart.x, p.x), top: Math.min(drawStart.y, p.y),
            rx: Math.abs(p.x - drawStart.x) / 2, ry: Math.abs(p.y - drawStart.y) / 2,
        });
    } else if (tool === 'arrow') {
        tempShape.set({ x2: p.x, y2: p.y });
    }
    canvas.renderAll();
}

function onMouseUp(opt) {
    if (!isDrawing) return;
    isDrawing = false;
    var tool = IC.state.activeTool, p = ptr(opt);

    if (tool === 'rect' || tool === 'ellipse') {
        if (Math.abs(p.x - drawStart.x) < 5 && Math.abs(p.y - drawStart.y) < 5) {
            canvas.remove(tempShape); tempShape = null; return;
        }
        finalizeShape(tempShape);
    } else if (tool === 'arrow') {
        var dx = p.x - drawStart.x, dy = p.y - drawStart.y;
        if (Math.sqrt(dx * dx + dy * dy) < 10) {
            canvas.remove(tempShape); tempShape = null; return;
        }
        canvas.remove(tempShape);
        var arrow = makeArrowPath(drawStart.x, drawStart.y, p.x, p.y);
        canvas.add(arrow);
        finalizeShape(arrow);
    }
    tempShape = null;
}

// ========== ARROW PATH ==========
function makeArrowPath(x1, y1, x2, y2) {
    var color = IC.getCategoryColor(IC.state.activeCategory);
    var angle = Math.atan2(y2 - y1, x2 - x1);
    var hl = 16, ha = Math.PI / 7;
    var hx1 = x2 - hl * Math.cos(angle - ha), hy1 = y2 - hl * Math.sin(angle - ha);
    var hx2 = x2 - hl * Math.cos(angle + ha), hy2 = y2 - hl * Math.sin(angle + ha);

    return new fabric.Path(
        'M ' + x1 + ' ' + y1 + ' L ' + x2 + ' ' + y2 +
        ' M ' + hx1 + ' ' + hy1 + ' L ' + x2 + ' ' + y2 + ' L ' + hx2 + ' ' + hy2,
        { fill: '', stroke: color, strokeWidth: 2.5,
          strokeLineCap: 'round', strokeLineJoin: 'round', selectable: true }
    );
}

// ========== POLYGON ==========
function handlePolygonClick(p) {
    var color = IC.getCategoryColor(IC.state.activeCategory);

    if (polyPoints.length >= 3) {
        var dx = p.x - polyPoints[0].x, dy = p.y - polyPoints[0].y;
        if (Math.sqrt(dx * dx + dy * dy) < 15) { closePolygon(); return; }
    }

    polyPoints.push({ x: p.x, y: p.y });

    var dot = new fabric.Circle({
        left: p.x, top: p.y, originX: 'center', originY: 'center',
        radius: 4, fill: color, selectable: false, evented: false, _isPolyTemp: true,
    });
    canvas.add(dot); polyDots.push(dot);

    if (polyPoints.length > 1) {
        var prev = polyPoints[polyPoints.length - 2];
        var line = new fabric.Line([prev.x, prev.y, p.x, p.y], {
            stroke: color, strokeWidth: 2, strokeDashArray: [6, 3],
            selectable: false, evented: false, _isPolyTemp: true,
        });
        canvas.add(line); polyLines.push(line);
    }
    canvas.renderAll();
}

function closePolygon() {
    polyDots.forEach(function(d) { canvas.remove(d); });
    polyLines.forEach(function(l) { canvas.remove(l); });

    var color = IC.getCategoryColor(IC.state.activeCategory);
    var poly = new fabric.Polygon(polyPoints.map(function(p) { return { x: p.x, y: p.y }; }), {
        fill: colorAlpha(color, 0.12), stroke: color,
        strokeWidth: 2, strokeDashArray: [6, 3], selectable: true,
    });
    canvas.add(poly);
    finalizeShape(poly);
    polyPoints = []; polyLines = []; polyDots = [];
}

function cancelPolygon() {
    polyDots.forEach(function(d) { canvas.remove(d); });
    polyLines.forEach(function(l) { canvas.remove(l); });
    polyPoints = []; polyLines = []; polyDots = [];
    if (canvas) canvas.renderAll();
}

// Close polygon on double-click
document.addEventListener('dblclick', function() {
    if (IC.state.activeTool === 'polygon' && polyPoints.length >= 3) closePolygon();
});

// ========== TEXT TOOL ==========
function createTextAtPoint(x, y) {
    var input = prompt('Texto (m\u00e1x. 5 palabras):');
    if (!input || !input.trim()) return;
    var words = input.trim().split(/\s+/).slice(0, 5).join(' ');
    var color = IC.getCategoryColor(IC.state.activeCategory);

    var text = new fabric.IText(words, {
        left: x, top: y,
        fontFamily: 'IBM Plex Sans, sans-serif',
        fontSize: 16, fontWeight: '600',
        fill: color, stroke: '#000', strokeWidth: 0.3,
        selectable: true, editable: false,
    });
    canvas.add(text);
    finalizeShape(text);
}

// ========== MARKER ==========
function createMarkerAtPoint(x, y) {
    var img = IC.getCurrentImage();
    if (!img) return;

    var sel = document.getElementById('markerNumberSelect').value;
    IC.pushUndo();
    var catId = IC.state.activeCategory, color = IC.getCategoryColor(catId);

    if (sel === 'new') {
        var annId = IC.uid();
        var annNum = (img.annotations ? img.annotations.length : 0) + 1;
        var bUid = IC.uid();

        canvas.add(makeBadge(x, y, annNum, color, annId, bUid));
        canvas.renderAll();

        if (!img.annotations) img.annotations = [];
        img.annotations.push({
            id: annId, number: annNum, categoryId: catId,
            note: '', type: 'marker',
            badges: [{ uid: bUid, x: x, y: y }],
            _pending: true,
        });
        IC.saveCurrentCanvasState();
        IC.renderAnnotationsPanel(img);
        IC.updateMarkerSelect();
        autoFocusNote(annId);
    } else {
        var ann = img.annotations.find(function(a) { return a.id === sel; });
        if (!ann) return;
        var bUid2 = IC.uid();
        canvas.add(makeBadge(x, y, ann.number, IC.getCategoryColor(ann.categoryId), ann.id, bUid2));
        canvas.renderAll();
        if (!ann.badges) ann.badges = [];
        ann.badges.push({ uid: bUid2, x: x, y: y });
        IC.saveCurrentCanvasState();
    }
}

// ========== FINALIZE SHAPE ==========
function finalizeShape(shape) {
    var img = IC.getCurrentImage();
    if (!img) return;
    IC.pushUndo();

    var annId = IC.uid();
    var annNum = (img.annotations ? img.annotations.length : 0) + 1;
    var catId = IC.state.activeCategory;
    var color = IC.getCategoryColor(catId);

    shape.set({
        annotationId: annId, annotationNumber: annNum,
        categoryId: catId, isAnnotation: true, selectable: true,
    });

    var bound = shape.getBoundingRect();
    var bx = bound.left + bound.width + 6, by = bound.top - 6;
    var bUid = IC.uid();

    canvas.add(makeBadge(bx, by, annNum, color, annId, bUid));
    canvas.renderAll();

    if (!img.annotations) img.annotations = [];
    img.annotations.push({
        id: annId, number: annNum, categoryId: catId,
        note: '', type: IC.state.activeTool,
        badges: [{ uid: bUid, x: bx, y: by }],
        _pending: true,
    });

    IC.saveCurrentCanvasState();
    IC.renderAnnotationsPanel(img);
    IC.updateMarkerSelect();
    autoFocusNote(annId);
}

// ========== MAKE BADGE ==========
function makeBadge(x, y, number, color, annId, uid) {
    var circle = new fabric.Circle({
        radius: 12, fill: color, originX: 'center', originY: 'center',
    });
    var text = new fabric.Text(String(number), {
        fontSize: 11, fontFamily: 'IBM Plex Mono, monospace', fontWeight: '700',
        fill: '#0d0d12', originX: 'center', originY: 'center',
    });
    return new fabric.Group([circle, text], {
        left: x, top: y,
        selectable: false, evented: false, hoverCursor: 'default',
        _isBadge: true, _badgeUid: uid, annotationId: annId,
    });
}

// ========== REPOSITION BADGE ==========
function repositionBadge(shape) {
    if (!shape.annotationId) return;
    var bound = shape.getBoundingRect();
    var bx = bound.left + bound.width + 6, by = bound.top - 6;

    var badge = canvas.getObjects().find(function(o) {
        return o._isBadge && o.annotationId === shape.annotationId;
    });
    if (badge) {
        badge.set({ left: bx, top: by }); badge.setCoords();
        var img = IC.getCurrentImage();
        if (img) {
            var ann = (img.annotations || []).find(function(a) { return a.id === shape.annotationId; });
            if (ann && ann.badges) {
                var b = ann.badges.find(function(bb) { return bb.uid === badge._badgeUid; });
                if (b) { b.x = bx; b.y = by; }
            }
        }
    }
}

// ========== MARKER SELECT ==========
IC.updateMarkerSelect = function() {
    var img = IC.getCurrentImage();
    var sel = document.getElementById('markerNumberSelect');
    if (!img || !sel) return;
    var prev = sel.value;
    var html = '<option value="new">+ Nuevo</option>';
    if (img.annotations && img.annotations.length > 0) {
        img.annotations.forEach(function(ann) {
            var cat = IC.getCategoryById(ann.categoryId);
            var cn = cat ? cat.name : '';
            var sn = ann.note ? (' \u2014 ' + ann.note.substring(0, 20)) : '';
            html += '<option value="' + ann.id + '">#' + ann.number + ' ' + cn + sn + '</option>';
        });
    }
    sel.innerHTML = html;
    if (img.annotations && img.annotations.find(function(a) { return a.id === prev; })) {
        sel.value = prev;
    } else { sel.value = 'new'; }
};

// ========== AUTO-FOCUS NOTE ==========
function autoFocusNote(annId) {
    setTimeout(function() {
        var d = document.querySelector('.note-display[data-ann-id="' + annId + '"]');
        if (d) d.click();
    }, 120);
}

// ========== DELETE SELECTED ==========
IC.deleteSelectedAnnotation = function() {
    if (!canvas) return;
    var active = canvas.getActiveObjects();
    if (active.length === 0) return;
    IC.pushUndo();
    var img = IC.getCurrentImage();
    if (!img) return;

    active.forEach(function(obj) {
        if (obj.annotationId) {
            canvas.getObjects().filter(function(o) { return o.annotationId === obj.annotationId; })
                .forEach(function(o) { canvas.remove(o); });
            if (img.annotations) {
                img.annotations = img.annotations.filter(function(a) { return a.id !== obj.annotationId; });
            }
        }
        canvas.remove(obj);
    });

    canvas.discardActiveObject();
    canvas.renderAll();
    IC.saveCurrentCanvasState();
    IC.renderAnnotationsPanel(img);
    IC.updateMarkerSelect();
};

// ========== SELECTION EVENTS ==========
function onSelectionChanged(opt) {
    var obj = opt.selected && opt.selected[0];
    if (obj && obj.annotationId) {
        document.querySelectorAll('.annotation-item').forEach(function(el) {
            el.classList.toggle('selected', el.dataset.annId === obj.annotationId);
        });
    }
}
function onSelectionCleared() {
    document.querySelectorAll('.annotation-item').forEach(function(el) { el.classList.remove('selected'); });
}

// ========== ZOOM ==========
IC.zoomIn = function() {
    if (!canvas) return;
    currentZoom = Math.min(currentZoom * 1.2, 10);
    canvas.setZoom(currentZoom); updateZoomDisplay();
};
IC.zoomOut = function() {
    if (!canvas) return;
    currentZoom = Math.max(currentZoom / 1.2, 0.1);
    canvas.setZoom(currentZoom); updateZoomDisplay();
};
IC.zoomFit = function() {
    if (!canvas) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    currentZoom = 1; updateZoomDisplay();
};
function updateZoomDisplay() {
    document.getElementById('zoomLevel').textContent = Math.round(currentZoom * 100) + '%';
}

// ========== RENDER ANNOTATIONS PANEL ==========
IC.renderAnnotationsPanel = function(img) {
    if (!img) return;
    var container = document.getElementById('annotationsList');
    var countEl = document.getElementById('annotationCount');

    if (IC.refreshGeneralNotes) IC.refreshGeneralNotes();
    if (IC.updateMarkerSelect) IC.updateMarkerSelect();

    if (!img.annotations || img.annotations.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0;">Sin anotaciones. Usa las herramientas para anotar.</p>';
        countEl.textContent = '0';
        return;
    }
    countEl.textContent = img.annotations.length;

    container.innerHTML = img.annotations.map(function(ann) {
        var cat = IC.getCategoryById(ann.categoryId);
        var catColor = cat ? cat.color : '#888';
        var catOpts = IC.state.categories.map(function(c) {
            return '<option value="' + c.id + '"' + (c.id === ann.categoryId ? ' selected' : '') + '>' + c.name + '</option>';
        }).join('');

        var nt = ann.note || '';
        var empty = !nt.trim();
        var disp = empty ? 'Clic para anotar...' : escHtml(nt);
        var cls = empty ? ' empty' : '';

        return '<div class="annotation-item" data-ann-id="' + ann.id + '" style="border-left-color:' + catColor + '">' +
            '<div class="annotation-header">' +
                '<span class="annotation-number" style="background:' + catColor + '">' + ann.number + '</span>' +
                '<select class="annotation-category-select" data-ann-id="' + ann.id + '">' + catOpts + '</select>' +
                '<button class="annotation-delete" data-ann-id="' + ann.id + '" title="Eliminar"><span class="material-symbols-outlined">close</span></button>' +
            '</div>' +
            '<div class="note-display' + cls + '" data-ann-id="' + ann.id + '">' + disp + '</div>' +
            '<textarea class="annotation-note hidden" data-ann-id="' + ann.id + '" placeholder="Nota...">' + escHtml(nt) + '</textarea>' +
            '<div class="note-edit-hint">Enter para guardar \u00b7 Shift+Enter para salto de l\u00ednea</div>' +
        '</div>';
    }).join('');

    // -- Note display/edit --
    container.querySelectorAll('.note-display').forEach(function(el) {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            var ta = container.querySelector('textarea.annotation-note[data-ann-id="' + el.dataset.annId + '"]');
            var hint = ta.nextElementSibling;
            el.classList.add('hidden');
            ta.classList.remove('hidden');
            hint.style.display = 'block';
            ta.focus();
        });
    });

    container.querySelectorAll('.annotation-note').forEach(function(el) {
        el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
        });
        el.addEventListener('blur', function(e) {
            var annId = e.target.dataset.annId;
            var ann = img.annotations.find(function(a) { return a.id === annId; });
            if (!ann) return;

            ann.note = e.target.value;

            // If pending and still empty, remove annotation
            if (ann._pending && !e.target.value.trim()) {
                if (canvas) {
                    canvas.getObjects().filter(function(o) { return o.annotationId === annId; })
                        .forEach(function(o) { canvas.remove(o); });
                    canvas.renderAll();
                }
                img.annotations = img.annotations.filter(function(a) { return a.id !== annId; });
                IC.saveCurrentCanvasState();
                IC.renderAnnotationsPanel(img);
                IC.updateMarkerSelect();
                return;
            }

            // Clear pending flag once note is written
            if (ann._pending && e.target.value.trim()) {
                delete ann._pending;
            }

            IC.saveCurrentCanvasState();
            var disp = container.querySelector('.note-display[data-ann-id="' + annId + '"]');
            var hint = e.target.nextElementSibling;
            if (disp) {
                var t = e.target.value.trim();
                disp.textContent = t || 'Clic para anotar...';
                disp.classList.toggle('empty', !t);
                disp.classList.remove('hidden');
            }
            e.target.classList.add('hidden');
            if (hint) hint.style.display = 'none';
        });
        el.addEventListener('input', function(e) {
            var ann = img.annotations.find(function(a) { return a.id === e.target.dataset.annId; });
            if (ann) ann.note = e.target.value;
        });
    });

    // -- Category change --
    container.querySelectorAll('.annotation-category-select').forEach(function(el) {
        el.addEventListener('change', function(e) {
            var annId = e.target.dataset.annId, newCat = e.target.value;
            var ann = img.annotations.find(function(a) { return a.id === annId; });
            if (ann) { IC.pushUndo(); ann.categoryId = newCat; updateAnnColors(annId, newCat); IC.renderAnnotationsPanel(img); }
        });
    });

    // -- Delete --
    container.querySelectorAll('.annotation-delete').forEach(function(el) {
        el.addEventListener('click', function() {
            var annId = el.dataset.annId;
            IC.pushUndo();
            if (canvas) {
                canvas.getObjects().filter(function(o) { return o.annotationId === annId; }).forEach(function(o) { canvas.remove(o); });
                canvas.renderAll();
            }
            img.annotations = img.annotations.filter(function(a) { return a.id !== annId; });
            IC.saveCurrentCanvasState();
            IC.renderAnnotationsPanel(img);
            IC.updateMarkerSelect();
        });
    });

    // -- Click to select on canvas --
    container.querySelectorAll('.annotation-item').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (e.target.closest('.note-display') || e.target.tagName === 'TEXTAREA' ||
                e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
            var obj = canvas ? canvas.getObjects().find(function(o) { return o.annotationId === el.dataset.annId && !o._isBadge; }) : null;
            if (obj) { canvas.setActiveObject(obj); canvas.renderAll(); }
        });
    });
};

// ========== UPDATE COLORS ==========
function updateAnnColors(annId, catId) {
    if (!canvas) return;
    var color = IC.getCategoryColor(catId);
    canvas.getObjects().forEach(function(o) {
        if (o.annotationId !== annId) return;
        if (o._isBadge) {
            if (o._objects && o._objects[0]) o._objects[0].set('fill', color);
        } else {
            if (o.stroke) o.set('stroke', color);
            if (o.fill && o.fill !== '' && o.type !== 'path') o.set('fill', colorAlpha(color, 0.12));
        }
        o.categoryId = catId;
    });
    canvas.renderAll();
    IC.saveCurrentCanvasState();
}

// ========== GENERAL NOTES ==========
document.addEventListener('DOMContentLoaded', function() {
    var display = document.getElementById('generalNotesDisplay');
    var textarea = document.getElementById('generalNotes');
    var hint = document.getElementById('generalNotesHint');

    function show() {
        var img = IC.getCurrentImage();
        var t = img ? (img.generalNotes || '') : '';
        textarea.classList.add('hidden'); hint.style.display = 'none'; display.classList.remove('hidden');
        if (t.trim()) { display.textContent = t; display.classList.remove('empty'); }
        else { display.textContent = 'Clic para agregar notas...'; display.classList.add('empty'); }
    }
    display.addEventListener('click', function() {
        var img = IC.getCurrentImage(); if (!img) return;
        display.classList.add('hidden'); textarea.classList.remove('hidden');
        hint.style.display = 'block'; textarea.value = img.generalNotes || ''; textarea.focus();
    });
    textarea.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); textarea.blur(); }
    });
    textarea.addEventListener('blur', function() {
        var img = IC.getCurrentImage(); if (img) img.generalNotes = textarea.value; show();
    });
    textarea.addEventListener('input', function() {
        var img = IC.getCurrentImage(); if (img) img.generalNotes = textarea.value;
    });
    IC.refreshGeneralNotes = show;
});

// ========== EXPORT CANVAS ==========
IC.getCanvasDataURL = function() { return canvas ? canvas.toDataURL({ format: 'png', multiplier: 2 }) : null; };

// ========== HELPERS ==========
function colorAlpha(hex, alpha) {
    if (!hex || hex.charAt(0) !== '#') return 'rgba(136,136,136,' + alpha + ')';
    return 'rgba(' + parseInt(hex.slice(1,3),16) + ',' + parseInt(hex.slice(3,5),16) + ',' + parseInt(hex.slice(5,7),16) + ',' + alpha + ')';
}
function escHtml(s) {
    return s ? s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') : '';
}

})();
