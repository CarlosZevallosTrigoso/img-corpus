/* ========================================
   IMG-CORPUS V2 — Export
   Session, reports, crops, qualitative JSON
   ======================================== */
(function(){

IC.initExport=function(){
    document.getElementById('importFileInput').addEventListener('change',function(e){if(e.target.files.length){importSession(e.target.files[0]);e.target.value=''}});
    document.getElementById('btnRptHTML').addEventListener('click',function(){IC.closeModal('modalReport');genReport('html')});
    document.getElementById('btnRptPDF').addEventListener('click',function(){IC.closeModal('modalReport');genReport('pdf')});
    document.getElementById('btnRptJSON').addEventListener('click',function(){IC.closeModal('modalReport');exportQualJSON()});
    document.getElementById('btnRptCrops').addEventListener('click',function(){IC.closeModal('modalReport');exportCrops()});
};

// ========== SESSION EXPORT ==========
IC.exportSession=function(){
    if(IC.saveCurrentCanvasState)IC.saveCurrentCanvasState();
    var session={version:'2.0',exportDate:new Date().toISOString(),sessionName:IC.state.sessionName,canvasBg:IC.state.canvasBg,
        categories:IC.state.categories,collections:IC.state.collections,chains:IC.state.chains,
        diary:IC.state.diary,auditLog:IC.state.auditLog,customMetaSchema:IC.state.customMetaSchema,
        images:IC.getTargetImages().map(function(i){return{id:i.id,name:i.name,dataUrl:i.dataUrl,metadata:i.metadata,tags:i.tags,generalNotes:i.generalNotes,annotations:i.annotations,relations:i.relations,canvasObjects:i.canvasObjects||[],collectionIds:i.collectionIds||[]}})
    };
    var blob=new Blob([JSON.stringify(session,null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download='img-corpus_'+IC.state.sessionName.replace(/[^a-zA-Z0-9áéíóúñü\s-]/g,'').replace(/\s+/g,'-')+'_'+ds()+'.json';
    a.click();URL.revokeObjectURL(a.href);
};

function importSession(file){
    var r=new FileReader();
    r.onload=function(e){
        try{
            var s=JSON.parse(e.target.result);if(!s.images||!Array.isArray(s.images)){alert('Archivo inválido.');return}
            IC.pushUndo();
            IC.state.images=s.images;IC.state.categories=s.categories||[];IC.state.collections=s.collections||[];
            IC.state.chains=s.chains||[];IC.state.diary=s.diary||[];IC.state.auditLog=s.auditLog||[];
            IC.state.customMetaSchema=s.customMetaSchema||[];IC.state.canvasBg=s.canvasBg||'#111118';
            IC.state.sessionName=s.sessionName||'Sesión importada';
            IC.state.currentImageId=IC.state.images.length?IC.state.images[0].id:null;
            document.getElementById('sessionName').textContent=IC.state.sessionName;
            IC.log('Sesión importada: '+IC.state.images.length+' imágenes');
            IC.refreshAll();if(IC.state.currentImageId)IC.selectImage(IC.state.currentImageId);else IC.showCanvasEmpty(true);
        }catch(err){alert('Error: '+err.message)}
    };
    r.readAsText(file);
}

// ========== REPORT MODAL ==========
IC.openReportModal=function(){
    if(IC.populateReportCollections)IC.populateReportCollections();
    // Update scope info
    var scope=document.getElementById('reportScope');
    var hasSel=IC.state.batchSelected.size>0;
    if(hasSel) scope.innerHTML='<strong>'+IC.state.batchSelected.size+'</strong> imágenes seleccionadas.';
    else scope.innerHTML='Se incluirán todas las <strong>'+IC.getVisibleImages().length+'</strong> imágenes'+(IC.state.activeCollectionId?' de esta colección':'')+' (o elige una colección abajo).';
    IC.openModal('modalReport');
};

function getScopedImages(){
    var collId=document.getElementById('reportCollection').value;
    if(collId&&IC.getCollectionImages) return IC.getCollectionImages(collId);
    if(IC.state.batchSelected.size>0) return IC.state.images.filter(function(i){return IC.state.batchSelected.has(i.id)});
    return IC.getVisibleImages();
}

// ========== HTML REPORT ==========
function genReport(fmt){
    if(IC.saveCurrentCanvasState)IC.saveCurrentCanvasState();
    var imgs=getScopedImages();
    var opts={
        annotations:document.getElementById('rptAnnotations').checked,
        description:document.getElementById('rptDescription').checked,
        interpretation:document.getElementById('rptInterpretation').checked,
        memo:document.getElementById('rptMemo').checked,
        relations:document.getElementById('rptRelations').checked,
        chains:document.getElementById('rptChains').checked,
        meta:document.getElementById('rptMeta').checked,
        tags:document.getElementById('rptTags').checked,
        notes:document.getElementById('rptNotes').checked,
        title:document.getElementById('rptTitle').value||'Análisis de corpus visual',
        author:document.getElementById('rptAuthor').value||'',
    };
    var html=buildHTML(imgs,opts);
    if(fmt==='html')dlHTML(html,opts.title);
    else{var w=window.open('','_blank');if(!w){alert('Permite popups.');return}w.document.write(html);w.document.close();setTimeout(function(){w.print()},800)}
}

function buildHTML(imgs,o){
    var date=new Date().toLocaleDateString('es-PE',{year:'numeric',month:'long',day:'numeric'});
    var body=imgs.map(function(img,idx){
        var num=idx+1;
        var s='<div class="img-section"><h3>Imagen '+num+': '+esc(img.name)+'</h3>';
        s+='<div class="img-frame"><img src="'+img.dataUrl+'"></div>';

        if(o.meta){
            var fields=[];
            if(img.metadata.source)fields.push(['Fuente',img.metadata.source]);
            if(img.metadata.author)fields.push(['Autor',img.metadata.author]);
            if(img.metadata.date)fields.push(['Fecha',img.metadata.date]);
            if(img.metadata.medium)fields.push(['Medio',img.metadata.medium]);
            if(img.metadata.context)fields.push(['Contexto',img.metadata.context]);
            IC.state.customMetaSchema.forEach(function(f){var v=img.metadata['_'+f.id];if(v)fields.push([f.name,v])});
            if(fields.length) s+='<table class="meta-tbl">'+fields.map(function(f){return'<tr><td class="ml">'+esc(f[0])+'</td><td>'+esc(f[1])+'</td></tr>'}).join('')+'</table>';
        }
        if(o.tags&&img.tags&&img.tags.length) s+='<div class="tags-row">'+img.tags.map(function(t){return'<span class="tag">'+esc(t)+'</span>'}).join(' ')+'</div>';
        if(o.notes&&img.generalNotes) s+='<div class="gen-notes"><strong>Notas generales:</strong><br>'+esc(img.generalNotes).replace(/\n/g,'<br>')+'</div>';

        if(o.annotations&&img.annotations&&img.annotations.length){
            s+='<div class="anns-block"><h4>Anotaciones</h4>';
            img.annotations.forEach(function(ann){
                var cat=IC.getCategoryById(ann.categoryId);
                s+='<div class="ann-row"><span class="ann-n" style="background:'+(cat?cat.color:'#888')+'">'+ann.number+'</span><div class="ann-body">';
                if(cat)s+='<span class="ann-cat">'+esc(cat.name)+'</span>';
                if(o.description&&ann.description)s+='<div class="ann-f"><em>Descripción:</em> '+esc(ann.description)+'</div>';
                if(o.interpretation&&ann.interpretation)s+='<div class="ann-f"><em>Interpretación:</em> '+esc(ann.interpretation)+'</div>';
                if(o.memo&&ann.memo)s+='<div class="ann-f ann-memo"><em>Memo:</em> '+esc(ann.memo)+'</div>';
                s+='</div></div>';
            });
            s+='</div>';
        }

        if(o.relations&&img.relations&&img.relations.length){
            s+='<div class="rels-block"><h4>Relaciones intra-imagen</h4>';
            img.relations.forEach(function(r){
                var from=img.annotations.find(function(a){return a.id===r.fromAnnId});
                var to=img.annotations.find(function(a){return a.id===r.toAnnId});
                s+='<div class="rel-row">#'+(from?from.number:'?')+' → #'+(to?to.number:'?')+' <em>'+esc(r.type)+'</em></div>';
            });
            s+='</div>';
        }

        s+='</div>';
        return s;
    }).join('');

    // Chains summary
    var chainsSummary='';
    if(o.chains&&IC.state.chains.length){
        chainsSummary='<div class="chains-summary"><h3>Cadenas analíticas</h3>';
        IC.state.chains.forEach(function(ch){
            var instCount=ch.links.length;
            chainsSummary+='<div class="chain-block"><h4 style="color:'+ch.color+'">'+esc(ch.name)+' ('+instCount+' instancias)</h4>';
            if(ch.description)chainsSummary+='<p>'+esc(ch.description)+'</p>';
            ch.links.forEach(function(l){
                var img2=IC.state.images.find(function(i){return i.id===l.imageId});
                var ann=img2?(img2.annotations||[]).find(function(a){return a.id===l.annotationId}):null;
                if(img2&&ann) chainsSummary+='<div class="chain-inst">Img '+(IC.state.images.indexOf(img2)+1)+' #'+ann.number+(ann.description?' — '+esc(ann.description.substring(0,60)):'')+'</div>';
            });
            chainsSummary+='</div>';
        });
        chainsSummary+='</div>';
    }

    return'<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>'+esc(o.title)+'</title>'+
    '<style>'+reportCSS()+'</style></head><body>'+
    '<div class="rpt-hdr"><h1>'+esc(o.title)+'</h1>'+(o.author?'<div class="sub">'+esc(o.author)+'</div>':'')+
    '<div class="rpt-meta">'+date+' · '+imgs.length+' imágenes · img-corpus v2</div></div>'+
    body+chainsSummary+
    '<div class="rpt-foot">Generado con img-corpus v2 · '+date+'</div>'+
    '<script>var b=document.createElement("button");b.textContent="Guardar como PDF";b.style.cssText="position:fixed;bottom:16px;right:16px;padding:8px 16px;background:#1a1a2e;color:#fff;border:none;border-radius:6px;cursor:pointer;font:600 13px sans-serif;z-index:999";b.onclick=function(){window.print()};document.body.appendChild(b)<\/script>'+
    '</body></html>';
}

function reportCSS(){
    return'@import url("https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap");'+
    '*{box-sizing:border-box;margin:0;padding:0}body{font-family:"IBM Plex Sans",sans-serif;color:#1a1a2e;background:#fff;line-height:1.6;padding:40px;max-width:900px;margin:0 auto}'+
    '.rpt-hdr{border-bottom:3px solid #1a1a2e;padding-bottom:16px;margin-bottom:24px}.rpt-hdr h1{font-size:26px;margin-bottom:4px}.sub{color:#666;font-size:14px}.rpt-meta{margin-top:6px;font-size:12px;color:#888;font-family:"IBM Plex Mono",monospace}'+
    '.img-section{margin-bottom:36px;page-break-inside:avoid}.img-section h3{font-size:18px;font-weight:600;margin-bottom:10px;padding-bottom:5px;border-bottom:1px solid #ddd}'+
    '.img-frame{margin-bottom:14px;text-align:center}.img-frame img{max-width:100%;height:auto;border:1px solid #e0e0e0;border-radius:4px}'+
    '.meta-tbl{width:100%;margin-bottom:10px;border-collapse:collapse;font-size:13px}.meta-tbl td{padding:3px 8px;border-bottom:1px solid #f0f0f0}.ml{font-weight:600;color:#555;width:110px;text-transform:uppercase;font-size:11px;letter-spacing:.4px}'+
    '.tags-row{margin-bottom:10px;display:flex;flex-wrap:wrap;gap:4px}.tag{display:inline-block;background:#e8f5f3;color:#2a8a80;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:500}'+
    '.gen-notes{background:#f8f8fc;padding:10px;border-radius:6px;margin-bottom:10px;font-size:13px;line-height:1.6}'+
    '.anns-block h4,.rels-block h4{font-size:14px;font-weight:600;margin-bottom:6px;color:#333}'+
    '.ann-row{display:flex;align-items:flex-start;gap:8px;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:13px}'+
    '.ann-n{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;color:#fff;font-size:11px;font-weight:700;font-family:"IBM Plex Mono",monospace;flex-shrink:0}'+
    '.ann-body{flex:1}.ann-cat{font-size:11px;text-transform:uppercase;letter-spacing:.3px;color:#888;font-weight:600}'+
    '.ann-f{margin-top:3px}.ann-f em{color:#666;font-style:italic}.ann-memo{color:#888;font-size:12px}'+
    '.rel-row{font-size:13px;padding:3px 0;border-bottom:1px solid #f0f0f0}.rel-row em{color:#666}'+
    '.chains-summary{margin-top:30px;padding-top:16px;border-top:2px solid #1a1a2e}.chains-summary h3{font-size:18px;margin-bottom:10px}'+
    '.chain-block{margin-bottom:14px}.chain-block h4{font-size:14px;margin-bottom:4px}.chain-block p{font-size:13px;color:#555;margin-bottom:6px}'+
    '.chain-inst{font-size:12px;color:#444;padding:2px 0;border-bottom:1px solid #f5f5f5}'+
    '.rpt-foot{margin-top:40px;padding-top:12px;border-top:1px solid #ddd;font-size:11px;color:#999;font-family:"IBM Plex Mono",monospace;text-align:center}'+
    '@media print{body{padding:20px}.img-section{page-break-inside:avoid}}';
}

// ========== QUALITATIVE JSON ==========
function exportQualJSON(){
    var imgs=getScopedImages();
    var schema={
        _schema:'img-corpus-qualitative-v2',
        exportDate:new Date().toISOString(),
        project:IC.state.sessionName,
        categories:IC.state.categories.map(function(c){return{id:c.id,name:c.name,color:c.color}}),
        customFields:IC.state.customMetaSchema,
        chains:IC.state.chains.map(function(ch){
            return{id:ch.id,name:ch.name,description:ch.description,instances:ch.links.map(function(l){
                var img=IC.state.images.find(function(i){return i.id===l.imageId});
                var ann=img?(img.annotations||[]).find(function(a){return a.id===l.annotationId}):null;
                return{imageId:l.imageId,imageName:img?img.name:'',annotationNumber:ann?ann.number:null,description:ann?ann.description:'',interpretation:ann?ann.interpretation:''};
            })};
        }),
        images:imgs.map(function(img,idx){
            return{id:img.id,index:idx+1,name:img.name,metadata:img.metadata,tags:img.tags,generalNotes:img.generalNotes,
                collections:(img.collectionIds||[]).map(function(cid){var co=IC.state.collections.find(function(c){return c.id===cid});return co?co.name:cid}),
                annotations:(img.annotations||[]).map(function(a){
                    var cat=IC.getCategoryById(a.categoryId);
                    return{number:a.number,category:cat?cat.name:'',type:a.type,description:a.description,interpretation:a.interpretation,memo:a.memo,
                        chains:(a.chainIds||[]).map(function(cid){var ch=IC.state.chains.find(function(c){return c.id===cid});return ch?ch.name:cid})};
                }),
                relations:(img.relations||[]).map(function(r){
                    var from=img.annotations.find(function(a){return a.id===r.fromAnnId});
                    var to=img.annotations.find(function(a){return a.id===r.toAnnId});
                    return{from:from?from.number:null,to:to?to.number:null,type:r.type};
                })
            };
        }),
        diary:IC.state.diary
    };
    var blob=new Blob([JSON.stringify(schema,null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download='img-corpus-qualitative_'+ds()+'.json';a.click();URL.revokeObjectURL(a.href);
}

// ========== CROP EXPORT ==========
function exportCrops(){
    var imgs=getScopedImages();
    var crops=[];
    imgs.forEach(function(img,idx){
        (img.annotations||[]).forEach(function(ann){
            var cat=IC.getCategoryById(ann.categoryId);
            crops.push({
                filename:'crop_img'+(idx+1)+'_ann'+ann.number+'.txt',
                image:img.name,imageIndex:idx+1,annotationNumber:ann.number,
                category:cat?cat.name:'',type:ann.type,
                description:ann.description||'',interpretation:ann.interpretation||'',memo:ann.memo||'',
                chains:(ann.chainIds||[]).map(function(cid){var ch=IC.state.chains.find(function(c){return c.id===cid});return ch?ch.name:''}).filter(Boolean)
            });
        });
    });

    if(!crops.length){alert('Sin anotaciones para exportar.');return}

    // Export as a single JSON with crop metadata
    var blob=new Blob([JSON.stringify({_schema:'img-corpus-crops-v2',exportDate:new Date().toISOString(),crops:crops},null,2)],{type:'application/json'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download='img-corpus-crops_'+ds()+'.json';a.click();URL.revokeObjectURL(a.href);
}

function dlHTML(html,title){
    var blob=new Blob([html],{type:'text/html;charset=utf-8'});
    var a=document.createElement('a');a.href=URL.createObjectURL(blob);
    a.download=title.replace(/[^a-zA-Z0-9áéíóúñü\s-]/g,'').replace(/\s+/g,'-')+'_'+ds()+'.html';
    a.click();URL.revokeObjectURL(a.href);
}

function esc(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
function ds(){var d=new Date();return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}

})();
