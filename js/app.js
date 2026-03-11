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
    if (IC.state.currentImageId) {
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
    });

    document.getElementById('btnBatchSelectNone').addEventListener('click', () => {
        IC.state.batchSelected.clear();
        IC.renderGallery();
        IC.updateBatchCount();
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
};

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
        IC.openModal('modalReport');
    });
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
