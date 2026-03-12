/* ========================================
   IMG-CORPUS V2 — Core
   State, undo/redo, initialization
   ======================================== */
window.IC = window.IC || {};

// ========== DATA MODEL ==========
IC.state = {
    images: [],
    categories: [],
    collections: [],       // {id, name, parentId, notes, imageOrder:[]}
    chains: [],            // {id, name, description, color, links:[{imageId,annotationId}]}
    diary: [],             // {id, date, text}
    auditLog: [],          // {date, text}
    customMetaSchema: [],  // {id, name, type, options:[]}
    annotationLevels: ['Nivel 1', 'Nivel 2', 'Nivel 3'],
    currentImageId: null,
    batchSelected: new Set(),
    activeTool: 'select',
    activeCategory: null,
    viewMode: 'single',
    activeCollectionId: null,
    canvasBg: '#111118',
    sessionName: 'Sesión sin título',
};

/*  IMAGE SHAPE:
    {id, name, dataUrl,
     metadata:{source,author,date,medium,context,custom,...dynamic},
     tags:[], notes:[{id,text}],
     annotations:[{
       id, number, categoryId, type,
       levels:{}, badges:[{uid,x,y}], chainIds:[], _pending:bool
     }],
     relations:[{id,fromAnnId,toAnnId,type,note}],
     canvasObjects:[], collectionIds:[]}
*/

// ========== UNDO / REDO ==========
IC.undoStack = []; IC.redoStack = []; IC.MAX_UNDO = 50;

IC.pushUndo = function() {
    IC.undoStack.push(JSON.stringify({
        images: IC.state.images,
        categories: IC.state.categories,
        collections: IC.state.collections,
        chains: IC.state.chains,
        annotationLevels: IC.state.annotationLevels,
    }));
    if (IC.undoStack.length > IC.MAX_UNDO) IC.undoStack.shift();
    IC.redoStack = [];
};

IC.undo = function() {
    if (!IC.undoStack.length) return;
    IC.redoStack.push(JSON.stringify({ images:IC.state.images, categories:IC.state.categories, collections:IC.state.collections, chains:IC.state.chains, annotationLevels:IC.state.annotationLevels }));
    var s = JSON.parse(IC.undoStack.pop());
    IC.state.images = s.images; IC.state.categories = s.categories;
    IC.state.collections = s.collections; IC.state.chains = s.chains;
    IC.state.annotationLevels = s.annotationLevels || IC.state.annotationLevels;
    IC.refreshAll();
};

IC.redo = function() {
    if (!IC.redoStack.length) return;
    IC.undoStack.push(JSON.stringify({ images:IC.state.images, categories:IC.state.categories, collections:IC.state.collections, chains:IC.state.chains, annotationLevels:IC.state.annotationLevels }));
    var s = JSON.parse(IC.redoStack.pop());
    IC.state.images = s.images; IC.state.categories = s.categories;
    IC.state.collections = s.collections; IC.state.chains = s.chains;
    IC.state.annotationLevels = s.annotationLevels || IC.state.annotationLevels;
    IC.refreshAll();
};

// ========== HELPERS ==========
IC.uid = function() { return Date.now().toString(36) + Math.random().toString(36).substr(2,6); };
IC.getCurrentImage = function() { return IC.state.images.find(function(i){return i.id===IC.state.currentImageId}) || null; };
IC.getCategoryById = function(id) { return IC.state.categories.find(function(c){return c.id===id}) || null; };
IC.getCategoryColor = function(id) { var c=IC.getCategoryById(id); return c?c.color:'#888'; };
IC.hasCategories = function() { return IC.state.categories.length > 0; };
IC.esc = function(s) { return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''; };

// Central filter: returns images visible under current collection (or all)
IC.getVisibleImages = function() {
    if (!IC.state.activeCollectionId) return IC.state.images;
    return IC.getCollectionImages(IC.state.activeCollectionId);
};

IC.log = function(text) {
    IC.state.auditLog.push({ date: new Date().toISOString(), text: text });
    if (IC.state.auditLog.length > 500) IC.state.auditLog.shift();
};

// ========== TOAST ==========
IC.toast = function(msg, type) {
    var container = document.getElementById('toastContainer');
    if (!container) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type === 'warn' ? ' toast-warn' : '');
    var icon = type === 'warn' ? 'warning' : 'check_circle';
    el.innerHTML = '<span class="material-symbols-outlined">' + icon + '</span>' + msg;
    container.appendChild(el);
    requestAnimationFrame(function() { el.classList.add('visible'); });
    setTimeout(function() {
        el.classList.remove('visible');
        setTimeout(function() { el.remove(); }, 250);
    }, 2500);
};

// ========== AUTOSAVE ==========
IC._dirty = false;
IC._autosaveEnabled = true;
IC._autosaveTimer = null;

IC.markDirty = function() {
    IC._dirty = true;
    var ind = document.getElementById('autosaveIndicator');
    var txt = document.getElementById('autosaveText');
    if (ind && txt) { ind.className = 'autosave-indicator unsaved'; txt.textContent = 'sin guardar'; }
};

IC.autoSave = function() {
    if (!IC._autosaveEnabled || !IC._dirty) return;
    try {
        if (IC.saveCurrentCanvasState) IC.saveCurrentCanvasState();
        var data = {
            version: '1.0-auto', savedAt: new Date().toISOString(),
            sessionName: IC.state.sessionName, canvasBg: IC.state.canvasBg,
            categories: IC.state.categories, collections: IC.state.collections,
            chains: IC.state.chains, annotationLevels: IC.state.annotationLevels,
            diary: IC.state.diary, auditLog: IC.state.auditLog,
            customMetaSchema: IC.state.customMetaSchema,
            currentImageId: IC.state.currentImageId,
            images: IC.state.images.map(function(i) {
                return { id:i.id, name:i.name, dataUrl:i.dataUrl, metadata:i.metadata,
                    tags:i.tags, notes:i.notes||[], annotations:i.annotations,
                    relations:i.relations, canvasObjects:i.canvasObjects||[], collectionIds:i.collectionIds||[] };
            })
        };
        localStorage.setItem('img-corpus-autosave', JSON.stringify(data));
        IC._dirty = false;
        var ind = document.getElementById('autosaveIndicator');
        var txt = document.getElementById('autosaveText');
        if (ind && txt) {
            ind.className = 'autosave-indicator saving';
            txt.textContent = 'guardando...';
            setTimeout(function() { ind.className = 'autosave-indicator'; txt.textContent = 'guardado'; }, 800);
        }
    } catch (e) {
        console.error('Autosave failed:', e);
        if (e.name === 'QuotaExceededError') {
            IC.toast('Almacenamiento local lleno. Exporta tu sesión.', 'warn');
            IC._autosaveEnabled = false;
        }
    }
};

IC.loadAutoSave = function() {
    try {
        var raw = localStorage.getItem('img-corpus-autosave');
        if (!raw) return false;
        var s = JSON.parse(raw);
        if (!s.images || !s.images.length) return false;
        var savedAt = s.savedAt ? new Date(s.savedAt).toLocaleString('es-PE') : 'fecha desconocida';
        if (!confirm('Se encontró una sesión guardada automáticamente (' + s.images.length + ' imágenes, ' + savedAt + ').\n\n¿Restaurar?')) return false;
        IC.state.images = s.images;
        IC.state.categories = s.categories || [];
        IC.state.collections = s.collections || [];
        IC.state.chains = s.chains || [];
        IC.state.diary = s.diary || [];
        IC.state.auditLog = s.auditLog || [];
        IC.state.customMetaSchema = s.customMetaSchema || [];
        IC.state.canvasBg = s.canvasBg || '#111118';
        IC.state.annotationLevels = s.annotationLevels || ['Nivel 1', 'Nivel 2', 'Nivel 3'];
        IC.state.sessionName = s.sessionName || 'Sesión restaurada';
        IC.state.currentImageId = s.currentImageId || (s.images.length ? s.images[0].id : null);
        document.getElementById('sessionName').textContent = IC.state.sessionName;
        return true;
    } catch (e) {
        console.error('Load autosave failed:', e);
        return false;
    }
};

IC.clearAutoSave = function() {
    localStorage.removeItem('img-corpus-autosave');
    IC.toast('Datos locales eliminados.');
};

// Wrap pushUndo to mark dirty
var _origPushUndo = IC.pushUndo;
IC.pushUndo = function() {
    _origPushUndo();
    IC.markDirty();
};

// ========== REFRESH ==========
IC.refreshAll = function() {
    if (IC.renderGallery) IC.renderGallery();
    IC.renderCategories();
    IC.updateCategorySelects();
    if (IC.renderCorpusTags) IC.renderCorpusTags();
    if (IC.renderCollectionsTree) IC.renderCollectionsTree();
    if (IC.state.viewMode === 'grid' && IC.renderGridView) IC.renderGridView();
    else if (IC.state.viewMode === 'concordance' && IC.renderConcordance) IC.renderConcordance();
    else if (IC.state.viewMode === 'graph' && IC.renderGraph) IC.renderGraph();
    else if (IC.state.currentImageId) {
        var img = IC.getCurrentImage();
        if (img) {
            if (IC.loadImageToCanvas) IC.loadImageToCanvas(img);
            IC.renderAnnotationsPanel(img);
            IC.renderMetadataPanel(img);
            IC.renderTagsPanel(img);
        }
    }
};

IC.showCanvasEmpty = function(show) { document.getElementById('canvasEmpty').classList.toggle('hidden',!show); };

// ========== MODALS ==========
IC.openModal = function(id) { document.getElementById(id).classList.add('active'); };
IC.closeModal = function(id) { document.getElementById(id).classList.remove('active'); };

// ========== PANEL TABS ==========
function initTabs(tabSel, contentSel, prefix) {
    document.querySelectorAll(tabSel).forEach(function(tab) {
        tab.addEventListener('click', function() {
            document.querySelectorAll(tabSel).forEach(function(t){t.classList.remove('active')});
            document.querySelectorAll(contentSel).forEach(function(p){p.classList.remove('active')});
            tab.classList.add('active');
            var id = prefix + tab.dataset[Object.keys(tab.dataset)[0]].charAt(0).toUpperCase() + tab.dataset[Object.keys(tab.dataset)[0]].slice(1);
            var el = document.getElementById(id);
            if (el) el.classList.add('active');
        });
    });
}

// ========== CATEGORIES ==========
IC.renderCategories = function() {
    var c = document.getElementById('categoriesList');
    if (!IC.state.categories.length) { c.innerHTML='<p style="color:var(--t3);font-size:10px;padding:3px 0">Sin categorías.</p>'; return; }
    c.innerHTML = IC.state.categories.map(function(cat) {
        return '<div class="category-item" data-id="'+cat.id+'"><span class="cat-dot" style="background:'+cat.color+'"></span><span class="cat-name">'+IC.esc(cat.name)+'</span><button class="cat-rm" data-id="'+cat.id+'">&times;</button></div>';
    }).join('');
    c.querySelectorAll('.cat-rm').forEach(function(b) {
        b.addEventListener('click', function(e) {
            e.stopPropagation();
            IC.pushUndo();
            IC.log('Categoría eliminada: ' + (IC.getCategoryById(b.dataset.id)||{}).name);
            IC.state.categories = IC.state.categories.filter(function(x){return x.id!==b.dataset.id});
            if (IC.state.activeCategory===b.dataset.id) IC.state.activeCategory = IC.state.categories.length?IC.state.categories[0].id:null;
            IC.renderCategories(); IC.updateCategorySelects();
        });
    });
};

IC.updateCategorySelects = function() {
    var opts = IC.state.categories.length
        ? IC.state.categories.map(function(c){return '<option value="'+c.id+'">'+IC.esc(c.name)+'</option>'}).join('')
        : '<option value="" disabled>Crea una categoría</option>';
    var ts = document.getElementById('toolCategory');
    if (ts) { ts.innerHTML = opts; if (IC.state.activeCategory) ts.value = IC.state.activeCategory; }
};

// ========== ANNOTATIONS PANEL (structured) ==========
IC.renderAnnotationsPanel = function(img) {
    if (!img) return;
    if (IC.updateScopeIndicators) IC.updateScopeIndicators();
    if (IC.updateMarkerSelect) IC.updateMarkerSelect();

    // Migrate old data format
    if (img.generalNotes && (!img.notes || !img.notes.length)) {
        img.notes = [{ id: IC.uid(), text: img.generalNotes }];
        delete img.generalNotes;
    }
    if (!img.notes) img.notes = [];
    (img.annotations || []).forEach(function(a) {
        if (!a.levels) {
            a.levels = {};
            if (a.description) { a.levels['Nivel 1'] = a.description; delete a.description; }
            if (a.interpretation) { a.levels['Nivel 2'] = a.interpretation; delete a.interpretation; }
            if (a.memo) { a.levels['Nivel 3'] = a.memo; delete a.memo; }
        }
    });

    IC.renderNotesList(img);

    var container = document.getElementById('annList');
    var countEl = document.getElementById('annCount');
    if (!img.annotations || !img.annotations.length) {
        container.innerHTML = '<p style="color:var(--t3);font-size:11px;padding:6px 0">Sin anotaciones.</p>';
        countEl.textContent = '0';
        IC.renderRelationsPanel(img);
        if (IC.setupAnnotationHover) IC.setupAnnotationHover();
        return;
    }
    countEl.textContent = img.annotations.length;

    var levels = IC.state.annotationLevels;

    container.innerHTML = img.annotations.map(function(ann) {
        var cat = IC.getCategoryById(ann.categoryId);
        var cc = cat ? cat.color : '#888';
        var catOpts = IC.state.categories.map(function(c) {
            return '<option value="' + c.id + '"' + (c.id === ann.categoryId ? ' selected' : '') + '>' + IC.esc(c.name) + '</option>';
        }).join('');

        var fieldsHTML = levels.map(function(lvl, i) {
            var val = ann.levels[lvl] || '';
            var empty = !val.trim();
            return '<div class="ann-field"><div class="ann-field-label">' + IC.esc(lvl) + '</div>' +
                '<div class="ann-note-display' + (empty ? ' empty' : '') + '" data-ann="' + ann.id + '" data-key="' + IC.esc(lvl) + '">' + (empty ? 'Clic para escribir...' : IC.esc(val)) + '</div>' +
                '<textarea class="ann-note-edit hidden" data-ann="' + ann.id + '" data-key="' + IC.esc(lvl) + '">' + IC.esc(val) + '</textarea></div>';
        }).join('');

        var chainLinks = (ann.chainIds || []).map(function(cid) {
            var ch = IC.state.chains.find(function(c) { return c.id === cid; });
            return ch ? '<span class="ann-chain-link" data-chain="' + cid + '"><span class="material-symbols-outlined">link</span>' + IC.esc(ch.name) + '</span>' : '';
        }).join('');

        return '<div class="ann-item" data-ann="' + ann.id + '" style="border-left-color:' + cc + '">' +
            '<div class="ann-hdr">' +
                '<span class="ann-num" style="background:' + cc + '">' + ann.number + '</span>' +
                '<select class="ann-cat-sel" data-ann="' + ann.id + '">' + catOpts + '</select>' +
                '<button class="ann-del" data-ann="' + ann.id + '"><span class="material-symbols-outlined">close</span></button>' +
            '</div>' +
            fieldsHTML +
            (chainLinks ? '<div style="margin-top:3px">' + chainLinks + '</div>' : '') +
        '</div>';
    }).join('');

    // Wire level field display/edit
    container.querySelectorAll('.ann-note-display').forEach(function(el) {
        el.addEventListener('click', function(e) {
            e.stopPropagation();
            var ta = container.querySelector('textarea[data-ann="' + el.dataset.ann + '"][data-key="' + el.dataset.key + '"]');
            if (!ta) return;
            el.classList.add('hidden'); ta.classList.remove('hidden'); ta.focus();
        });
    });

    container.querySelectorAll('.ann-note-edit').forEach(function(el) {
        el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
            // Tab: advance to next level of same annotation (or next annotation's first level)
            if (e.key === 'Tab') {
                e.preventDefault();
                el.blur();
                var allFields = Array.from(container.querySelectorAll('.ann-note-edit'));
                var idx = allFields.indexOf(el);
                var next = e.shiftKey ? allFields[idx - 1] : allFields[idx + 1];
                if (next) {
                    // Find corresponding display to click
                    var disp = container.querySelector('.ann-note-display[data-ann="' + next.dataset.ann + '"][data-key="' + next.dataset.key + '"]');
                    if (disp) setTimeout(function() { disp.click(); }, 50);
                }
            }
        });
        el.addEventListener('blur', function() {
            var ann = img.annotations.find(function(a) { return a.id === el.dataset.ann; });
            if (!ann) return;
            ann.levels[el.dataset.key] = el.value;

            // Pending: remove if ALL levels empty
            if (ann._pending) {
                var allEmpty = IC.state.annotationLevels.every(function(lvl) { return !(ann.levels[lvl] || '').trim(); });
                if (allEmpty) {
                    if (IC.canvas) {
                        IC.canvas.getObjects().filter(function(o) { return o.annotationId === ann.id; }).forEach(function(o) { IC.canvas.remove(o); });
                        IC.canvas.renderAll();
                    }
                    img.annotations = img.annotations.filter(function(a) { return a.id !== ann.id; });
                    IC.saveCurrentCanvasState(); IC.renderAnnotationsPanel(img);
                    if (IC.updateMarkerSelect) IC.updateMarkerSelect();
                    return;
                }
                delete ann._pending;
            }

            IC.saveCurrentCanvasState();
            var disp = container.querySelector('.ann-note-display[data-ann="' + el.dataset.ann + '"][data-key="' + el.dataset.key + '"]');
            if (disp) {
                var t = el.value.trim();
                disp.textContent = t || 'Clic para escribir...';
                disp.classList.toggle('empty', !t);
                disp.classList.remove('hidden');
            }
            el.classList.add('hidden');
        });
        el.addEventListener('input', function() {
            var ann = img.annotations.find(function(a) { return a.id === el.dataset.ann; });
            if (ann) ann.levels[el.dataset.key] = el.value;
        });
    });

    // Category change
    container.querySelectorAll('.ann-cat-sel').forEach(function(el) {
        el.addEventListener('change', function() {
            var ann = img.annotations.find(function(a) { return a.id === el.dataset.ann; });
            if (!ann) return;
            IC.pushUndo(); ann.categoryId = el.value;
            if (IC.updateAnnotationColors) IC.updateAnnotationColors(ann.id, el.value);
            IC.renderAnnotationsPanel(img);
        });
    });

    // Delete
    container.querySelectorAll('.ann-del').forEach(function(el) {
        el.addEventListener('click', function() {
            IC.pushUndo();
            if (IC.canvas) { IC.canvas.getObjects().filter(function(o) { return o.annotationId === el.dataset.ann; }).forEach(function(o) { IC.canvas.remove(o); }); IC.canvas.renderAll(); }
            img.annotations = img.annotations.filter(function(a) { return a.id !== el.dataset.ann; });
            IC.state.chains.forEach(function(ch) { ch.links = ch.links.filter(function(l) { return l.annotationId !== el.dataset.ann; }); });
            img.relations = (img.relations || []).filter(function(r) { return r.fromAnnId !== el.dataset.ann && r.toAnnId !== el.dataset.ann; });
            IC.saveCurrentCanvasState(); IC.renderAnnotationsPanel(img);
            if (IC.updateMarkerSelect) IC.updateMarkerSelect();
        });
    });

    // Click to select on canvas
    container.querySelectorAll('.ann-item').forEach(function(el) {
        el.addEventListener('click', function(e) {
            if (e.target.closest('.ann-note-display,.ann-note-edit,.ann-cat-sel,.ann-del,.ann-chain-link')) return;
            if (!IC.canvas) return;
            var obj = IC.canvas.getObjects().find(function(o) { return o.annotationId === el.dataset.ann && !o._isBadge; });
            if (obj) { IC.canvas.setActiveObject(obj); IC.canvas.renderAll(); }
        });
    });

    IC.renderRelationsPanel(img);
    if (IC.setupAnnotationHover) IC.setupAnnotationHover();
};

// ========== NOTES LIST (multiple notes per image) ==========
IC.renderNotesList = function(img) {
    var c = document.getElementById('notesList');
    if (!img) { c.innerHTML = ''; return; }
    if (!img.notes) img.notes = [];

    c.innerHTML = img.notes.map(function(note, idx) {
        var empty = !note.text.trim();
        return '<div class="note-item" data-note="' + note.id + '">' +
            '<div class="note-item-hdr"><span class="note-item-label">Nota ' + (idx + 1) + '</span>' +
            '<button class="note-item-rm" data-note="' + note.id + '">&times;</button></div>' +
            '<div class="note-display' + (empty ? ' empty' : '') + '" data-note="' + note.id + '">' + (empty ? 'Clic para escribir...' : IC.esc(note.text)) + '</div>' +
            '<textarea class="note-textarea hidden" data-note="' + note.id + '">' + IC.esc(note.text) + '</textarea>' +
        '</div>';
    }).join('');

    if (!img.notes.length) {
        c.innerHTML = '<p style="color:var(--t3);font-size:10px">Sin notas. Usa + para agregar.</p>';
    }

    // Display/edit
    c.querySelectorAll('.note-display[data-note]').forEach(function(el) {
        el.addEventListener('click', function() {
            var ta = c.querySelector('textarea[data-note="' + el.dataset.note + '"]');
            if (!ta) return;
            el.classList.add('hidden'); ta.classList.remove('hidden'); ta.focus();
        });
    });

    c.querySelectorAll('.note-textarea[data-note]').forEach(function(el) {
        el.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); } });
        el.addEventListener('blur', function() {
            var note = img.notes.find(function(n) { return n.id === el.dataset.note; });
            if (note) note.text = el.value;
            IC.renderNotesList(img);
        });
        el.addEventListener('input', function() {
            var note = img.notes.find(function(n) { return n.id === el.dataset.note; });
            if (note) note.text = el.value;
        });
    });

    // Remove
    c.querySelectorAll('.note-item-rm').forEach(function(b) {
        b.addEventListener('click', function(e) {
            e.stopPropagation();
            IC.pushUndo();
            img.notes = img.notes.filter(function(n) { return n.id !== b.dataset.note; });
            IC.renderNotesList(img);
        });
    });
};

// ========== LEVELS LIST (configurable) ==========
IC.renderLevelsList = function() {
    var c = document.getElementById('levelsList');
    c.innerHTML = IC.state.annotationLevels.map(function(lvl, idx) {
        return '<div class="level-item"><span class="level-name" contenteditable="true" data-idx="' + idx + '">' + IC.esc(lvl) + '</span>' +
            '<button class="level-rm" data-idx="' + idx + '" title="Eliminar nivel">&times;</button></div>';
    }).join('');

    // Rename
    c.querySelectorAll('.level-name').forEach(function(el) {
        el.addEventListener('blur', function() {
            var idx = parseInt(el.dataset.idx);
            var oldName = IC.state.annotationLevels[idx];
            var newName = el.textContent.trim();
            if (!newName || newName === oldName) { el.textContent = oldName; return; }
            IC.pushUndo();
            IC.state.annotationLevels[idx] = newName;
            // Rename in all annotations
            IC.state.images.forEach(function(img) {
                (img.annotations || []).forEach(function(a) {
                    if (a.levels && a.levels[oldName] !== undefined) {
                        a.levels[newName] = a.levels[oldName];
                        delete a.levels[oldName];
                    }
                });
            });
            IC.log('Nivel renombrado: "' + oldName + '" → "' + newName + '"');
            var cur = IC.getCurrentImage(); if (cur) IC.renderAnnotationsPanel(cur);
        });
        el.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    });

    // Remove
    c.querySelectorAll('.level-rm').forEach(function(b) {
        b.addEventListener('click', function() {
            if (IC.state.annotationLevels.length <= 1) { alert('Debe haber al menos un nivel.'); return; }
            var idx = parseInt(b.dataset.idx);
            var name = IC.state.annotationLevels[idx];
            if (!confirm('¿Eliminar nivel "' + name + '"? Se perderá el texto de ese nivel en todas las anotaciones.')) return;
            IC.pushUndo();
            IC.state.annotationLevels.splice(idx, 1);
            IC.state.images.forEach(function(img) {
                (img.annotations || []).forEach(function(a) { if (a.levels) delete a.levels[name]; });
            });
            IC.log('Nivel eliminado: "' + name + '"');
            var cur = IC.getCurrentImage(); if (cur) IC.renderAnnotationsPanel(cur);
        });
    });
};

// ========== RELATIONS PANEL ==========
IC.renderRelationsPanel = function(img) {
    var c = document.getElementById('relationsList');
    if (!img || !img.relations || !img.relations.length) {
        c.innerHTML = '<p style="color:var(--t3);font-size:10px">Sin relaciones.</p>';
        return;
    }
    c.innerHTML = img.relations.map(function(r) {
        var from = img.annotations.find(function(a){return a.id===r.fromAnnId});
        var to = img.annotations.find(function(a){return a.id===r.toAnnId});
        return '<div class="rel-item"><span class="rel-nums">#'+(from?from.number:'?')+' → #'+(to?to.number:'?')+'</span><span class="rel-type">'+IC.esc(r.type||'relación')+'</span><button class="rel-rm" data-rel="'+r.id+'">&times;</button></div>';
    }).join('');
    c.querySelectorAll('.rel-rm').forEach(function(b) {
        b.addEventListener('click', function() {
            IC.pushUndo();
            img.relations = img.relations.filter(function(r){return r.id!==b.dataset.rel});
            IC.renderRelationsPanel(img);
        });
    });
};

// ========== METADATA PANEL ==========
IC.renderMetadataPanel = function(img) {
    if (!img) return;
    var std = document.getElementById('metaFields');
    var fields = [
        {key:'source',label:'Fuente'},{key:'author',label:'Autor'},{key:'date',label:'Fecha'},
        {key:'medium',label:'Medio'},{key:'context',label:'Contexto',multi:true},{key:'custom',label:'Notas adicionales',multi:true}
    ];
    std.innerHTML = fields.map(function(f) {
        var val = img.metadata[f.key]||'';
        if (f.multi) return '<div class="mf"><label>'+f.label+'</label><textarea data-key="'+f.key+'">'+IC.esc(val)+'</textarea></div>';
        return '<div class="mf"><label>'+f.label+'</label><input type="text" data-key="'+f.key+'" value="'+IC.esc(val)+'"></div>';
    }).join('');
    std.querySelectorAll('input,textarea').forEach(function(el) {
        el.addEventListener('input', function() { img.metadata[el.dataset.key] = el.value; });
    });

    // Custom fields
    var cust = document.getElementById('customMetaFields');
    if (!IC.state.customMetaSchema.length) { cust.innerHTML=''; return; }
    cust.innerHTML = IC.state.customMetaSchema.map(function(f) {
        var val = img.metadata['_'+f.id]||'';
        if (f.type==='select') {
            var opts = (f.options||[]).map(function(o){return '<option value="'+IC.esc(o)+'"'+(val===o?' selected':'')+'>'+IC.esc(o)+'</option>'}).join('');
            return '<div class="mf"><label>'+IC.esc(f.name)+'</label><select data-key="_'+f.id+'"><option value="">—</option>'+opts+'</select></div>';
        }
        return '<div class="mf"><label>'+IC.esc(f.name)+'</label><input type="'+(f.type==='url'?'url':f.type==='date'?'date':'text')+'" data-key="_'+f.id+'" value="'+IC.esc(val)+'"></div>';
    }).join('');
    cust.querySelectorAll('input,textarea,select').forEach(function(el) {
        el.addEventListener('input', function() { img.metadata[el.dataset.key] = el.value; });
        el.addEventListener('change', function() { img.metadata[el.dataset.key] = el.value; });
    });
};

// ========== TAGS PANEL ==========
IC.renderTagsPanel = function(img) {
    if (!img) return;
    var c = document.getElementById('tagsCloud');
    c.innerHTML = (img.tags||[]).map(function(t){
        return '<span class="tag-chip">'+IC.esc(t)+'<button class="tag-rm" data-tag="'+IC.esc(t)+'">&times;</button></span>';
    }).join('');
    c.querySelectorAll('.tag-rm').forEach(function(b) {
        b.addEventListener('click', function() {
            IC.pushUndo(); img.tags = img.tags.filter(function(t){return t!==b.dataset.tag});
            IC.renderTagsPanel(img); IC.renderCorpusTags();
        });
    });
};

IC.renderCorpusTags = function() {
    var counts = {};
    IC.state.images.forEach(function(i){(i.tags||[]).forEach(function(t){counts[t]=(counts[t]||0)+1})});
    var c = document.getElementById('corpusTags');
    var sorted = Object.entries(counts).sort(function(a,b){return b[1]-a[1]});
    c.innerHTML = sorted.length ? sorted.map(function(e){
        return '<span class="corpus-tag">'+IC.esc(e[0])+' <span class="tcount">'+e[1]+'</span></span>';
    }).join(' ') : '<p style="color:var(--t3);font-size:10px">Sin etiquetas.</p>';
};

// ========== VIEW MODE ==========
IC.setViewMode = function(mode) {
    IC.state.viewMode = mode;
    ['canvasContainer','gridView','concordanceView','graphView'].forEach(function(id){document.getElementById(id).classList.add('hidden')});
    ['btnViewSingle','btnViewGrid','btnViewConcordance','btnViewGraph'].forEach(function(id){document.getElementById(id).classList.remove('active')});

    if (mode==='grid') {
        if(IC.saveCurrentCanvasState) IC.saveCurrentCanvasState();
        document.getElementById('gridView').classList.remove('hidden');
        document.getElementById('btnViewGrid').classList.add('active');
        if(IC.renderGridView) IC.renderGridView();
    } else if (mode==='concordance') {
        if(IC.saveCurrentCanvasState) IC.saveCurrentCanvasState();
        document.getElementById('concordanceView').classList.remove('hidden');
        document.getElementById('btnViewConcordance').classList.add('active');
        if(IC.renderConcordance) IC.renderConcordance();
    } else if (mode==='graph') {
        if(IC.saveCurrentCanvasState) IC.saveCurrentCanvasState();
        document.getElementById('graphView').classList.remove('hidden');
        document.getElementById('btnViewGraph').classList.add('active');
        if(IC.renderGraph) IC.renderGraph();
    } else {
        document.getElementById('canvasContainer').classList.remove('hidden');
        document.getElementById('btnViewSingle').classList.add('active');
        setTimeout(function(){
            if(IC.canvas){var r=document.getElementById('canvasContainer').getBoundingClientRect();IC.canvas.setWidth(r.width);IC.canvas.setHeight(r.height-4);IC.canvas.renderAll()}
            var img=IC.getCurrentImage(); if(img&&IC.loadImageToCanvas) IC.loadImageToCanvas(img);
        },50);
    }
};

// ========== KEYBOARD ==========
function initKeyboard() {
    document.addEventListener('keydown', function(e) {
        var tag = e.target.tagName.toLowerCase();
        if (tag==='input'||tag==='textarea'||tag==='select'||e.target.isContentEditable) return;
        if (e.code === 'Space') return; // handled by annotator for pan
        if (e.ctrlKey||e.metaKey) { if(e.key==='z'){e.preventDefault();IC.undo()} if(e.key==='y'){e.preventDefault();IC.redo()} return; }
        switch(e.key){
            case 'ArrowLeft': e.preventDefault(); IC.navigateImage(-1); break;
            case 'ArrowRight': e.preventDefault(); IC.navigateImage(1); break;
            default: break;
        }
        switch(e.key.toLowerCase()){
            case 'v':IC.setTool('select');break;case 'r':IC.setTool('rect');break;case 'e':IC.setTool('ellipse');break;
            case 'p':IC.setTool('polygon');break;case 'd':IC.setTool('freedraw');break;case 'a':IC.setTool('arrow');break;
            case 't':IC.setTool('text');break;case 'm':IC.setTool('marker');break;case 'l':IC.setTool('relation');break;
            case 'g':IC.setViewMode('grid');break;case '1':IC.setViewMode('single');break;
            case 'c':IC.setViewMode('concordance');break;case 'x':IC.setViewMode('graph');break;
            case 'escape':IC.setTool('select');break;
            case 'delete':case 'backspace':if(IC.deleteSelectedAnnotation) IC.deleteSelectedAnnotation();break;
        }
    });
}

// Navigate to prev/next image
IC.navigateImage = function(dir) {
    var visible = IC.getVisibleImages();
    if (!visible.length) return;
    var curIdx = visible.findIndex(function(i) { return i.id === IC.state.currentImageId; });
    var newIdx = curIdx + dir;
    if (newIdx < 0) newIdx = visible.length - 1;
    if (newIdx >= visible.length) newIdx = 0;
    IC.selectImage(visible[newIdx].id);
};

IC.setTool = function(tool) {
    IC.state.activeTool = tool;
    document.querySelectorAll('.tool-btn[data-tool]').forEach(function(b){b.classList.toggle('active',b.dataset.tool===tool)});
    if (IC.applyTool) IC.applyTool(tool);
};

// ========== TOOLBAR INIT ==========
function initToolbar() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(function(b){b.addEventListener('click',function(){IC.setTool(b.dataset.tool)})});
    document.getElementById('btnZoomIn').addEventListener('click',function(){if(IC.zoomIn)IC.zoomIn()});
    document.getElementById('btnZoomOut').addEventListener('click',function(){if(IC.zoomOut)IC.zoomOut()});
    document.getElementById('btnZoomFit').addEventListener('click',function(){if(IC.zoomFit)IC.zoomFit()});
    document.getElementById('btnDeleteSel').addEventListener('click',function(){if(IC.deleteSelectedAnnotation)IC.deleteSelectedAnnotation()});
    document.getElementById('btnViewSingle').addEventListener('click',function(){IC.setViewMode('single')});
    document.getElementById('btnViewGrid').addEventListener('click',function(){IC.setViewMode('grid')});
    document.getElementById('btnViewConcordance').addEventListener('click',function(){IC.setViewMode('concordance')});
    document.getElementById('btnViewGraph').addEventListener('click',function(){IC.setViewMode('graph')});

    // BG toggle
    document.querySelectorAll('.bg-btn').forEach(function(b){
        b.addEventListener('click',function(){
            document.querySelectorAll('.bg-btn').forEach(function(x){x.classList.remove('active')}); b.classList.add('active');
            IC.state.canvasBg=b.dataset.bg;
            if(IC.canvas) IC.canvas.setBackgroundColor(b.dataset.bg,IC.canvas.renderAll.bind(IC.canvas));
        });
    });

    document.getElementById('toolCategory').addEventListener('change',function(e){IC.state.activeCategory=e.target.value});
}

// ========== HEADER BUTTONS ==========
function initHeader() {
    document.getElementById('btnUndo').addEventListener('click',IC.undo);
    document.getElementById('btnRedo').addEventListener('click',IC.redo);
    document.getElementById('btnImport').addEventListener('click',function(){document.getElementById('importFileInput').click()});
    document.getElementById('btnExport').addEventListener('click',function(){if(IC.exportSession)IC.exportSession()});
    document.getElementById('btnReport').addEventListener('click',function(){if(IC.openReportModal)IC.openReportModal();else IC.openModal('modalReport')});
    document.getElementById('btnDiary').addEventListener('click',function(){if(IC.openDiary)IC.openDiary()});
    document.getElementById('btnAuditLog').addEventListener('click',function(){if(IC.openAuditLog)IC.openAuditLog()});

    var sn = document.getElementById('sessionName');
    sn.textContent = IC.state.sessionName;
    sn.addEventListener('blur',function(){IC.state.sessionName=sn.textContent.trim()||'Sesión sin título'});
    sn.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();sn.blur()}});
}

// ========== CATEGORY UI ==========
function initCategoryUI() {
    document.getElementById('btnAddCategory').addEventListener('click',function(){
        IC.openModal('modalCategory');
        document.getElementById('catName').value='';
        document.getElementById('catColor').value='#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
        setTimeout(function(){document.getElementById('catName').focus()},100);
    });
    document.getElementById('btnCatApply').addEventListener('click',function(){
        var name=document.getElementById('catName').value.trim(),color=document.getElementById('catColor').value;
        if(!name) return;
        IC.pushUndo();
        var cat={id:'cat-'+IC.uid(),name:name,color:color};
        IC.state.categories.push(cat);
        IC.state.activeCategory=cat.id;
        IC.log('Categoría creada: '+name);
        IC.renderCategories(); IC.updateCategorySelects();
        IC.closeModal('modalCategory');
        IC.toast('Categoría "' + name + '" creada.');
    });
}

// ========== NOTES AND LEVELS ==========
function initNotesAndLevels() {
    document.getElementById('btnAddNote').addEventListener('click', function() {
        var img = IC.getCurrentImage();
        if (!img) return;
        if (!img.notes) img.notes = [];
        IC.pushUndo();
        var note = { id: IC.uid(), text: '' };
        img.notes.push(note);
        IC.renderNotesList(img);
        setTimeout(function() {
            var disp = document.querySelector('.note-display[data-note="' + note.id + '"]');
            if (disp) disp.click();
        }, 50);
    });

    // Settings modal: levels
    document.getElementById('btnAddLevel').addEventListener('click', function() {
        var name = prompt('Nombre del nuevo nivel:');
        if (!name || !name.trim()) return;
        name = name.trim();
        if (IC.state.annotationLevels.indexOf(name) >= 0) { alert('Ya existe un nivel con ese nombre.'); return; }
        IC.pushUndo();
        IC.state.annotationLevels.push(name);
        IC.log('Nivel de análisis agregado: "' + name + '"');
        IC.renderLevelsList();
        IC.toast('Nivel "' + name + '" agregado.');
        var img = IC.getCurrentImage();
        if (img) IC.renderAnnotationsPanel(img);
    });
}

// ========== GUIDED MODE ==========
function initGuideMode() {
    var btn = document.getElementById('btnGuideMode');
    // Restore state
    var saved = localStorage.getItem('img-corpus-guide-mode');
    if (saved === 'true') {
        document.body.classList.add('guided');
        btn.classList.add('active');
    }

    btn.addEventListener('click', function() {
        var isOn = document.body.classList.toggle('guided');
        btn.classList.toggle('active', isOn);
        localStorage.setItem('img-corpus-guide-mode', isOn);
        IC.toast(isOn ? 'Modo guiado activado.' : 'Modo guiado desactivado.');
    });
}

// ========== SETTINGS ==========
function initSettings() {
    document.getElementById('btnSettings').addEventListener('click', function() {
        IC.renderLevelsList();
        var cb = document.getElementById('settingsAutosave');
        if (cb) cb.checked = IC._autosaveEnabled;
        IC.openModal('modalSettings');
    });

    document.getElementById('settingsAutosave').addEventListener('change', function() {
        IC._autosaveEnabled = this.checked;
        if (!this.checked) {
            var ind = document.getElementById('autosaveIndicator');
            var txt = document.getElementById('autosaveText');
            if (ind && txt) { ind.className = 'autosave-indicator'; txt.textContent = 'desactivado'; }
        }
    });

    document.getElementById('btnClearAutosave').addEventListener('click', function() {
        if (!confirm('¿Borrar todos los datos guardados localmente?')) return;
        IC.clearAutoSave();
    });
}

// ========== BATCH MODE ==========
function initSelection() {
    // Show/hide selection bar based on selection count
    IC.updateSelBar = function() {
        var bar = document.getElementById('selBar');
        var count = IC.state.batchSelected.size;
        document.getElementById('selCount').textContent = count;
        if (count > 0) bar.classList.remove('hidden');
        else bar.classList.add('hidden');
        if (IC.updateScopeIndicators) IC.updateScopeIndicators();
    };

    // Toggle selection for an image
    IC.toggleSelect = function(imgId) {
        if (IC.state.batchSelected.has(imgId)) IC.state.batchSelected.delete(imgId);
        else IC.state.batchSelected.add(imgId);
        IC.updateSelBar();
        IC.renderGallery();
        if (IC.state.viewMode === 'grid' && IC.renderGridView) IC.renderGridView();
    };

    // Select all visible
    document.getElementById('btnSelAll').addEventListener('click', function() {
        IC.getVisibleImages().forEach(function(i) { IC.state.batchSelected.add(i.id); });
        IC.updateSelBar(); IC.renderGallery();
    });

    // Deselect all
    document.getElementById('btnSelNone').addEventListener('click', function() {
        IC.state.batchSelected.clear();
        IC.updateSelBar(); IC.renderGallery();
    });

    // Tag selection
    document.getElementById('btnSelTag').addEventListener('click', function() {
        if (!IC.state.batchSelected.size) return;
        document.getElementById('batchTagInput').value = '';
        IC.openModal('modalBatchTag');
    });
    document.getElementById('btnBatchTagApply').addEventListener('click', function() {
        var tags = document.getElementById('batchTagInput').value.split(',').map(function(t) { return t.trim().toLowerCase(); }).filter(Boolean);
        if (!tags.length) return;
        IC.pushUndo();
        IC.state.images.forEach(function(img) {
            if (IC.state.batchSelected.has(img.id))
                tags.forEach(function(t) { if (img.tags.indexOf(t) < 0) img.tags.push(t); });
        });
        IC.closeModal('modalBatchTag'); IC.renderCorpusTags();
    });

    // Delete selection
    document.getElementById('btnSelDelete').addEventListener('click', function() {
        if (!IC.state.batchSelected.size || !confirm('¿Eliminar ' + IC.state.batchSelected.size + ' imágenes?')) return;
        IC.pushUndo();
        IC.state.images = IC.state.images.filter(function(i) { return !IC.state.batchSelected.has(i.id); });
        if (IC.state.batchSelected.has(IC.state.currentImageId))
            IC.state.currentImageId = IC.state.images.length ? IC.state.images[0].id : null;
        IC.state.batchSelected.clear();
        IC.updateSelBar(); IC.refreshAll();
        if (!IC.state.currentImageId) IC.showCanvasEmpty(true);
    });

    // ===== Assign to collection =====
    document.getElementById('btnSelToCollection').addEventListener('click', function() {
        if (!IC.state.batchSelected.size) return;
        openAssignCollModal();
    });

    // Create new collection with selection
    document.getElementById('btnSelNewCollection').addEventListener('click', function() {
        if (!IC.state.batchSelected.size) return;
        var name = prompt('Nombre de la nueva colección:');
        if (!name || !name.trim()) return;
        IC.pushUndo();
        var coll = { id: IC.uid(), name: name.trim(), parentId: null, notes: '', imageOrder: [] };
        IC.state.collections.push(coll);
        // Assign selected images
        IC.state.images.forEach(function(img) {
            if (IC.state.batchSelected.has(img.id)) {
                if (!img.collectionIds) img.collectionIds = [];
                if (img.collectionIds.indexOf(coll.id) < 0) img.collectionIds.push(coll.id);
            }
        });
        IC.log('Colección "' + name.trim() + '" creada con ' + IC.state.batchSelected.size + ' imágenes');
        IC.toast('Colección "' + name.trim() + '" creada.');
        IC.state.batchSelected.clear();
        IC.updateSelBar(); IC.renderGallery();
        if (IC.renderCollectionsTree) IC.renderCollectionsTree();
    });

    // Assign collection modal: "create new" button inside modal
    document.getElementById('btnAssignCollNew').addEventListener('click', function() {
        IC.closeModal('modalAssignColl');
        var name = prompt('Nombre de la nueva colección:');
        if (!name || !name.trim()) return;
        IC.pushUndo();
        var coll = { id: IC.uid(), name: name.trim(), parentId: null, notes: '', imageOrder: [] };
        IC.state.collections.push(coll);
        assignSelectedToCollection(coll.id, name.trim());
    });
}

function openAssignCollModal() {
    var list = document.getElementById('assignCollList');
    if (!IC.state.collections.length) {
        list.innerHTML = '<p style="color:var(--t3);font-size:11px;padding:8px">Sin colecciones. Crea una nueva.</p>';
    } else {
        list.innerHTML = IC.state.collections.map(function(c) {
            var count = IC.state.images.filter(function(i) { return (i.collectionIds || []).indexOf(c.id) >= 0; }).length;
            return '<div class="assign-coll-item" data-coll="' + c.id + '">' +
                '<span class="material-symbols-outlined">folder</span>' +
                '<span class="acl-name">' + IC.esc(c.name) + '</span>' +
                '<span class="acl-count">' + count + '</span>' +
            '</div>';
        }).join('');

        list.querySelectorAll('.assign-coll-item').forEach(function(el) {
            el.addEventListener('click', function() {
                IC.closeModal('modalAssignColl');
                var coll = IC.state.collections.find(function(c) { return c.id === el.dataset.coll; });
                assignSelectedToCollection(el.dataset.coll, coll ? coll.name : '');
            });
        });
    }
    IC.openModal('modalAssignColl');
}

function assignSelectedToCollection(collId, collName) {
    IC.pushUndo();
    var added = 0;
    IC.state.images.forEach(function(img) {
        if (IC.state.batchSelected.has(img.id)) {
            if (!img.collectionIds) img.collectionIds = [];
            if (img.collectionIds.indexOf(collId) < 0) { img.collectionIds.push(collId); added++; }
        }
    });
    if (added > 0) {
        IC.log(added + ' imagen(es) añadida(s) a "' + collName + '"');
    }
    IC.state.batchSelected.clear();
    IC.updateSelBar(); IC.renderGallery();
    if (IC.renderCollectionsTree) IC.renderCollectionsTree();
    IC.toast(added + ' imagen(es) añadida(s) a "' + collName + '"');
}

// ========== CUSTOM META FIELDS ==========
function initCustomMeta() {
    document.getElementById('btnAddMetaField').addEventListener('click',function(){
        document.getElementById('metaFieldName').value='';
        document.getElementById('metaFieldType').value='text';
        document.getElementById('metaFieldOptionsRow').classList.add('hidden');
        IC.openModal('modalMetaField');
    });
    document.getElementById('metaFieldType').addEventListener('change',function(){
        document.getElementById('metaFieldOptionsRow').classList.toggle('hidden',this.value!=='select');
    });
    document.getElementById('btnMetaFieldApply').addEventListener('click',function(){
        var name=document.getElementById('metaFieldName').value.trim();
        if(!name) return;
        var type=document.getElementById('metaFieldType').value;
        var options=type==='select'?document.getElementById('metaFieldOptions').value.split(',').map(function(s){return s.trim()}).filter(Boolean):[];
        IC.state.customMetaSchema.push({id:IC.uid(),name:name,type:type,options:options});
        IC.log('Campo de metadatos personalizado creado: '+name);
        IC.closeModal('modalMetaField');
        var img=IC.getCurrentImage(); if(img) IC.renderMetadataPanel(img);
    });
}

// ========== TAG INPUT ==========
function initTagInput() {
    function add() {
        var img = IC.getCurrentImage();
        if (!img) return;
        var raw = document.getElementById('tagInput').value.trim().toLowerCase();
        if (!raw) return;
        IC.pushUndo();
        raw.split(',').map(function(t) { return t.trim(); }).filter(Boolean)
            .forEach(function(t) { if (img.tags.indexOf(t) < 0) img.tags.push(t); });
        document.getElementById('tagInput').value = '';
        IC.renderTagsPanel(img);
        IC.renderCorpusTags();
    }
    document.getElementById('btnAddTag').addEventListener('click', add);
    document.getElementById('tagInput').addEventListener('keydown', function(e) { if (e.key === 'Enter') add(); });

    // Batch apply tags to selection
    var btnTagBatch = document.getElementById('btnTagBatch');
    if (btnTagBatch) {
        btnTagBatch.addEventListener('click', function() {
            var img = IC.getCurrentImage();
            if (!img || !IC.state.batchSelected.size) return;
            var tags = img.tags.slice();
            if (!tags.length) { alert('La imagen activa no tiene etiquetas para copiar.'); return; }
            IC.pushUndo();
            var count = 0;
            IC.state.images.forEach(function(i) {
                if (IC.state.batchSelected.has(i.id)) {
                    tags.forEach(function(t) { if (i.tags.indexOf(t) < 0) { i.tags.push(t); count++; } });
                }
            });
            IC.log('Etiquetas copiadas a ' + IC.state.batchSelected.size + ' imágenes');
            IC.toast('Etiquetas copiadas a ' + IC.state.batchSelected.size + ' imágenes.');
            IC.renderCorpusTags();
        });
    }

    // Batch apply metadata to selection
    var btnMetaBatch = document.getElementById('btnMetaBatch');
    if (btnMetaBatch) {
        btnMetaBatch.addEventListener('click', function() {
            var img = IC.getCurrentImage();
            if (!img || !IC.state.batchSelected.size) return;
            var fields = ['source', 'author', 'date', 'medium', 'context', 'custom'];
            // Only copy non-empty fields
            var toCopy = {};
            fields.forEach(function(k) { if (img.metadata[k]) toCopy[k] = img.metadata[k]; });
            IC.state.customMetaSchema.forEach(function(f) {
                var v = img.metadata['_' + f.id];
                if (v) toCopy['_' + f.id] = v;
            });
            if (!Object.keys(toCopy).length) { alert('La imagen activa no tiene metadatos para copiar.'); return; }
            IC.pushUndo();
            IC.state.images.forEach(function(i) {
                if (IC.state.batchSelected.has(i.id)) {
                    Object.keys(toCopy).forEach(function(k) { i.metadata[k] = toCopy[k]; });
                }
            });
            IC.log('Metadatos copiados a ' + IC.state.batchSelected.size + ' imágenes');
            IC.toast('Metadatos copiados a ' + IC.state.batchSelected.size + ' imágenes.');
        });
    }
}

// ========== SCOPE INDICATORS ==========
IC.updateScopeIndicators = function() {
    var img = IC.getCurrentImage();
    var selCount = IC.state.batchSelected.size;
    var imgName = img ? img.name : '';
    var imgIdx = img ? (IC.state.images.indexOf(img) + 1) : 0;

    function setScope(elId, html) {
        var el = document.getElementById(elId);
        if (el) el.innerHTML = html;
    }

    var singleHTML = img
        ? '<span class="material-symbols-outlined">image</span><span class="scope-name">' + imgIdx + '. ' + IC.esc(imgName) + '</span>'
        : '<span class="material-symbols-outlined">image</span>Sin imagen seleccionada';

    ['annScope', 'metaScope', 'tagScope'].forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        el.className = 'scope-indicator';
        if (selCount > 0) {
            el.classList.add('scope-multi');
            el.innerHTML = '<span class="material-symbols-outlined">photo_library</span>' +
                '<span class="scope-name">' + selCount + ' seleccionadas</span>' +
                (img ? ' — editando: ' + imgIdx + '. ' + IC.esc(imgName) : '');
        } else {
            el.classList.add('scope-single');
            el.innerHTML = singleHTML;
        }
    });

    // Show/hide batch buttons
    var btnTagBatch = document.getElementById('btnTagBatch');
    var btnMetaBatch = document.getElementById('btnMetaBatch');
    if (btnTagBatch) {
        btnTagBatch.classList.toggle('hidden', selCount === 0);
        document.getElementById('tagBatchCount').textContent = selCount;
    }
    if (btnMetaBatch) {
        btnMetaBatch.classList.toggle('hidden', selCount === 0);
        document.getElementById('metaBatchCount').textContent = selCount;
    }
};

// ========== INFO POPOVER SYSTEM ==========
function initInfoPopovers() {
    // Create popover element
    var popover = document.createElement('div');
    popover.className = 'info-popover';
    popover.id = 'infoPopover';
    document.body.appendChild(popover);

    var hideTimeout = null;

    document.addEventListener('click', function(e) {
        var btn = e.target.closest('.info-btn');
        if (btn) {
            e.stopPropagation();
            var text = btn.dataset.info;
            var rect = btn.getBoundingClientRect();
            popover.textContent = text;
            popover.style.left = Math.max(8, rect.left - 20) + 'px';
            popover.style.top = (rect.bottom + 8) + 'px';

            // Keep within viewport
            if (rect.left + 280 > window.innerWidth) {
                popover.style.left = (window.innerWidth - 290) + 'px';
            }

            popover.classList.add('visible');
            clearTimeout(hideTimeout);
            hideTimeout = setTimeout(function() { popover.classList.remove('visible'); }, 5000);
        } else {
            popover.classList.remove('visible');
        }
    });
}

// ========== MODALS GLOBAL ==========
function initModals() {
    document.querySelectorAll('.modal-x').forEach(function(b){
        b.addEventListener('click',function(){b.closest('.modal-overlay').classList.remove('active')});
    });
    document.querySelectorAll('.modal-overlay').forEach(function(o){
        o.addEventListener('click',function(e){if(e.target===o)o.classList.remove('active')});
    });
}

// ========== SCOPED IMAGES ==========
IC.getTargetImages = function() {
    var base = IC.getVisibleImages();
    if (IC.state.batchSelected.size > 0)
        return base.filter(function(i){return IC.state.batchSelected.has(i.id)});
    return base;
};

// ========== RESIZE HANDLES ==========
function initResizeHandles() {
    setupResize('resizeLeft', 'sidebar', 'left');
    setupResize('resizeRight', 'rightPanel', 'right');
}

function setupResize(handleId, panelId, side) {
    var handle = document.getElementById(handleId);
    var panel = document.getElementById(panelId);
    if (!handle || !panel) return;

    var startX, startW;

    handle.addEventListener('mousedown', function(e) {
        e.preventDefault();
        startX = e.clientX;
        startW = panel.offsetWidth;
        handle.classList.add('dragging');
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        function onMove(e) {
            var dx = e.clientX - startX;
            var newW = side === 'left' ? startW + dx : startW - dx;
            newW = Math.max(140, Math.min(500, newW));
            panel.style.width = newW + 'px';
            // Trigger canvas resize
            if (IC.canvas) {
                var r = document.getElementById('canvasContainer').getBoundingClientRect();
                if (r.width > 0) {
                    IC.canvas.setWidth(r.width);
                    IC.canvas.setHeight(r.height - 4);
                    IC.canvas.renderAll();
                }
            }
        }

        function onUp() {
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        }

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    });
}

// ========== THUMBNAIL SLIDER ==========
function initThumbSlider() {
    var slider = document.getElementById('thumbSlider');
    if (!slider) return;
    slider.addEventListener('input', function() {
        IC.state.thumbSize = parseInt(slider.value);
        applyThumbSize();
    });
    IC.state.thumbSize = parseInt(slider.value) || 90;
}

function applyThumbSize() {
    var gallery = document.getElementById('gallery');
    if (!gallery) return;
    var size = IC.state.thumbSize || 90;
    // Calculate columns based on sidebar width and thumb size
    gallery.style.gridTemplateColumns = 'repeat(auto-fill, minmax(' + size + 'px, 1fr))';
}

// ========== HOVER HIGHLIGHT: panel → canvas ==========
IC.setupAnnotationHover = function() {
    document.querySelectorAll('.ann-item').forEach(function(el) {
        el.addEventListener('mouseenter', function() {
            var annId = el.dataset.ann;
            if (!IC.canvas || !annId) return;
            IC.canvas.getObjects().forEach(function(obj) {
                if (obj.annotationId === annId && !obj._isBadge) {
                    obj._origStrokeWidth = obj.strokeWidth;
                    obj.set({ strokeWidth: (obj.strokeWidth || 2) + 2 });
                }
            });
            IC.canvas.renderAll();
        });
        el.addEventListener('mouseleave', function() {
            var annId = el.dataset.ann;
            if (!IC.canvas || !annId) return;
            IC.canvas.getObjects().forEach(function(obj) {
                if (obj.annotationId === annId && !obj._isBadge && obj._origStrokeWidth !== undefined) {
                    obj.set({ strokeWidth: obj._origStrokeWidth });
                    delete obj._origStrokeWidth;
                }
            });
            IC.canvas.renderAll();
        });
    });
};

// ========== INIT ==========
document.addEventListener('DOMContentLoaded', function() {
    initModals();
    initTabs('.side-tab','.side-panel','side');
    initTabs('.rpanel-tab','.rpanel-content','rp');
    initHeader();
    initCategoryUI();
    initNotesAndLevels();
    initSettings();
    initGuideMode();
    initSelection();
    initToolbar();
    initKeyboard();
    initCustomMeta();
    initTagInput();
    initInfoPopovers();
    initResizeHandles();
    initThumbSlider();
    IC.renderCategories();
    IC.updateCategorySelects();

    // Try autosave restore
    var restored = IC.loadAutoSave();

    setTimeout(function() {
        try { if(IC.initCorpus) IC.initCorpus(); } catch(e) { console.error('initCorpus:', e); }
        try { if(IC.initCollections) IC.initCollections(); } catch(e) { console.error('initCollections:', e); }
        try { if(IC.initCanvas) IC.initCanvas(); } catch(e) { console.error('initCanvas:', e); }
        try { if(IC.initSearch) IC.initSearch(); } catch(e) { console.error('initSearch:', e); }
        try { if(IC.initDiary) IC.initDiary(); } catch(e) { console.error('initDiary:', e); }
        try { if(IC.initGraph) IC.initGraph(); } catch(e) { console.error('initGraph:', e); }
        try { if(IC.initExport) IC.initExport(); } catch(e) { console.error('initExport:', e); }

        if (restored) {
            IC.refreshAll();
            if (IC.state.currentImageId) IC.selectImage(IC.state.currentImageId);
            IC.toast('Sesión restaurada desde guardado local.');
        } else {
            IC.showCanvasEmpty(true);
        }

        // Start autosave timer
        IC._autosaveTimer = setInterval(IC.autoSave, 30000);
    },100);

    // Warn before closing with unsaved changes
    window.addEventListener('beforeunload', function(e) {
        if (IC._dirty && IC._autosaveEnabled) IC.autoSave(); // Save before leaving
        if (IC._dirty && IC.state.images.length > 0) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
});
