/* ========================================
   IMG-CORPUS — Annotator
   Fabric.js canvas, drawing tools, annotations
   ======================================== */

(function() {

let canvas = null;
let bgImage = null;
let currentZoom = 1;
let isDrawing = false;
let drawStart = null;
let tempShape = null;

// ========== CANVAS INIT ==========
IC.initCanvas = function() {
    const container = document.getElementById('canvasContainer');
    const rect = container.getBoundingClientRect();

    canvas = new fabric.Canvas('mainCanvas', {
        width: rect.width,
        height: rect.height - 4,
        backgroundColor: '#111118',
        selection: true,
        preserveObjectStacking: true,
    });

    IC.canvas = canvas;

    // Resize handler
    window.addEventListener('resize', () => {
        const r = container.getBoundingClientRect();
        canvas.setWidth(r.width);
        canvas.setHeight(r.height - 4);
        canvas.renderAll();
    });

    // Canvas events
    canvas.on('mouse:down', onMouseDown);
    canvas.on('mouse:move', onMouseMove);
    canvas.on('mouse:up', onMouseUp);
    canvas.on('selection:created', onSelectionChanged);
    canvas.on('selection:updated', onSelectionChanged);
    canvas.on('selection:cleared', onSelectionCleared);

    // Freedraw path completion
    canvas.on('path:created', function(opt) {
        if (IC.state.activeTool !== 'freedraw') return;
        const path = opt.path;
        finalizeShape(path);
    });

    // Mouse wheel zoom
    canvas.on('mouse:wheel', function(opt) {
        const delta = opt.e.deltaY;
        let zoom = canvas.getZoom();
        zoom *= 0.999 ** delta;
        zoom = Math.min(Math.max(0.1, zoom), 10);
        canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);
        currentZoom = zoom;
        updateZoomDisplay();
        opt.e.preventDefault();
        opt.e.stopPropagation();
    });

    // Panning with Alt+drag or middle mouse
    let isPanning = false;
    let panStart = null;
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
        const vpt = canvas.viewportTransform;
        vpt[4] += opt.e.clientX - panStart.x;
        vpt[5] += opt.e.clientY - panStart.y;
        panStart = { x: opt.e.clientX, y: opt.e.clientY };
        canvas.requestRenderAll();
    });
    canvas.on('mouse:up', function() {
        if (isPanning) {
            isPanning = false;
            IC.applyTool(IC.state.activeTool);
        }
    });
};

// ========== LOAD IMAGE ==========
IC.loadImageToCanvas = function(imgData) {
    if (!canvas) return;

    // Save current canvas state before switching
    IC.saveCurrentCanvasState();

    canvas.clear();
    canvas.setBackgroundColor('#111118', canvas.renderAll.bind(canvas));

    fabric.Image.fromURL(imgData.dataUrl, function(img) {
        bgImage = img;

        const containerEl = document.getElementById('canvasContainer');
        const cw = containerEl.clientWidth;
        const ch = containerEl.clientHeight;

        const scale = Math.min(
            (cw * 0.9) / img.width,
            (ch * 0.9) / img.height,
            1
        );

        img.set({
            left: cw / 2,
            top: ch / 2,
            originX: 'center',
            originY: 'center',
            scaleX: scale,
            scaleY: scale,
            selectable: false,
            evented: false,
            hoverCursor: 'default',
        });

        canvas.setBackgroundImage(img, canvas.renderAll.bind(canvas));
        canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
        currentZoom = 1;
        updateZoomDisplay();

        // Restore annotations
        if (imgData.canvasObjects && imgData.canvasObjects.length > 0) {
            fabric.util.enlivenObjects(imgData.canvasObjects, function(objects) {
                objects.forEach(obj => {
                    canvas.add(obj);
                });
                canvas.renderAll();
            });
        }

        IC.showCanvasEmpty(false);
    }, { crossOrigin: 'anonymous' });
};

// ========== SAVE CANVAS STATE ==========
IC.saveCurrentCanvasState = function() {
    if (!canvas || !IC.state.currentImageId) return;
    const img = IC.getCurrentImage();
    if (!img) return;

    const objects = canvas.getObjects().map(obj => obj.toObject([
        'annotationId', 'annotationNumber', 'categoryId', 'isAnnotation', 'isBadge'
    ]));
    img.canvasObjects = objects;
};

// ========== TOOL APPLICATION ==========
IC.applyTool = function(tool) {
    if (!canvas) return;

    canvas.isDrawingMode = false;
    canvas.selection = true;
    canvas.defaultCursor = 'default';
    canvas.hoverCursor = 'move';
    canvas.forEachObject(obj => {
        if (!obj.isBadge) obj.selectable = true;
    });

    if (tool === 'freedraw') {
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = IC.getCategoryColor(IC.state.activeCategory);
        canvas.freeDrawingBrush.width = 3;
        canvas.selection = false;
    } else if (tool === 'select') {
        canvas.defaultCursor = 'default';
    } else {
        canvas.defaultCursor = 'crosshair';
        canvas.selection = false;
        canvas.forEachObject(obj => { obj.selectable = false; });
    }
};

// ========== DRAWING EVENTS ==========
function getPointer(e) {
    return canvas.getPointer(e.e);
}

function onMouseDown(opt) {
    const tool = IC.state.activeTool;
    if (tool === 'select' || tool === 'freedraw') return;

    isDrawing = true;
    drawStart = getPointer(opt);
    const color = IC.getCategoryColor(IC.state.activeCategory);

    if (tool === 'rect') {
        tempShape = new fabric.Rect({
            left: drawStart.x,
            top: drawStart.y,
            width: 0,
            height: 0,
            fill: colorAlpha(color, 0.12),
            stroke: color,
            strokeWidth: 2,
            strokeDashArray: [6, 3],
            selectable: false,
        });
        canvas.add(tempShape);
    } else if (tool === 'ellipse') {
        tempShape = new fabric.Ellipse({
            left: drawStart.x,
            top: drawStart.y,
            rx: 0,
            ry: 0,
            fill: colorAlpha(color, 0.12),
            stroke: color,
            strokeWidth: 2,
            strokeDashArray: [6, 3],
            selectable: false,
        });
        canvas.add(tempShape);
    } else if (tool === 'arrow') {
        tempShape = new fabric.Line([drawStart.x, drawStart.y, drawStart.x, drawStart.y], {
            stroke: color,
            strokeWidth: 2.5,
            selectable: false,
        });
        canvas.add(tempShape);
    } else if (tool === 'marker') {
        // Place marker immediately
        isDrawing = false;
        createAnnotationAtPoint(drawStart.x, drawStart.y);
        return;
    }
}

function onMouseMove(opt) {
    if (!isDrawing || !tempShape) return;
    const pointer = getPointer(opt);
    const tool = IC.state.activeTool;

    if (tool === 'rect') {
        const left = Math.min(drawStart.x, pointer.x);
        const top = Math.min(drawStart.y, pointer.y);
        tempShape.set({
            left: left,
            top: top,
            width: Math.abs(pointer.x - drawStart.x),
            height: Math.abs(pointer.y - drawStart.y),
        });
    } else if (tool === 'ellipse') {
        const rx = Math.abs(pointer.x - drawStart.x) / 2;
        const ry = Math.abs(pointer.y - drawStart.y) / 2;
        tempShape.set({
            left: Math.min(drawStart.x, pointer.x),
            top: Math.min(drawStart.y, pointer.y),
            rx: rx,
            ry: ry,
        });
    } else if (tool === 'arrow') {
        tempShape.set({ x2: pointer.x, y2: pointer.y });
    }

    canvas.renderAll();
}

function onMouseUp(opt) {
    if (!isDrawing) {
        // Handle freedraw path completion
        if (IC.state.activeTool === 'freedraw' && opt.target && opt.target.type === 'path') {
            return; // handled by path:created
        }
        return;
    }

    isDrawing = false;
    const tool = IC.state.activeTool;
    const pointer = getPointer(opt);

    if (tool === 'rect' || tool === 'ellipse') {
        const w = Math.abs(pointer.x - drawStart.x);
        const h = Math.abs(pointer.y - drawStart.y);
        if (w < 5 && h < 5) {
            canvas.remove(tempShape);
            tempShape = null;
            return;
        }
        finalizeShape(tempShape);
    } else if (tool === 'arrow') {
        const dx = pointer.x - drawStart.x;
        const dy = pointer.y - drawStart.y;
        if (Math.sqrt(dx*dx + dy*dy) < 10) {
            canvas.remove(tempShape);
            tempShape = null;
            return;
        }
        // Replace line with arrow (line + triangle head)
        canvas.remove(tempShape);
        const arrowGroup = createArrow(drawStart.x, drawStart.y, pointer.x, pointer.y);
        finalizeShape(arrowGroup);
    }

    tempShape = null;
}



// ========== CREATE SHAPES ==========
function createArrow(x1, y1, x2, y2) {
    const color = IC.getCategoryColor(IC.state.activeCategory);
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 14;

    const line = new fabric.Line([x1, y1, x2, y2], {
        stroke: color,
        strokeWidth: 2.5,
    });

    const head = new fabric.Triangle({
        left: x2,
        top: y2,
        originX: 'center',
        originY: 'center',
        angle: (angle * 180 / Math.PI) + 90,
        width: headLen,
        height: headLen,
        fill: color,
    });

    const group = new fabric.Group([line, head], {
        selectable: true,
    });

    return group;
}

function createAnnotationAtPoint(x, y) {
    const img = IC.getCurrentImage();
    if (!img) return;

    IC.pushUndo();

    const annId = IC.uid();
    const annNum = (img.annotations ? img.annotations.length : 0) + 1;
    const catId = IC.state.activeCategory;
    const color = IC.getCategoryColor(catId);

    // Create number badge on canvas
    const badge = createBadge(x, y, annNum, color);
    badge.annotationId = annId;
    badge.annotationNumber = annNum;
    badge.categoryId = catId;
    badge.isAnnotation = true;
    badge.isBadge = true;
    canvas.add(badge);
    canvas.renderAll();

    // Create annotation data
    if (!img.annotations) img.annotations = [];
    img.annotations.push({
        id: annId,
        number: annNum,
        categoryId: catId,
        note: '',
        type: 'marker',
    });

    IC.saveCurrentCanvasState();
    IC.renderAnnotationsPanel(img);
}

function finalizeShape(shape) {
    const img = IC.getCurrentImage();
    if (!img) return;

    IC.pushUndo();

    const annId = IC.uid();
    const annNum = (img.annotations ? img.annotations.length : 0) + 1;
    const catId = IC.state.activeCategory;
    const color = IC.getCategoryColor(catId);

    shape.set({
        annotationId: annId,
        annotationNumber: annNum,
        categoryId: catId,
        isAnnotation: true,
        selectable: true,
    });

    // Add number badge near the shape
    const bound = shape.getBoundingRect();
    const badge = createBadge(bound.left + bound.width + 4, bound.top - 4, annNum, color);
    badge.annotationId = annId;
    badge.annotationNumber = annNum;
    badge.categoryId = catId;
    badge.isAnnotation = true;
    badge.isBadge = true;

    canvas.add(badge);
    canvas.renderAll();

    // Create annotation data
    if (!img.annotations) img.annotations = [];
    img.annotations.push({
        id: annId,
        number: annNum,
        categoryId: catId,
        note: '',
        type: IC.state.activeTool,
    });

    IC.saveCurrentCanvasState();
    IC.renderAnnotationsPanel(img);
}

function createBadge(x, y, number, color) {
    const circle = new fabric.Circle({
        radius: 12,
        fill: color,
        originX: 'center',
        originY: 'center',
    });

    const text = new fabric.Text(String(number), {
        fontSize: 11,
        fontFamily: 'IBM Plex Mono, monospace',
        fontWeight: '700',
        fill: '#0d0d12',
        originX: 'center',
        originY: 'center',
    });

    const group = new fabric.Group([circle, text], {
        left: x,
        top: y,
        selectable: false,
        evented: false,
        hoverCursor: 'default',
    });

    return group;
}

// ========== DELETE ==========
IC.deleteSelectedAnnotation = function() {
    if (!canvas) return;
    const active = canvas.getActiveObjects();
    if (active.length === 0) return;

    IC.pushUndo();
    const img = IC.getCurrentImage();
    if (!img) return;

    active.forEach(obj => {
        if (obj.annotationId) {
            // Remove associated badge
            canvas.getObjects().forEach(o => {
                if (o.annotationId === obj.annotationId) {
                    canvas.remove(o);
                }
            });
            // Remove annotation data
            if (img.annotations) {
                img.annotations = img.annotations.filter(a => a.id !== obj.annotationId);
            }
        }
        canvas.remove(obj);
    });

    canvas.discardActiveObject();
    canvas.renderAll();
    IC.saveCurrentCanvasState();
    IC.renderAnnotationsPanel(img);
};

// ========== SELECTION EVENTS ==========
function onSelectionChanged(opt) {
    const obj = opt.selected && opt.selected[0];
    if (obj && obj.annotationId) {
        highlightAnnotationInPanel(obj.annotationId);
    }
}

function onSelectionCleared() {
    document.querySelectorAll('.annotation-item').forEach(el => el.classList.remove('selected'));
}

function highlightAnnotationInPanel(annId) {
    document.querySelectorAll('.annotation-item').forEach(el => {
        el.classList.toggle('selected', el.dataset.annId === annId);
    });
}

// ========== ZOOM ==========
IC.zoomIn = function() {
    if (!canvas) return;
    currentZoom = Math.min(currentZoom * 1.2, 10);
    canvas.setZoom(currentZoom);
    updateZoomDisplay();
};

IC.zoomOut = function() {
    if (!canvas) return;
    currentZoom = Math.max(currentZoom / 1.2, 0.1);
    canvas.setZoom(currentZoom);
    updateZoomDisplay();
};

IC.zoomFit = function() {
    if (!canvas) return;
    canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    currentZoom = 1;
    updateZoomDisplay();
};

function updateZoomDisplay() {
    document.getElementById('zoomLevel').textContent = Math.round(currentZoom * 100) + '%';
}

// ========== RENDER ANNOTATIONS PANEL ==========
IC.renderAnnotationsPanel = function(img) {
    if (!img) return;
    const container = document.getElementById('annotationsList');
    const countEl = document.getElementById('annotationCount');

    document.getElementById('generalNotes').value = img.generalNotes || '';

    if (!img.annotations || img.annotations.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:12px;padding:8px 0;">Sin anotaciones. Usa las herramientas para anotar la imagen.</p>';
        countEl.textContent = '0';
        return;
    }

    countEl.textContent = img.annotations.length;

    container.innerHTML = img.annotations.map(ann => {
        const cat = IC.getCategoryById(ann.categoryId);
        const catColor = cat ? cat.color : '#4ecdc4';
        const catOptions = IC.state.categories.map(c =>
            `<option value="${c.id}" ${c.id === ann.categoryId ? 'selected' : ''}>${c.name}</option>`
        ).join('');

        return `
        <div class="annotation-item" data-ann-id="${ann.id}" style="border-left-color:${catColor}">
            <div class="annotation-header">
                <span class="annotation-number" style="background:${catColor}">${ann.number}</span>
                <select class="annotation-category-select" data-ann-id="${ann.id}">
                    ${catOptions}
                </select>
                <button class="annotation-delete" data-ann-id="${ann.id}" title="Eliminar">
                    <span class="material-symbols-outlined">close</span>
                </button>
            </div>
            <textarea class="annotation-note" data-ann-id="${ann.id}" placeholder="Nota para esta anotación...">${ann.note || ''}</textarea>
        </div>`;
    }).join('');

    // Event listeners
    container.querySelectorAll('.annotation-note').forEach(el => {
        el.addEventListener('input', (e) => {
            const ann = img.annotations.find(a => a.id === e.target.dataset.annId);
            if (ann) ann.note = e.target.value;
        });
        el.addEventListener('blur', () => {
            IC.saveCurrentCanvasState();
        });
    });

    container.querySelectorAll('.annotation-category-select').forEach(el => {
        el.addEventListener('change', (e) => {
            const annId = e.target.dataset.annId;
            const newCatId = e.target.value;
            const ann = img.annotations.find(a => a.id === annId);
            if (ann) {
                IC.pushUndo();
                ann.categoryId = newCatId;
                updateAnnotationColor(annId, newCatId);
                IC.renderAnnotationsPanel(img);
            }
        });
    });

    container.querySelectorAll('.annotation-delete').forEach(el => {
        el.addEventListener('click', (e) => {
            const annId = el.dataset.annId;
            IC.pushUndo();
            // Remove from canvas
            if (canvas) {
                canvas.getObjects().filter(o => o.annotationId === annId).forEach(o => canvas.remove(o));
                canvas.renderAll();
            }
            img.annotations = img.annotations.filter(a => a.id !== annId);
            IC.saveCurrentCanvasState();
            IC.renderAnnotationsPanel(img);
        });
    });

    // Click to select on canvas
    container.querySelectorAll('.annotation-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT' || e.target.tagName === 'BUTTON') return;
            const annId = el.dataset.annId;
            if (!canvas) return;
            const obj = canvas.getObjects().find(o => o.annotationId === annId && !o.isBadge);
            if (obj) {
                canvas.setActiveObject(obj);
                canvas.renderAll();
            }
        });
    });
};

function updateAnnotationColor(annId, catId) {
    if (!canvas) return;
    const color = IC.getCategoryColor(catId);
    canvas.getObjects().forEach(obj => {
        if (obj.annotationId !== annId) return;
        if (obj.isBadge) {
            // Update badge color
            if (obj._objects && obj._objects[0]) {
                obj._objects[0].set('fill', color);
            }
        } else {
            if (obj.stroke) obj.set('stroke', color);
            if (obj.fill && obj.fill !== 'transparent' && obj.type !== 'group') {
                obj.set('fill', colorAlpha(color, 0.12));
            }
        }
        obj.categoryId = catId;
    });
    canvas.renderAll();
    IC.saveCurrentCanvasState();
}

// ========== GENERAL NOTES ==========
document.addEventListener('DOMContentLoaded', () => {
    const notesEl = document.getElementById('generalNotes');
    notesEl.addEventListener('input', () => {
        const img = IC.getCurrentImage();
        if (img) img.generalNotes = notesEl.value;
    });
});

// ========== EXPORT CANVAS AS IMAGE ==========
IC.getCanvasDataURL = function() {
    if (!canvas) return null;
    return canvas.toDataURL({ format: 'png', multiplier: 2 });
};

// ========== HELPERS ==========
function colorAlpha(hex, alpha) {
    const r = parseInt(hex.slice(1,3), 16);
    const g = parseInt(hex.slice(3,5), 16);
    const b = parseInt(hex.slice(5,7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

})();
