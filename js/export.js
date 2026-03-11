/* ========================================
   IMG-CORPUS — Export
   Report generation, PDF, JSON session
   ======================================== */

(function() {

IC.initExport = function() {
    initImportExport();
    initReportButtons();
};

// ========== SESSION EXPORT ==========
IC.exportSession = function() {
    // Save current canvas state first
    IC.saveCurrentCanvasState();

    const targetImages = IC.getTargetImages();
    const isPartial = targetImages.length < IC.state.images.length;

    const session = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        sessionName: IC.state.sessionName,
        canvasBg: IC.state.canvasBg,
        categories: IC.state.categories,
        images: targetImages.map(img => ({
            id: img.id,
            name: img.name,
            dataUrl: img.dataUrl,
            metadata: img.metadata,
            tags: img.tags,
            generalNotes: img.generalNotes,
            annotations: img.annotations,
            canvasObjects: img.canvasObjects || [],
        })),
    };

    const json = JSON.stringify(session, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    const safeName = IC.state.sessionName.replace(/[^a-zA-Z0-9áéíóúñü\s-]/g, '').replace(/\s+/g, '-');
    const suffix = isPartial ? `_${targetImages.length}-imgs` : '';
    a.download = `img-corpus_${safeName}${suffix}_${dateStamp()}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

// ========== SESSION IMPORT ==========
function importSession(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const session = JSON.parse(e.target.result);
            if (!session.images || !Array.isArray(session.images)) {
                alert('Archivo de sesión inválido.');
                return;
            }

            IC.pushUndo();
            IC.state.images = session.images;
            IC.state.categories = session.categories || IC.state.categories;
            IC.state.sessionName = session.sessionName || 'Sesión importada';
            IC.state.canvasBg = session.canvasBg || '#111118';
            IC.state.currentImageId = IC.state.images.length > 0 ? IC.state.images[0].id : null;

            document.getElementById('sessionName').textContent = IC.state.sessionName;
            IC.refreshAll();

            if (IC.state.currentImageId) {
                IC.selectImage(IC.state.currentImageId);
            } else {
                IC.showCanvasEmpty(true);
            }

        } catch (err) {
            alert('Error al leer el archivo: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function initImportExport() {
    const importInput = document.getElementById('importFileInput');
    importInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importSession(e.target.files[0]);
            importInput.value = '';
        }
    });
}

// ========== REPORT GENERATION ==========
function initReportButtons() {
    document.getElementById('btnReportHTML').addEventListener('click', () => {
        IC.closeModal('modalReport');
        generateReport('html');
    });

    document.getElementById('btnReportPDF').addEventListener('click', () => {
        IC.closeModal('modalReport');
        generateReport('pdf');
    });
}

async function generateReport(format) {
    // Save current state
    IC.saveCurrentCanvasState();

    const opts = {
        includeAnnotations: document.getElementById('reportIncludeAnnotations').checked,
        includeNotes: document.getElementById('reportIncludeNotes').checked,
        includeMetadata: document.getElementById('reportIncludeMetadata').checked,
        includeTags: document.getElementById('reportIncludeTags').checked,
        title: document.getElementById('reportTitle').value || 'Análisis de corpus visual',
        author: document.getElementById('reportAuthor').value || '',
    };

    // Generate canvas snapshots for scoped images
    const scopedImages = IC.getScopedImages();
    const imageSnapshots = [];

    for (const img of scopedImages) {
        let snapshot = img.dataUrl;

        if (opts.includeAnnotations && img.canvasObjects && img.canvasObjects.length > 0) {
            if (img.id === IC.state.currentImageId && IC.canvas) {
                snapshot = IC.canvas.toDataURL({ format: 'png', multiplier: 1.5 });
            } else {
                // Render offscreen
                snapshot = await renderOffscreen(img);
            }
        }

        imageSnapshots.push({ img, snapshot });
    }

    const html = buildReportHTML(imageSnapshots, opts);

    if (format === 'html') {
        downloadHTML(html, opts.title);
    } else {
        downloadPDFFromHTML(html, opts.title);
    }
}

function renderOffscreen(imgData) {
    return new Promise((resolve) => {
        // Create temp canvas
        const tempCanvasEl = document.createElement('canvas');
        tempCanvasEl.id = 'offscreen_' + Date.now();
        tempCanvasEl.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
        document.body.appendChild(tempCanvasEl);

        const tempCanvas = new fabric.StaticCanvas(tempCanvasEl, {
            width: 900,
            height: 600,
            backgroundColor: '#111118',
        });

        fabric.Image.fromURL(imgData.dataUrl, function(fabricImg) {
            const scale = Math.min(
                (900 * 0.9) / fabricImg.width,
                (600 * 0.9) / fabricImg.height,
                1
            );

            fabricImg.set({
                left: 450,
                top: 300,
                originX: 'center',
                originY: 'center',
                scaleX: scale,
                scaleY: scale,
            });

            tempCanvas.setBackgroundImage(fabricImg, function() {
                if (imgData.canvasObjects && imgData.canvasObjects.length > 0) {
                    fabric.util.enlivenObjects(imgData.canvasObjects, function(objects) {
                        objects.forEach(obj => tempCanvas.add(obj));
                        tempCanvas.renderAll();
                        const dataUrl = tempCanvas.toDataURL({ format: 'png', multiplier: 1.5 });
                        cleanup();
                        resolve(dataUrl);
                    });
                } else {
                    tempCanvas.renderAll();
                    const dataUrl = tempCanvas.toDataURL({ format: 'png', multiplier: 1.5 });
                    cleanup();
                    resolve(dataUrl);
                }
            });
        }, { crossOrigin: 'anonymous' });

        function cleanup() {
            tempCanvas.dispose();
            document.body.removeChild(tempCanvasEl);
        }

        // Timeout fallback
        setTimeout(() => resolve(imgData.dataUrl), 5000);
    });
}

function buildReportHTML(imageSnapshots, opts) {
    const dateStr = new Date().toLocaleDateString('es-PE', {
        year: 'numeric', month: 'long', day: 'numeric'
    });

    let imagesHTML = '';

    imageSnapshots.forEach((entry, idx) => {
        const img = entry.img;
        const num = idx + 1;

        let metaHTML = '';
        if (opts.includeMetadata) {
            const fields = [];
            if (img.metadata.source) fields.push(`<tr><td class="meta-label">Fuente</td><td>${esc(img.metadata.source)}</td></tr>`);
            if (img.metadata.author) fields.push(`<tr><td class="meta-label">Autor</td><td>${esc(img.metadata.author)}</td></tr>`);
            if (img.metadata.date) fields.push(`<tr><td class="meta-label">Fecha</td><td>${esc(img.metadata.date)}</td></tr>`);
            if (img.metadata.medium) fields.push(`<tr><td class="meta-label">Medio</td><td>${esc(img.metadata.medium)}</td></tr>`);
            if (img.metadata.context) fields.push(`<tr><td class="meta-label">Contexto</td><td>${esc(img.metadata.context)}</td></tr>`);
            if (img.metadata.custom) fields.push(`<tr><td class="meta-label">Notas</td><td>${esc(img.metadata.custom)}</td></tr>`);
            if (fields.length > 0) {
                metaHTML = `<table class="meta-table">${fields.join('')}</table>`;
            }
        }

        let tagsHTML = '';
        if (opts.includeTags && img.tags && img.tags.length > 0) {
            tagsHTML = `<div class="tags-row">${img.tags.map(t => `<span class="tag">${esc(t)}</span>`).join(' ')}</div>`;
        }

        let notesHTML = '';
        if (opts.includeNotes && img.generalNotes) {
            notesHTML = `<div class="general-notes"><strong>Notas generales:</strong><br>${esc(img.generalNotes).replace(/\n/g, '<br>')}</div>`;
        }

        let annotationsHTML = '';
        if (opts.includeNotes && img.annotations && img.annotations.length > 0) {
            const annRows = img.annotations.map(ann => {
                const cat = IC.getCategoryById(ann.categoryId);
                const catName = cat ? cat.name : '';
                const catColor = cat ? cat.color : '#4ecdc4';
                return `
                <div class="annotation-row">
                    <span class="ann-num" style="background:${catColor}">${ann.number}</span>
                    <span class="ann-cat">${esc(catName)}</span>
                    <span class="ann-note">${esc(ann.note || '(sin nota)')}</span>
                </div>`;
            }).join('');
            annotationsHTML = `<div class="annotations-block"><h4>Anotaciones</h4>${annRows}</div>`;
        }

        imagesHTML += `
        <div class="image-section">
            <h3>Imagen ${num}: ${esc(img.name)}</h3>
            <div class="image-frame">
                <img src="${entry.snapshot}" alt="${esc(img.name)}">
            </div>
            ${metaHTML}
            ${tagsHTML}
            ${notesHTML}
            ${annotationsHTML}
        </div>`;
    });

    // Tags summary (scoped to included images)
    const tagCounts = {};
    imageSnapshots.forEach(entry => {
        (entry.img.tags || []).forEach(tag => {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
        });
    });
    const tagsSummary = Object.entries(tagCounts).sort((a,b) => b[1] - a[1]);
    let tagsSummaryHTML = '';
    if (opts.includeTags && tagsSummary.length > 0) {
        tagsSummaryHTML = `
        <div class="corpus-summary">
            <h3>Etiquetas del corpus${imageSnapshots.length < IC.state.images.length ? ' (selección)' : ''}</h3>
            <div class="tags-row">
                ${tagsSummary.map(([t, c]) => `<span class="tag">${esc(t)} (${c})</span>`).join(' ')}
            </div>
        </div>`;
    }

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(opts.title)} — img-corpus</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: 'IBM Plex Sans', sans-serif;
    color: #1a1a2e;
    background: #fff;
    line-height: 1.6;
    padding: 40px;
    max-width: 900px;
    margin: 0 auto;
}

.report-header {
    border-bottom: 3px solid #1a1a2e;
    padding-bottom: 20px;
    margin-bottom: 30px;
}
.report-header h1 {
    font-size: 28px;
    font-weight: 700;
    margin-bottom: 4px;
}
.report-header .subtitle {
    color: #666;
    font-size: 14px;
}
.report-header .report-meta {
    margin-top: 8px;
    font-size: 12px;
    color: #888;
    font-family: 'IBM Plex Mono', monospace;
}

.image-section {
    margin-bottom: 40px;
    page-break-inside: avoid;
}
.image-section h3 {
    font-size: 18px;
    font-weight: 600;
    margin-bottom: 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid #ddd;
}

.image-frame {
    margin-bottom: 16px;
    text-align: center;
}
.image-frame img {
    max-width: 100%;
    height: auto;
    border: 1px solid #e0e0e0;
    border-radius: 4px;
}

.meta-table {
    width: 100%;
    margin-bottom: 12px;
    border-collapse: collapse;
    font-size: 13px;
}
.meta-table td {
    padding: 4px 8px;
    border-bottom: 1px solid #f0f0f0;
}
.meta-label {
    font-weight: 600;
    color: #555;
    width: 120px;
    text-transform: uppercase;
    font-size: 11px;
    letter-spacing: 0.5px;
}

.tags-row {
    margin-bottom: 12px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.tag {
    display: inline-block;
    background: #e8f5f3;
    color: #2a8a80;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 500;
}

.general-notes {
    background: #f8f8fc;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 12px;
    font-size: 13px;
    line-height: 1.6;
}

.annotations-block h4 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
    color: #333;
}
.annotation-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid #f0f0f0;
    font-size: 13px;
}
.ann-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    color: white;
    font-size: 11px;
    font-weight: 700;
    font-family: 'IBM Plex Mono', monospace;
    flex-shrink: 0;
}
.ann-cat {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #888;
    font-weight: 600;
    min-width: 80px;
}
.ann-note { flex: 1; }

.corpus-summary {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 2px solid #1a1a2e;
}
.corpus-summary h3 {
    font-size: 18px;
    margin-bottom: 12px;
}

.report-footer {
    margin-top: 50px;
    padding-top: 16px;
    border-top: 1px solid #ddd;
    font-size: 11px;
    color: #999;
    font-family: 'IBM Plex Mono', monospace;
    text-align: center;
}

@media print {
    body { padding: 20px; }
    .image-section { page-break-inside: avoid; }
}
</style>
</head>
<body>
<div class="report-header">
    <h1>${esc(opts.title)}</h1>
    ${opts.author ? `<div class="subtitle">${esc(opts.author)}</div>` : ''}
    <div class="report-meta">${dateStr} · ${imageSnapshots.length} imágenes · Generado con img-corpus</div>
</div>

${imagesHTML}
${tagsSummaryHTML}

<div class="report-footer">
    Informe generado por img-corpus · ${dateStr}
</div>

<script>
// PDF save button (only in HTML view)
if (window.location.protocol !== 'file:' || true) {
    const btn = document.createElement('button');
    btn.textContent = 'Guardar como PDF';
    btn.style.cssText = 'position:fixed;bottom:20px;right:20px;padding:10px 20px;background:#1a1a2e;color:white;border:none;border-radius:6px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;z-index:1000;box-shadow:0 4px 12px rgba(0,0,0,0.3);';
    btn.addEventListener('click', () => window.print());
    btn.addEventListener('mouseover', () => btn.style.background = '#2a2a4e');
    btn.addEventListener('mouseout', () => btn.style.background = '#1a1a2e');
    document.body.appendChild(btn);
}
<\/script>
</body>
</html>`;
}

function downloadHTML(html, title) {
    const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = title.replace(/[^a-zA-Z0-9áéíóúñü\s-]/g, '').replace(/\s+/g, '-');
    a.download = `${safeName}_${dateStamp()}.html`;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadPDFFromHTML(html, title) {
    // Open in new window and trigger print (browser native PDF)
    const win = window.open('', '_blank');
    if (!win) {
        alert('Permite ventanas emergentes para generar el PDF.');
        return;
    }
    win.document.write(html);
    win.document.close();
    setTimeout(() => {
        win.print();
    }, 800);
}

// ========== HELPERS ==========
function esc(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function dateStamp() {
    const d = new Date();
    return d.getFullYear() + '-' +
        String(d.getMonth()+1).padStart(2,'0') + '-' +
        String(d.getDate()).padStart(2,'0');
}

})();
