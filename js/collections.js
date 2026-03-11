/* ========================================
   IMG-CORPUS V2 — Collections
   Navigation, filtering, assignment
   ======================================== */
(function(){

IC.initCollections = function() {
    // New collection button
    document.getElementById('btnAddCollection').addEventListener('click', function() {
        document.getElementById('collModalTitle').textContent = 'Nueva colección';
        document.getElementById('collName').value = '';
        document.getElementById('collNotes').value = '';
        populateParentSelect('');
        IC.openModal('modalCollection');
        setTimeout(function() { document.getElementById('collName').focus(); }, 100);
    });

    document.getElementById('btnCollApply').addEventListener('click', function() {
        var name = document.getElementById('collName').value.trim();
        if (!name) return;
        IC.pushUndo();
        var coll = {
            id: IC.uid(), name: name,
            parentId: document.getElementById('collParent').value || null,
            notes: document.getElementById('collNotes').value.trim(),
            imageOrder: []
        };
        IC.state.collections.push(coll);
        IC.log('Colección creada: ' + name);
        IC.closeModal('modalCollection');
        IC.renderCollectionsTree();
    });

    // Clear filter button
    document.getElementById('collFilterClear').addEventListener('click', function() {
        IC.setActiveCollection(null);
    });
};

function populateParentSelect(exclude) {
    var sel = document.getElementById('collParent');
    sel.innerHTML = '<option value="">— Raíz —</option>';
    IC.state.collections.forEach(function(c) {
        if (c.id !== exclude)
            sel.innerHTML += '<option value="' + c.id + '">' + IC.esc(c.name) + '</option>';
    });
}

// ========== SET ACTIVE COLLECTION (the core filter) ==========
IC.setActiveCollection = function(collId) {
    IC.state.activeCollectionId = collId;
    IC.state.batchSelected.clear();

    // Update filter bar
    var bar = document.getElementById('collFilterBar');
    if (collId) {
        var coll = IC.state.collections.find(function(c) { return c.id === collId; });
        document.getElementById('collFilterName').textContent = coll ? coll.name : '';
        bar.classList.remove('hidden');
    } else {
        bar.classList.add('hidden');
    }

    // Re-render everything that depends on visible images
    IC.renderGallery();
    if (IC.updateSelBar) IC.updateSelBar();

    var visible = IC.getVisibleImages();

    // If current image is not in visible set, switch to first visible
    if (IC.state.currentImageId && !visible.find(function(i) { return i.id === IC.state.currentImageId; })) {
        IC.state.currentImageId = visible.length ? visible[0].id : null;
    }

    // Refresh active view
    if (IC.state.viewMode === 'grid' && IC.renderGridView) IC.renderGridView();
    else if (IC.state.viewMode === 'concordance' && IC.renderConcordance) IC.renderConcordance();
    else if (IC.state.viewMode === 'graph' && IC.renderGraph) IC.renderGraph();
    else if (IC.state.currentImageId) {
        var img = IC.getCurrentImage();
        if (img) {
            IC.loadImageToCanvas(img);
            IC.renderAnnotationsPanel(img);
            IC.renderMetadataPanel(img);
            IC.renderTagsPanel(img);
        }
    } else {
        IC.showCanvasEmpty(true);
    }

    // Update collection tree highlighting
    IC.renderCollectionsTree();
};

// ========== RENDER TREE ==========
IC.renderCollectionsTree = function() {
    var container = document.getElementById('collectionsTree');
    if (!IC.state.collections.length) {
        container.innerHTML = '<div class="coll-empty">Crea tu primera colección.</div>';
        return;
    }

    var curImg = IC.getCurrentImage();
    var activeId = IC.state.activeCollectionId;

    function buildTree(parentId) {
        var children = IC.state.collections.filter(function(c) {
            return (c.parentId || null) === (parentId || null);
        });
        if (!children.length) return '';
        return children.map(function(c) {
            var imgCount = IC.state.images.filter(function(i) {
                return (i.collectionIds || []).indexOf(c.id) >= 0;
            }).length;
            var curInColl = curImg && (curImg.collectionIds || []).indexOf(c.id) >= 0;
            var isActive = c.id === activeId;
            var sub = buildTree(c.id);

            var rowClass = 'coll-row';
            if (isActive) rowClass += ' active';
            if (curInColl) rowClass += ' coll-has-current';

            return '<div class="coll-node">' +
                '<div class="' + rowClass + '" data-id="' + c.id + '">' +
                    '<span class="material-symbols-outlined" style="font-size:15px">' + (sub ? 'folder_open' : 'folder') + '</span>' +
                    '<span class="coll-label">' + IC.esc(c.name) + '</span>' +
                    '<span class="coll-count">' + imgCount + '</span>' +
                    '<div class="coll-actions">' +
                        '<button data-action="assign" data-id="' + c.id + '" title="Agregar imágenes"><span class="material-symbols-outlined" style="font-size:14px">add_circle_outline</span></button>' +
                        (curInColl ? '<button data-action="unassign" data-id="' + c.id + '" title="Quitar imagen activa"><span class="material-symbols-outlined" style="font-size:14px">remove_circle_outline</span></button>' : '') +
                        '<button data-action="delete" data-id="' + c.id + '" title="Eliminar"><span class="material-symbols-outlined" style="font-size:14px">delete_outline</span></button>' +
                    '</div>' +
                '</div>' + sub +
            '</div>';
        }).join('');
    }

    // Add "All corpus" row at top
    var allActive = !activeId;
    container.innerHTML =
        '<div class="coll-row' + (allActive ? ' active' : '') + '" data-id="__all">' +
            '<span class="material-symbols-outlined" style="font-size:15px">photo_library</span>' +
            '<span class="coll-label">Todo el corpus</span>' +
            '<span class="coll-count">' + IC.state.images.length + '</span>' +
        '</div>' +
        buildTree(null);

    // Click to filter
    container.querySelectorAll('.coll-row').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (e.target.closest('.coll-actions')) return;
            var id = el.dataset.id;
            if (id === '__all') {
                IC.setActiveCollection(null);
            } else {
                IC.setActiveCollection(id);
            }
        });
    });

    // Assign images
    container.querySelectorAll('[data-action="assign"]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            var collId = btn.dataset.id;
            var collName = (IC.state.collections.find(function(c) { return c.id === collId; }) || {}).name || '';
            var targets;

            if (IC.state.batchSelected.size > 0) {
                targets = IC.state.images.filter(function(i) { return IC.state.batchSelected.has(i.id); });
            } else if (curImg) {
                targets = [curImg];
            } else {
                alert('Selecciona o abre una imagen primero.');
                return;
            }

            IC.pushUndo();
            var added = 0;
            targets.forEach(function(img) {
                if (!img.collectionIds) img.collectionIds = [];
                if (img.collectionIds.indexOf(collId) < 0) { img.collectionIds.push(collId); added++; }
            });
            if (added > 0) {
                IC.log(added + ' imagen(es) asignada(s) a "' + collName + '"');
                IC.renderCollectionsTree();
                // If we're viewing this collection, refresh gallery
                if (IC.state.activeCollectionId === collId) IC.renderGallery();
            }
        });
    });

    // Unassign current image
    container.querySelectorAll('[data-action="unassign"]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!curImg) return;
            var collId = btn.dataset.id;
            var collName = (IC.state.collections.find(function(c) { return c.id === collId; }) || {}).name || '';
            IC.pushUndo();
            curImg.collectionIds = (curImg.collectionIds || []).filter(function(x) { return x !== collId; });
            IC.log('Imagen quitada de "' + collName + '"');
            IC.renderCollectionsTree();
            if (IC.state.activeCollectionId === collId) IC.renderGallery();
        });
    });

    // Delete collection
    container.querySelectorAll('[data-action="delete"]').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (!confirm('¿Eliminar esta colección?')) return;
            IC.pushUndo();
            var id = btn.dataset.id;
            var coll = IC.state.collections.find(function(c) { return c.id === id; });
            IC.state.collections.forEach(function(c) { if (c.parentId === id) c.parentId = coll ? coll.parentId : null; });
            IC.state.images.forEach(function(i) { if (i.collectionIds) i.collectionIds = i.collectionIds.filter(function(x) { return x !== id; }); });
            IC.state.collections = IC.state.collections.filter(function(c) { return c.id !== id; });
            IC.log('Colección eliminada: ' + (coll ? coll.name : ''));
            if (IC.state.activeCollectionId === id) IC.setActiveCollection(null);
            else IC.renderCollectionsTree();
        });
    });
};

// Populate report collection select
IC.populateReportCollections = function() {
    var sel = document.getElementById('reportCollection');
    sel.innerHTML = '<option value="">Todo el corpus / selección batch</option>';
    IC.state.collections.forEach(function(c) {
        sel.innerHTML += '<option value="' + c.id + '"' +
            (IC.state.activeCollectionId === c.id ? ' selected' : '') +
            '>' + IC.esc(c.name) + '</option>';
    });
};

// Get images for a collection (including subcollections)
IC.getCollectionImages = function(collId) {
    var ids = new Set();
    function gather(pid) {
        IC.state.images.forEach(function(i) {
            if ((i.collectionIds || []).indexOf(pid) >= 0) ids.add(i.id);
        });
        IC.state.collections.filter(function(c) { return c.parentId === pid; })
            .forEach(function(c) { gather(c.id); });
    }
    gather(collId);
    return IC.state.images.filter(function(i) { return ids.has(i.id); });
};

})();
