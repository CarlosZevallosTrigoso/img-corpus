/* ========================================
   IMG-CORPUS — Corpus Management
   Image management, gallery, metadata, tags
   ======================================== */

(function() {

IC.initCorpus = function() {
    initFileInput();
    initMetadataListeners();
    initTagListeners();
};

// ========== FILE INPUT ==========
function initFileInput() {
    const fileInput = document.getElementById('fileInput');
    fileInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;

        IC.pushUndo();
        const slots = new Array(files.length);
        let loaded = 0;

        files.forEach((file, idx) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                slots[idx] = {
                    id: IC.uid(),
                    name: file.name,
                    dataUrl: ev.target.result,
                    metadata: {
                        source: '',
                        author: '',
                        date: '',
                        medium: '',
                        context: '',
                        custom: '',
                    },
                    tags: [],
                    generalNotes: '',
                    annotations: [],
                    canvasObjects: [],
                };
                loaded++;

                if (loaded === files.length) {
                    // Append in original file-picker order
                    slots.forEach(img => IC.state.images.push(img));
                    IC.renderGallery();
                    IC.renderCorpusTags();
                    if (IC.state.viewMode === 'grid') {
                        IC.renderGridView();
                    }
                    if (!IC.state.currentImageId && IC.state.images.length > 0) {
                        if (IC.state.viewMode === 'single') {
                            selectImage(IC.state.images[0].id);
                        } else {
                            IC.state.currentImageId = IC.state.images[0].id;
                        }
                    }
                }
            };
            reader.readAsDataURL(file);
        });

        // Reset input
        fileInput.value = '';
    });
}

// ========== GALLERY RENDERING ==========
IC.renderGallery = function() {
    const gallery = document.getElementById('gallery');
    const emptyEl = document.getElementById('galleryEmpty');

    if (IC.state.images.length === 0) {
        gallery.innerHTML = '';
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');

    gallery.innerHTML = IC.state.images.map((img, idx) => {
        const isActive = img.id === IC.state.currentImageId;
        const isBatchSel = IC.state.batchSelected.has(img.id);
        const classes = ['gallery-item'];
        if (isActive) classes.push('active');
        if (isBatchSel) classes.push('batch-selected');

        // Category badges
        const usedCats = new Set((img.annotations || []).map(a => a.categoryId));
        const badges = Array.from(usedCats).slice(0, 4).map(catId => {
            const color = IC.getCategoryColor(catId);
            return `<span class="item-badge" style="background:${color}"></span>`;
        }).join('');

        return `
        <div class="${classes.join(' ')}" data-img-id="${img.id}">
            <img src="${img.dataUrl}" alt="${img.name}" loading="lazy">
            <span class="item-index">${idx + 1}</span>
            <div class="item-badges">${badges}</div>
            <div class="batch-check"></div>
            <button class="item-remove" data-img-id="${img.id}" title="Eliminar">&times;</button>
        </div>`;
    }).join('');

    // Event listeners
    gallery.querySelectorAll('.gallery-item').forEach(el => {
        el.addEventListener('click', (e) => {
            if (e.target.classList.contains('item-remove')) return;
            const imgId = el.dataset.imgId;

            if (IC.state.batchMode) {
                if (IC.state.batchSelected.has(imgId)) {
                    IC.state.batchSelected.delete(imgId);
                } else {
                    IC.state.batchSelected.add(imgId);
                }
                IC.renderGallery();
                IC.updateBatchCount();
                if (IC.state.viewMode === 'grid') IC.renderGridView();
            } else {
                selectImage(imgId);
            }
        });
    });

    gallery.querySelectorAll('.item-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const imgId = btn.dataset.imgId;
            IC.pushUndo();
            IC.state.images = IC.state.images.filter(i => i.id !== imgId);
            if (IC.state.currentImageId === imgId) {
                IC.state.currentImageId = IC.state.images.length > 0 ? IC.state.images[0].id : null;
                if (IC.state.currentImageId) {
                    selectImage(IC.state.currentImageId);
                } else {
                    IC.showCanvasEmpty(true);
                    clearPanels();
                }
            }
            IC.renderGallery();
            IC.renderCorpusTags();
        });
    });
};

// ========== SELECT IMAGE ==========
function selectImage(imgId) {
    // Save current before switching
    IC.saveCurrentCanvasState();

    IC.state.currentImageId = imgId;
    const img = IC.getCurrentImage();
    if (!img) return;

    IC.renderGallery();
    IC.loadImageToCanvas(img);
    IC.renderAnnotationsPanel(img);
    IC.renderMetadataPanel(img);
    IC.renderTagsPanel(img);
}

IC.selectImage = selectImage;

// ========== METADATA ==========
IC.renderMetadataPanel = function(img) {
    if (!img) return;
    document.getElementById('metaSource').value = img.metadata.source || '';
    document.getElementById('metaAuthor').value = img.metadata.author || '';
    document.getElementById('metaDate').value = img.metadata.date || '';
    document.getElementById('metaMedium').value = img.metadata.medium || '';
    document.getElementById('metaContext').value = img.metadata.context || '';
    document.getElementById('metaCustom').value = img.metadata.custom || '';
};

function initMetadataListeners() {
    const fields = ['metaSource', 'metaAuthor', 'metaDate', 'metaMedium', 'metaContext', 'metaCustom'];
    const keys = ['source', 'author', 'date', 'medium', 'context', 'custom'];

    fields.forEach((fieldId, idx) => {
        document.getElementById(fieldId).addEventListener('input', (e) => {
            const img = IC.getCurrentImage();
            if (img) img.metadata[keys[idx]] = e.target.value;
        });
    });
}

// ========== TAGS ==========
IC.renderTagsPanel = function(img) {
    if (!img) return;
    const container = document.getElementById('tagsCloud');

    container.innerHTML = (img.tags || []).map(tag =>
        `<span class="tag-chip">
            ${tag}
            <button class="tag-remove" data-tag="${tag}">&times;</button>
        </span>`
    ).join('');

    container.querySelectorAll('.tag-remove').forEach(btn => {
        btn.addEventListener('click', () => {
            IC.pushUndo();
            img.tags = img.tags.filter(t => t !== btn.dataset.tag);
            IC.renderTagsPanel(img);
            IC.renderCorpusTags();
        });
    });
};

IC.renderCorpusTags = function() {
    const tagCounts = {};
    IC.state.images.forEach(img => {
        (img.tags || []).forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });

    const container = document.getElementById('corpusTags');
    const sorted = Object.entries(tagCounts).sort((a,b) => b[1] - a[1]);

    container.innerHTML = sorted.map(([tag, count]) =>
        `<span class="corpus-tag" data-tag="${tag}">
            ${tag} <span class="tag-count">${count}</span>
        </span>`
    ).join('');

    if (sorted.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:11px;">Sin etiquetas en el corpus.</p>';
    }
};

function initTagListeners() {
    const input = document.getElementById('tagInput');
    const addBtn = document.getElementById('btnAddTag');

    function addTag() {
        const img = IC.getCurrentImage();
        if (!img) return;
        const raw = input.value.trim().toLowerCase();
        if (!raw) return;

        IC.pushUndo();
        const tags = raw.split(',').map(t => t.trim()).filter(Boolean);
        tags.forEach(tag => {
            if (!img.tags.includes(tag)) img.tags.push(tag);
        });
        input.value = '';
        IC.renderTagsPanel(img);
        IC.renderCorpusTags();
    }

    addBtn.addEventListener('click', addTag);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') addTag();
    });
}

// ========== CLEAR PANELS ==========
function clearPanels() {
    document.getElementById('generalNotes').value = '';
    document.getElementById('generalNotes').classList.add('hidden');
    const gnd = document.getElementById('generalNotesDisplay');
    gnd.textContent = 'Clic para agregar notas...';
    gnd.classList.add('empty');
    gnd.classList.remove('hidden');
    document.getElementById('generalNotesHint').style.display = 'none';
    document.getElementById('annotationsList').innerHTML = '';
    document.getElementById('annotationCount').textContent = '0';
    document.getElementById('metaSource').value = '';
    document.getElementById('metaAuthor').value = '';
    document.getElementById('metaDate').value = '';
    document.getElementById('metaMedium').value = '';
    document.getElementById('metaContext').value = '';
    document.getElementById('metaCustom').value = '';
    document.getElementById('tagsCloud').innerHTML = '';
}

})();
