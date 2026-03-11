/* ========================================
   IMG-CORPUS — App Core
   State management, initialization, undo/redo
   ======================================== */

window.IC = window.IC || {};

// ========== STATE ==========
IC.state = {
    images: [],
    categories: [],
    currentImageId: null,
    batchMode: false,
    batchSelected: new Set(),
    activeTool: 'select',
    activeCategory: null,
    viewMode: 'single',
    sessionName: 'Sesión sin título',
};

IC.undoStack = [];
IC.redoStack = [];
IC.MAX_UNDO = 40;

// ========== UNDO / REDO ==========
IC.pushUndo = function() {
    const snapshot = JSON.stringify({
        images: IC.state.images,
        categories: IC.state.categories,
    });
    IC.undoStack.push(snapshot);
    if (IC.undoStack.length > IC.MAX_UNDO) IC.undoStack.shift();
    IC.redoStack = [];
    IC.updateUndoButtons();
};

IC.undo = function() {
    if (IC.undoStack.length === 0) return;
    const current = JSON.stringify({
        images: IC.state.images,
        categories: IC.state.categories,
    });
    IC.redoStack.push(current);
    const prev = JSON.parse(IC.undoStack.pop());
    IC.state.images = prev.images;
    IC.state.categories = prev.categories;
    IC.refreshAll();
    IC.updateUndoButtons();
};

IC.redo = function() {
    if (IC.redoStack.length === 0) return;
    const current = JSON.stringify({
        images: IC.state.images,
        categories: IC.state.categories,
    });
    IC.undoStack.push(current);
    const next = JSON.parse(IC.redoStack.pop());
    IC.state.images = next.images;
    IC.state.categories = next.categories;
    IC.refreshAll();
    IC.updateUndoButtons();
};

IC.updateUndoButtons = function() {
    document.getElementById('btnUndo').disabled = IC.undoStack.length === 0;
    document.getElementById('btnRedo').disabled = IC.redoStack.length === 0;
};

// ========== HELPERS ==========
IC.uid = function() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
};

IC.getCurrentImage = function() {
    return IC.state.images.find(img => img.id === IC.state.currentImageId) || null;
};

IC.getCategoryById = function(id) {
    return IC.state.categories.find(c => c.id === id) || null;
};

IC.getCategoryColor = function(id) {
    const cat = IC.getCategoryById(id);
    return cat ? cat.color : '#888888';
};

IC.hasCategories = function() {
    return IC.state.categories.length > 0;
};

// ========== REFRESH ALL UI ==========
IC.refreshAll = function() {
    IC.renderGallery();
    IC.renderCategories();
    IC.updateCategorySelects();
    if (IC.state.viewMode === 'grid') {
        IC.renderGridView();
    } else if (IC.state.currentImageId) {
        const img = IC.getCurrentImage();
        if (img) {
            IC.loadImageToCanvas(img);
            IC.renderAnnotationsPanel(img);
            IC.renderMetadataPanel(img);
            IC.renderTagsPanel(img);
        } else {
            IC.state.currentImageId = null;
            IC.showCanvasEmpty(true);
        }
    }
    IC.renderCorpusTags();
};

// ========== SHOW/HIDE CANVAS EMPTY STATE ==========
IC.showCanvasEmpty = function(show) {
    const el = document.getElementById('canvasEmpty');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
};

// ========== PANEL TABS ==========
IC.initPanelTabs = function() {
    document.querySelectorAll('.panel-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.panel-content').forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('panel' + capitalize(tab.dataset.panel)).classList.add('active');
        });
    });
};

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ========== MODALS ==========
IC.openModal = function(id) {
    document.getElementById(id).classList.add('active');
};
IC.closeModal = function(id) {
    document.getElementById(id).classList.remove('active');
};

IC.initModals = function() {
    document.querySelectorAll('.modal-close').forEach(btn => {
        btn.addEventListener('click', () => {
            btn.closest('.modal-overlay').classList.remove('active');
        });
    });
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.classList.remove('active');
        });
    });
};

// ========== CATEGORY MANAGEMENT ==========
IC.renderCategories = function() {
    const container = document.getElementById('categoriesList');

    if (IC.state.categories.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:11px;padding:4px 0;">Sin categorías. Crea una para comenzar a anotar.</p>';
        return;
    }

    container.innerHTML = IC.state.categories.map(cat => `
        <div class="category-item" data-cat-id="${cat.id}">
            <span class="category-dot" style="background:${cat.color}"></span>
            <span class="category-name">${cat.name}</span>
            <button class="category-remove" data-cat-id="${cat.id}" title="Eliminar">&times;</button>
        </div>
    `).join('');

    container.querySelectorAll('.category-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const catId = btn.dataset.catId;
            IC.pushUndo();
            IC.state.categories = IC.state.categories.filter(c => c.id !== catId);
            if (IC.state.activeCategory === catId) {
                IC.state.activeCategory = IC.state.categories.length > 0 ? IC.state.categories[0].id : null;
            }
            IC.renderCategories();
            IC.updateCategorySelects();
        });
    });
};

IC.updateCategorySelects = function() {
    const options = IC.state.categories.length > 0
        ? IC.state.categories.map(c =>
            `<option value="${c.id}" style="color:${c.color}">${c.name}</option>`
          ).join('')
        : '<option value="" disabled>Crea una categoría primero</option>';

    const toolSelect = document.getElementById('toolCategory');
    if (toolSelect) {
        toolSelect.innerHTML = options;
        if (IC.state.activeCategory) toolSelect.value = IC.state.activeCategory;
    }

    document.querySelectorAll('.annotation-category-select').forEach(sel => {
        const current = sel.value;
        sel.innerHTML = options;
        if (IC.state.categories.find(c => c.id === current)) {
            sel.value = current;
        }
    });
};

IC.initCategoryUI = function() {
    document.getElementById('btnAddCategory').addEventListener('click', () => {
        IC.openModal('modalAddCategory');
        document.getElementById('categoryNameInput').value = '';
        document.getElementById('categoryColorInput').value = '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
        setTimeout(() => document.getElementById('categoryNameInput').focus(), 100);
    });

    document.getElementById('btnCategoryApply').addEventListener('click', () => {
        const name = document.getElementById('categoryNameInput').value.trim();
        const color = document.getElementById('categoryColorInput').value;
        if (!name) return;
        IC.pushUndo();
        const newCat = { id: 'cat-' + IC.uid(), name, color };
        IC.state.categories.push(newCat);
        // Auto-select as active if it's the first or no active category
        if (!IC.state.activeCategory || !IC.state.categories.find(c => c.id === IC.state.activeCategory)) {
            IC.state.activeCategory = newCat.id;
        }
        IC.renderCategories();
        IC.updateCategorySelects();
        IC.closeModal('modalAddCategory');
    });

    document.getElementById('toolCategory').addEventListener('change', (e) => {
        IC.state.activeCategory = e.target.value;
    });
};

// ========== BATCH MODE ==========
IC.initBatchMode = function() {
    document.getElementById('btnBatchMode').addEventListener('click', () => {
        IC.state.batchMode = !IC.state.batchMode;
        IC.state.batchSelected.clear();
        const sidebar = document.getElementById('sidebar');
        const toolbar = document.getElementById('batchToolbar');
        const btn = document.getElementById('btnBatchMode');
        if (IC.state.batchMode) {
            sidebar.classList.add('batch-mode');
            toolbar.classList.add('active');
            btn.classList.add('active');
        } else {
            sidebar.classList.remove('batch-mode');
            toolbar.classList.remove('active');
            btn.classList.remove('active');
        }
        IC.renderGallery();
        IC.updateBatchCount();
    });

    document.getElementById('btnBatchSelectAll').addEventListener('click', () => {
        IC.state.batchSelected = new Set(IC.state.images.map(i => i.id));
        IC.renderGallery();
        IC.updateBatchCount();
        if (IC.state.viewMode === 'grid') IC.renderGridView();
    });

    document.getElementById('btnBatchSelectNone').addEventListener('click', () => {
        IC.state.batchSelected.clear();
        IC.renderGallery();
        IC.updateBatchCount();
        if (IC.state.viewMode === 'grid') IC.renderGridView();
    });

    document.getElementById('btnBatchTag').addEventListener('click', () => {
        if (IC.state.batchSelected.size === 0) return;
        document.getElementById('batchTagInput').value = '';
        IC.openModal('modalBatchTag');
        setTimeout(() => document.getElementById('batchTagInput').focus(), 100);
    });

    document.getElementById('btnBatchTagApply').addEventListener('click', () => {
        const raw = document.getElementById('batchTagInput').value;
        const tags = raw.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        if (tags.length === 0) return;
        IC.pushUndo();
        IC.state.images.forEach(img => {
            if (IC.state.batchSelected.has(img.id)) {
                tags.forEach(tag => {
                    if (!img.tags.includes(tag)) img.tags.push(tag);
                });
            }
        });
        IC.closeModal('modalBatchTag');
        IC.renderTagsPanel(IC.getCurrentImage());
        IC.renderCorpusTags();
    });

    document.getElementById('btnBatchNote').addEventListener('click', () => {
        if (IC.state.batchSelected.size === 0) return;
        document.getElementById('batchNoteInput').value = '';
        IC.openModal('modalBatchNote');
        setTimeout(() => document.getElementById('batchNoteInput').focus(), 100);
    });

    document.getElementById('btnBatchNoteApply').addEventListener('click', () => {
        const note = document.getElementById('batchNoteInput').value.trim();
        if (!note) return;
        IC.pushUndo();
        IC.state.images.forEach(img => {
            if (IC.state.batchSelected.has(img.id)) {
                img.generalNotes = img.generalNotes
                    ? img.generalNotes + '\n\n' + note
                    : note;
            }
        });
        IC.closeModal('modalBatchNote');
        const cur = IC.getCurrentImage();
        if (cur) document.getElementById('generalNotes').value = cur.generalNotes || '';
    });

    document.getElementById('btnBatchDelete').addEventListener('click', () => {
        if (IC.state.batchSelected.size === 0) return;
        if (!confirm(`¿Eliminar ${IC.state.batchSelected.size} imágenes del corpus?`)) return;
        IC.pushUndo();
        IC.state.images = IC.state.images.filter(img => !IC.state.batchSelected.has(img.id));
        if (IC.state.batchSelected.has(IC.state.currentImageId)) {
            IC.state.currentImageId = IC.state.images.length > 0 ? IC.state.images[0].id : null;
        }
        IC.state.batchSelected.clear();
        IC.refreshAll();
        IC.updateBatchCount();
        if (!IC.state.currentImageId) IC.showCanvasEmpty(true);
    });
};

IC.updateBatchCount = function() {
    document.getElementById('batchCount').textContent = IC.state.batchSelected.size;
};

// ========== SESSION NAME ==========
IC.initSessionName = function() {
    const el = document.getElementById('sessionName');
    el.textContent = IC.state.sessionName;
    el.addEventListener('blur', () => {
        IC.state.sessionName = el.textContent.trim() || 'Sesión sin título';
    });
    el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
};

// ========== KEYBOARD SHORTCUTS ==========
IC.initKeyboard = function() {
    document.addEventListener('keydown', (e) => {
        // Don't intercept when typing in inputs
        const tag = e.target.tagName.toLowerCase();
        const editable = e.target.isContentEditable;
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || editable) return;

        if (e.ctrlKey || e.metaKey) {
            if (e.key === 'z') { e.preventDefault(); IC.undo(); }
            if (e.key === 'y') { e.preventDefault(); IC.redo(); }
            return;
        }

        switch(e.key.toLowerCase()) {
            case 'v': IC.setTool('select'); break;
            case 'r': IC.setTool('rect'); break;
            case 'e': IC.setTool('ellipse'); break;
            case 'd': IC.setTool('freedraw'); break;
            case 'a': IC.setTool('arrow'); break;
            case 'm': IC.setTool('marker'); break;
            case 'delete':
            case 'backspace':
                if (IC.deleteSelectedAnnotation) IC.deleteSelectedAnnotation();
                break;
            case '=':
            case '+': if (IC.zoomIn) IC.zoomIn(); break;
            case '-': if (IC.zoomOut) IC.zoomOut(); break;
            case '0': if (IC.zoomFit) IC.zoomFit(); break;
            case 'g': IC.setViewMode('grid'); break;
            case '1': IC.setViewMode('single'); break;
        }
    });
};

// ========== TOOL SELECTION ==========
IC.setTool = function(tool) {
    IC.state.activeTool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });
    if (IC.applyTool) IC.applyTool(tool);
};

IC.initToolbar = function() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => IC.setTool(btn.dataset.tool));
    });

    document.getElementById('btnZoomIn').addEventListener('click', () => IC.zoomIn && IC.zoomIn());
    document.getElementById('btnZoomOut').addEventListener('click', () => IC.zoomOut && IC.zoomOut());
    document.getElementById('btnZoomFit').addEventListener('click', () => IC.zoomFit && IC.zoomFit());
    document.getElementById('btnDeleteSelected').addEventListener('click', () => {
        if (IC.deleteSelectedAnnotation) IC.deleteSelectedAnnotation();
    });

    // View mode toggle
    document.getElementById('btnViewSingle').addEventListener('click', () => IC.setViewMode('single'));
    document.getElementById('btnViewGrid').addEventListener('click', () => IC.setViewMode('grid'));
};

// ========== VIEW MODE ==========
IC.setViewMode = function(mode) {
    IC.state.viewMode = mode;
    const canvasEl = document.getElementById('canvasContainer');
    const gridEl = document.getElementById('gridView');
    const btnSingle = document.getElementById('btnViewSingle');
    const btnGrid = document.getElementById('btnViewGrid');

    if (mode === 'grid') {
        if (IC.saveCurrentCanvasState) IC.saveCurrentCanvasState();

        // Auto-activate batch mode if not already on
        if (!IC.state.batchMode) {
            IC.state.batchMode = true;
            document.getElementById('sidebar').classList.add('batch-mode');
            document.getElementById('batchToolbar').classList.add('active');
            document.getElementById('btnBatchMode').classList.add('active');
            IC.renderGallery();
            IC.updateBatchCount();
        }

        canvasEl.classList.add('hidden');
        gridEl.classList.remove('hidden');
        btnSingle.classList.remove('active');
        btnGrid.classList.add('active');
        IC.renderGridView();
    } else {
        gridEl.classList.add('hidden');
        canvasEl.classList.remove('hidden');
        btnSingle.classList.add('active');
        btnGrid.classList.remove('active');
        const img = IC.getCurrentImage();
        if (img) IC.loadImageToCanvas(img);
    }
};

IC.renderGridView = function() {
    const container = document.getElementById('gridViewInner');
    const emptyEl = document.getElementById('gridEmpty');

    // Only show batch-selected images
    const selectedImages = IC.state.images
        .map((img, idx) => ({ img, corpusIndex: idx + 1 }))
        .filter(entry => IC.state.batchSelected.has(entry.img.id));

    if (selectedImages.length === 0) {
        container.innerHTML = '';
        emptyEl.classList.remove('hidden');
        emptyEl.querySelector('p').textContent = IC.state.images.length === 0
            ? 'Agrega imágenes al corpus para verlas aquí'
            : 'Selecciona imágenes en el corpus para verlas en la grilla';
        return;
    }
    emptyEl.classList.add('hidden');

    container.innerHTML = selectedImages.map(({ img, corpusIndex }) => {
        const annCount = (img.annotations || []).length;
        const tagCount = (img.tags || []).length;

        const usedCats = [...new Set((img.annotations || []).map(a => a.categoryId))];
        const catDots = usedCats.slice(0, 6).map(catId => {
            const color = IC.getCategoryColor(catId);
            return `<span class="grid-item-cat-dot" style="background:${color}"></span>`;
        }).join('');

        const tags = (img.tags || []).slice(0, 5).map(t =>
            `<span class="grid-item-tag">${escGrid(t)}</span>`
        ).join('');
        const moreTags = tagCount > 5 ? `<span class="grid-item-tag">+${tagCount - 5}</span>` : '';

        const notes = img.generalNotes
            ? `<div class="grid-item-notes">${escGrid(img.generalNotes)}</div>`
            : '';

        const metaParts = [];
        if (img.metadata.source) metaParts.push(img.metadata.source);
        if (img.metadata.date) metaParts.push(img.metadata.date);
        if (img.metadata.author) metaParts.push(img.metadata.author);
        const metaStr = metaParts.length > 0
            ? `<div class="grid-item-meta">${escGrid(metaParts.join(' · '))}</div>`
            : '';

        return `
        <div class="grid-item" data-img-id="${img.id}">
            <div class="grid-item-image">
                <img src="${img.dataUrl}" alt="${escGrid(img.name)}" loading="lazy">
                <span class="grid-item-index">${corpusIndex}</span>
                <div class="grid-item-annotations">
                    ${annCount > 0 ? `<span class="grid-item-ann-count"><span class="material-symbols-outlined">edit_note</span>${annCount}</span>` : ''}
                </div>
            </div>
            <div class="grid-item-body">
                <div class="grid-item-name">${escGrid(img.name)}</div>
                ${metaStr}
                ${tags || moreTags ? `<div class="grid-item-tags">${tags}${moreTags}</div>` : ''}
                ${notes}
                ${catDots ? `<div class="grid-item-cats">${catDots}</div>` : ''}
                <div class="grid-item-hint">Doble clic para anotar</div>
            </div>
        </div>`;
    }).join('');

    container.querySelectorAll('.grid-item').forEach(el => {
        el.addEventListener('dblclick', () => {
            const imgId = el.dataset.imgId;
            IC.state.currentImageId = imgId;
            IC.setViewMode('single');
            IC.selectImage(imgId);
            IC.renderGallery();
            const img = IC.getCurrentImage();
            if (img) {
                IC.renderAnnotationsPanel(img);
                IC.renderMetadataPanel(img);
                IC.renderTagsPanel(img);
            }
        });
    });
};

function escGrid(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ========== HEADER BUTTONS ==========
IC.initHeaderButtons = function() {
    document.getElementById('btnUndo').addEventListener('click', () => IC.undo());
    document.getElementById('btnRedo').addEventListener('click', () => IC.redo());
    document.getElementById('btnImportSession').addEventListener('click', () => {
        document.getElementById('importFileInput').click();
    });
    document.getElementById('btnExportSession').addEventListener('click', () => {
        if (IC.exportSession) IC.exportSession();
    });
    document.getElementById('btnGenerateReport').addEventListener('click', () => {
        IC.updateReportScope();
        IC.openModal('modalReport');
    });
};

// ========== TARGET IMAGES (respects batch selection) ==========
IC.getTargetImages = function() {
    if (IC.state.batchMode && IC.state.batchSelected.size > 0) {
        return IC.state.images.filter(img => IC.state.batchSelected.has(img.id));
    }
    return [...IC.state.images];
};

IC.exportScope = 'auto'; // 'auto' | 'selected' | 'all'

IC.updateReportScope = function() {
    const scopeEl = document.getElementById('reportScope');
    const hasSel = IC.state.batchMode && IC.state.batchSelected.size > 0;
    const selCount = IC.state.batchSelected.size;
    const totalCount = IC.state.images.length;

    // Reset to auto
    IC.exportScope = 'auto';

    if (hasSel) {
        scopeEl.innerHTML = `
            <div class="report-scope-title">
                <span class="material-symbols-outlined">filter_alt</span>
                Alcance del informe / exportación
            </div>
            <div class="report-scope-info">
                ${selCount} de ${totalCount} imágenes seleccionadas en modo batch.
            </div>
            <div class="scope-toggle">
                <button class="scope-btn active" data-scope="selected">Solo seleccionadas (${selCount})</button>
                <button class="scope-btn" data-scope="all">Todo el corpus (${totalCount})</button>
            </div>
        `;
        IC.exportScope = 'selected';
    } else {
        scopeEl.innerHTML = `
            <div class="report-scope-title">
                <span class="material-symbols-outlined">library_books</span>
                Alcance del informe / exportación
            </div>
            <div class="report-scope-info">
                Se incluirán las ${totalCount} imágenes del corpus.
                Para exportar un subconjunto, usa el modo batch para seleccionar imágenes.
            </div>
        `;
        IC.exportScope = 'all';
    }

    // Scope toggle buttons
    scopeEl.querySelectorAll('.scope-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            scopeEl.querySelectorAll('.scope-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            IC.exportScope = btn.dataset.scope;
        });
    });
};

IC.getScopedImages = function() {
    if (IC.exportScope === 'selected' && IC.state.batchSelected.size > 0) {
        return IC.state.images.filter(img => IC.state.batchSelected.has(img.id));
    }
    return [...IC.state.images];
};

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
    IC.initModals();
    IC.initPanelTabs();
    IC.initSessionName();
    IC.initCategoryUI();
    IC.initBatchMode();
    IC.initToolbar();
    IC.initHeaderButtons();
    IC.initKeyboard();
    IC.renderCategories();
    IC.updateCategorySelects();
    IC.updateUndoButtons();

    // Defer canvas-dependent init
    setTimeout(() => {
        if (IC.initCanvas) IC.initCanvas();
        if (IC.initCorpus) IC.initCorpus();
        if (IC.initExport) IC.initExport();
        IC.showCanvasEmpty(true);
    }, 100);
});
