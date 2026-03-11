/* ========================================
   IMG-CORPUS V2 — Corpus
   Image management, gallery, drag-drop,
   alphabetical sort, manual reorder
   ======================================== */
(function(){

IC.initCorpus = function() {
    initFileInput();
    initDragDropFiles();
    initSortButton();
};

// ========== SORT ==========
function sortAlpha() {
    IC.pushUndo();
    IC.state.images.sort(function(a, b) {
        return a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true });
    });
    IC.log('Corpus ordenado alfabéticamente');
    IC.renderGallery();
}

function initSortButton() {
    var btn = document.getElementById('btnSortAlpha');
    if (btn) btn.addEventListener('click', sortAlpha);
}

// ========== LOAD FILES ==========
function loadFiles(files) {
    var imgs = Array.from(files).filter(function(f) { return f.type.startsWith('image/'); });
    if (!imgs.length) return;

    // Sort files alphabetically before loading
    imgs.sort(function(a, b) { return a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true }); });

    IC.pushUndo();
    var slots = new Array(imgs.length), loaded = 0;

    imgs.forEach(function(f, i) {
        var r = new FileReader();
        r.onload = function(ev) {
            slots[i] = {
                id: IC.uid(), name: f.name, dataUrl: ev.target.result,
                metadata: { source: '', author: '', date: '', medium: '', context: '', custom: '' },
                tags: [], generalNotes: '', annotations: [], relations: [],
                canvasObjects: [], collectionIds: []
            };
            loaded++;

            if (loaded === imgs.length) {
                // Append sorted batch
                slots.forEach(function(img) { IC.state.images.push(img); });

                // Re-sort entire corpus alphabetically
                IC.state.images.sort(function(a, b) {
                    return a.name.localeCompare(b.name, 'es', { sensitivity: 'base', numeric: true });
                });

                IC.renderGallery();
                IC.renderCorpusTags();
                if (IC.state.viewMode === 'grid' && IC.renderGridView) IC.renderGridView();
                if (!IC.state.currentImageId && IC.state.images.length) {
                    if (IC.state.viewMode === 'single') selectImage(IC.state.images[0].id);
                    else IC.state.currentImageId = IC.state.images[0].id;
                }
                IC.log(imgs.length + ' imágenes añadidas al corpus');
            }
        };
        r.readAsDataURL(f);
    });
}

// ========== FILE INPUT ==========
function initFileInput() {
    var fileInput = document.getElementById('fileInput');
    if (!fileInput) { console.error('fileInput element not found'); return; }
    fileInput.addEventListener('change', function(e) {
        loadFiles(e.target.files);
        e.target.value = '';
    });

    var btn = document.getElementById('btnAddImages');
    if (!btn) { console.error('btnAddImages element not found'); return; }
    btn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        fileInput.click();
    });
}

// ========== DRAG-DROP FILES ==========
function initDragDropFiles() {
    var dz = document.getElementById('galleryScroll');
    ['dragenter', 'dragover'].forEach(function(ev) {
        dz.addEventListener(ev, function(e) {
            // Only show file-drop highlight if dragging files from OS (not gallery reorder)
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') >= 0) {
                e.preventDefault(); e.stopPropagation();
                dz.classList.add('drag-over');
            }
        });
    });
    ['dragleave', 'drop'].forEach(function(ev) {
        dz.addEventListener(ev, function(e) {
            e.preventDefault(); e.stopPropagation();
            dz.classList.remove('drag-over');
        });
    });
    dz.addEventListener('drop', function(e) {
        if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
    });

    var ws = document.getElementById('workspace');
    ws.addEventListener('dragover', function(e) { e.preventDefault(); });
    ws.addEventListener('drop', function(e) {
        e.preventDefault();
        if (e.dataTransfer.files.length) loadFiles(e.dataTransfer.files);
    });
}

// ========== GALLERY RENDERING ==========
var dragSrcId = null;

IC.renderGallery = function() {
    var g = document.getElementById('gallery');
    var empty = document.getElementById('galleryEmpty');
    var visible = IC.getVisibleImages();

    if (!visible.length) {
        g.innerHTML = '';
        empty.classList.remove('hidden');
        var p = empty.querySelector('p');
        if (p) p.textContent = IC.state.activeCollectionId
            ? 'Colección vacía. Asigna imágenes desde "Colecciones".'
            : 'Arrastra imágenes aquí';
        return;
    }
    empty.classList.add('hidden');

    g.innerHTML = visible.map(function(img, idx) {
        var cl = ['gallery-item'];
        if (img.id === IC.state.currentImageId) cl.push('active');
        if (IC.state.batchSelected.has(img.id)) cl.push('selected');
        var globalIdx = IC.state.images.indexOf(img) + 1;

        // Status badges
        var status = '';
        var annCats = [];
        (img.annotations || []).forEach(function(a) {
            if (annCats.indexOf(a.categoryId) < 0) annCats.push(a.categoryId);
        });
        var dots = annCats.slice(0, 4).map(function(cid) {
            return '<span class="item-status-dot" style="background:' + IC.getCategoryColor(cid) + '"></span>';
        }).join('');
        var icons = '';
        if ((img.tags || []).length) icons += '<span class="item-status-icon material-symbols-outlined">label</span>';
        if (img.generalNotes) icons += '<span class="item-status-icon material-symbols-outlined">notes</span>';
        if ((img.collectionIds || []).length) icons += '<span class="item-status-icon material-symbols-outlined">folder</span>';
        status = dots || icons ? '<div class="item-status">' + dots + icons + '</div>' : '';

        return '<div class="' + cl.join(' ') + '" data-id="' + img.id + '" draggable="true">' +
            '<img src="' + img.dataUrl + '" loading="lazy" draggable="false">' +
            '<span class="item-idx">' + globalIdx + '</span>' +
            status +
            '<div class="batch-ck"></div>' +
            '<button class="item-remove" data-id="' + img.id + '">&times;</button>' +
        '</div>';
    }).join('');

    // Apply thumbnail size
    if (IC.state.thumbSize) {
        g.style.gridTemplateColumns = 'repeat(auto-fill, minmax(' + IC.state.thumbSize + 'px, 1fr))';
    }

    // Click handlers
    g.querySelectorAll('.gallery-item').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (e.target.classList.contains('item-remove')) return;
            var id = el.dataset.id;

            if (e.ctrlKey || e.metaKey) {
                // Cmd/Ctrl+click: toggle selection
                IC.toggleSelect(id);
            } else {
                // Normal click: open image (and clear selection)
                if (IC.state.batchSelected.size > 0) {
                    IC.state.batchSelected.clear();
                    IC.updateSelBar();
                }
                selectImage(id);
            }
        });

        // ===== DRAG REORDER =====
        el.addEventListener('dragstart', function(e) {
            dragSrcId = el.dataset.id;
            el.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', el.dataset.id);
        });

        el.addEventListener('dragend', function() {
            el.classList.remove('dragging');
            clearDragIndicators();
            dragSrcId = null;
        });

        el.addEventListener('dragover', function(e) {
            if (!dragSrcId || dragSrcId === el.dataset.id) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';

            clearDragIndicators();
            var rect = el.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            if (e.clientY < midY) {
                el.classList.add('drag-above');
            } else {
                el.classList.add('drag-below');
            }
        });

        el.addEventListener('dragleave', function() {
            el.classList.remove('drag-above', 'drag-below');
        });

        el.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            if (!dragSrcId || dragSrcId === el.dataset.id) return;

            var targetId = el.dataset.id;
            var srcIdx = IC.state.images.findIndex(function(i) { return i.id === dragSrcId; });
            var tgtIdx = IC.state.images.findIndex(function(i) { return i.id === targetId; });
            if (srcIdx < 0 || tgtIdx < 0) return;

            IC.pushUndo();

            // Determine insert position
            var rect = el.getBoundingClientRect();
            var midY = rect.top + rect.height / 2;
            var insertAfter = e.clientY >= midY;

            // Remove source
            var moved = IC.state.images.splice(srcIdx, 1)[0];

            // Recalculate target index after removal
            var newTgtIdx = IC.state.images.findIndex(function(i) { return i.id === targetId; });
            if (insertAfter) newTgtIdx++;
            IC.state.images.splice(newTgtIdx, 0, moved);

            IC.log('Imagen "' + moved.name + '" reordenada manualmente');
            clearDragIndicators();
            dragSrcId = null;
            IC.renderGallery();
        });
    });

    // Remove buttons
    g.querySelectorAll('.item-remove').forEach(function(b) {
        b.addEventListener('click', function(e) {
            e.stopPropagation();
            IC.pushUndo();
            var id = b.dataset.id;
            IC.state.images = IC.state.images.filter(function(i) { return i.id !== id; });
            if (IC.state.currentImageId === id) {
                IC.state.currentImageId = IC.state.images.length ? IC.state.images[0].id : null;
                if (IC.state.currentImageId) selectImage(IC.state.currentImageId);
                else { IC.showCanvasEmpty(true); clearPanels(); }
            }
            IC.renderGallery();
            IC.renderCorpusTags();
        });
    });
};

function clearDragIndicators() {
    document.querySelectorAll('.gallery-item.drag-above,.gallery-item.drag-below').forEach(function(el) {
        el.classList.remove('drag-above', 'drag-below');
    });
}

// ========== SELECT IMAGE ==========
function selectImage(id) {
    IC.saveCurrentCanvasState();
    IC.state.currentImageId = id;
    var img = IC.getCurrentImage();
    if (!img) return;
    IC.renderGallery();
    IC.loadImageToCanvas(img);
    IC.renderAnnotationsPanel(img);
    IC.renderMetadataPanel(img);
    IC.renderTagsPanel(img);
    if (IC.renderCollectionsTree) IC.renderCollectionsTree();
}
IC.selectImage = selectImage;

// ========== GRID VIEW ==========
IC.renderGridView = function() {
    var c = document.getElementById('gridViewInner');
    var imgs = IC.getVisibleImages();
    if (!imgs.length) {
        c.innerHTML = '<div style="color:var(--t3);padding:40px;text-align:center">Sin imágenes' +
            (IC.state.activeCollectionId ? ' en esta colección' : '') + '.</div>';
        return;
    }
    c.innerHTML = imgs.map(function(img) {
        var globalIdx = IC.state.images.indexOf(img) + 1;
        var isSel = IC.state.batchSelected.has(img.id);
        var tags = (img.tags || []).slice(0, 4).map(function(t) {
            return '<span class="grid-item-tag">' + IC.esc(t) + '</span>';
        }).join('');
        var annCount = (img.annotations || []).length;
        var selClass = isSel ? ' grid-item-selected' : '';

        return '<div class="grid-item' + selClass + '" data-id="' + img.id + '">' +
            '<div class="grid-item-img"><img src="' + img.dataUrl + '" loading="lazy"></div>' +
            '<div class="grid-item-body">' +
                '<div class="grid-item-name">' + globalIdx + '. ' + IC.esc(img.name) + '</div>' +
                (annCount ? '<div style="font-size:10px;color:var(--t3);margin-bottom:2px">' + annCount + ' anotaciones</div>' : '') +
                (tags ? '<div class="grid-item-tags">' + tags + '</div>' : '') +
            '</div>' +
        '</div>';
    }).join('');

    c.querySelectorAll('.grid-item').forEach(function(el) {
        // Single click: select/deselect
        el.addEventListener('click', function(e) {
            var id = el.dataset.id;
            if (e.detail > 1) return; // ignore dblclick
            if (IC.state.batchSelected.has(id)) {
                IC.state.batchSelected.delete(id);
            } else {
                IC.state.batchSelected.add(id);
            }
            if (IC.updateSelBar) IC.updateSelBar();
            IC.renderGridView();
        });

        // Double click: open in single view
        el.addEventListener('dblclick', function() {
            IC.state.currentImageId = el.dataset.id;
            IC.setViewMode('single');
            selectImage(el.dataset.id);
        });
    });
};

// ========== CLEAR PANELS ==========
function clearPanels() {
    document.getElementById('genNotes').value = '';
    document.getElementById('genNotesDisplay').textContent = 'Clic para agregar...';
    document.getElementById('genNotesDisplay').classList.add('empty');
    document.getElementById('genNotesDisplay').classList.remove('hidden');
    document.getElementById('genNotes').classList.add('hidden');
    document.getElementById('genNotesHint').classList.add('hidden');
    document.getElementById('annList').innerHTML = '';
    document.getElementById('annCount').textContent = '0';
}

})();
