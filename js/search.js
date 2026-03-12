/* ========================================
   IMG-CORPUS v1 — Search & Concordance
   Updated for levels/notes model
   ======================================== */
(function(){

IC.initSearch=function(){
    document.getElementById('btnSearch').addEventListener('click',doSearch);
    document.getElementById('searchValue').addEventListener('keydown',function(e){if(e.key==='Enter')doSearch()});

    document.getElementById('btnNewChain').addEventListener('click',function(){
        document.getElementById('chainName').value='';document.getElementById('chainDesc').value='';
        document.getElementById('chainColor').value='#'+Math.floor(Math.random()*16777215).toString(16).padStart(6,'0');
        IC.openModal('modalChain');
    });
    document.getElementById('btnChainApply').addEventListener('click',function(){
        var name=document.getElementById('chainName').value.trim();if(!name)return;
        IC.pushUndo();
        IC.state.chains.push({id:IC.uid(),name:name,description:document.getElementById('chainDesc').value.trim(),color:document.getElementById('chainColor').value,links:[]});
        IC.log('Cadena analítica creada: '+name);
        IC.closeModal('modalChain');
        IC.renderChainsPanel();
    });
};

function doSearch(){
    var field=document.getElementById('searchField').value;
    var val=document.getElementById('searchValue').value.trim().toLowerCase();
    if(!val){document.getElementById('searchResults').innerHTML='';return}
    var results=[];

    IC.getVisibleImages().forEach(function(img,idx){
        var matches=[];
        function check(text,label){if(text&&text.toLowerCase().indexOf(val)>=0)matches.push({text:text,label:label})}

        if(field==='annotation'||field==='level'){
            (img.annotations||[]).forEach(function(a){
                if(a.levels){
                    IC.state.annotationLevels.forEach(function(lvl){
                        check(a.levels[lvl],'#'+a.number+' '+lvl);
                    });
                }
            });
        }
        if(field==='tag'){(img.tags||[]).forEach(function(t){check(t,'Etiqueta')})}
        if(field==='category'){(img.annotations||[]).forEach(function(a){var c=IC.getCategoryById(a.categoryId);if(c)check(c.name,'#'+a.number+' Categoría')})}
        if(field==='notes'){(img.notes||[]).forEach(function(n,ni){check(n.text,'Nota '+(ni+1))})}
        if(field==='meta'){Object.keys(img.metadata).forEach(function(k){check(img.metadata[k],'Meta: '+k)})}
        if(field==='collection'){(img.collectionIds||[]).forEach(function(cid){var co=IC.state.collections.find(function(c){return c.id===cid});if(co)check(co.name,'Colección')})}

        if(matches.length) results.push({img:img,idx:IC.state.images.indexOf(img),matches:matches});
    });

    var c=document.getElementById('searchResults');
    if(!results.length){c.innerHTML='<p style="color:var(--t3);font-size:11px">Sin resultados.</p>';return}

    c.innerHTML=results.map(function(r){
        var previews=r.matches.slice(0,3).map(function(m){
            var highlighted=IC.esc(m.text).replace(new RegExp('('+val.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+')','gi'),'<mark>$1</mark>');
            return'<div class="search-result-text"><strong>'+IC.esc(m.label)+':</strong> '+highlighted+'</div>';
        }).join('');
        return'<div class="search-result" data-id="'+r.img.id+'"><div class="search-result-img">'+(r.idx+1)+'. '+IC.esc(r.img.name)+' ('+r.matches.length+')</div>'+previews+'</div>';
    }).join('');

    c.querySelectorAll('.search-result').forEach(function(el){
        el.addEventListener('click',function(){IC.setViewMode('single');IC.selectImage(el.dataset.id)});
    });
}

// ========== CHAINS PANEL ==========
IC.renderChainsPanel=function(){
    var c=document.getElementById('chainsList');
    if(!IC.state.chains.length){c.innerHTML='<p style="color:var(--t3);font-size:10px">Sin cadenas.</p>';return}

    c.innerHTML=IC.state.chains.map(function(ch){
        var linkInfo=ch.links.map(function(l){
            var img=IC.state.images.find(function(i){return i.id===l.imageId});
            var ann=img?(img.annotations||[]).find(function(a){return a.id===l.annotationId}):null;
            return img&&ann?'Img '+(IC.state.images.indexOf(img)+1)+' #'+ann.number:null;
        }).filter(Boolean);

        return'<div class="ann-item" style="border-left-color:'+ch.color+'">'+
            '<div class="ann-hdr"><span class="ann-num" style="background:'+ch.color+'">⛓</span><strong style="flex:1;font-size:12px">'+IC.esc(ch.name)+'</strong>'+
            '<button class="ann-del" data-chain="'+ch.id+'"><span class="material-symbols-outlined">close</span></button></div>'+
            (ch.description?'<div style="font-size:11px;color:var(--t2);margin:3px 0">'+IC.esc(ch.description)+'</div>':'')+
            '<div style="font-size:10px;color:var(--t3)">'+ch.links.length+' instancias'+(linkInfo.length?' — '+linkInfo.join(', '):'')+'</div>'+
            '<button class="btn btn-xs btn-ghost" data-addlink="'+ch.id+'" style="margin-top:3px"><span class="material-symbols-outlined" style="font-size:13px">add_link</span> Vincular anotación actual</button>'+
        '</div>';
    }).join('');

    c.querySelectorAll('.ann-del[data-chain]').forEach(function(b){
        b.addEventListener('click',function(){
            IC.pushUndo();
            IC.state.images.forEach(function(i){(i.annotations||[]).forEach(function(a){a.chainIds=(a.chainIds||[]).filter(function(x){return x!==b.dataset.chain})})});
            IC.state.chains=IC.state.chains.filter(function(x){return x.id!==b.dataset.chain});
            IC.renderChainsPanel();
        });
    });

    c.querySelectorAll('[data-addlink]').forEach(function(b){
        b.addEventListener('click',function(){
            var img=IC.getCurrentImage();if(!img||!img.annotations||!img.annotations.length){alert('Selecciona una imagen con anotaciones.');return}
            var firstLevel=IC.state.annotationLevels[0]||'Nivel 1';
            var opts=img.annotations.map(function(a){var txt=a.levels?a.levels[firstLevel]||'':'';return'#'+a.number+': '+(txt||'(sin texto)')}).join('\n');
            var pick=prompt('¿Qué anotación vincular?\n'+opts+'\n\nEscribe el número:');
            if(!pick)return;
            var num=parseInt(pick.replace('#',''));
            var ann=img.annotations.find(function(a){return a.number===num});
            if(!ann){alert('Anotación no encontrada.');return}
            IC.pushUndo();
            var ch=IC.state.chains.find(function(x){return x.id===b.dataset.addlink});if(!ch)return;
            if(!ch.links.find(function(l){return l.imageId===img.id&&l.annotationId===ann.id}))
                ch.links.push({imageId:img.id,annotationId:ann.id});
            if(!ann.chainIds)ann.chainIds=[];
            if(ann.chainIds.indexOf(ch.id)<0) ann.chainIds.push(ch.id);
            IC.log('Anotación #'+ann.number+' vinculada a cadena "'+ch.name+'"');
            IC.renderChainsPanel();IC.renderAnnotationsPanel(img);
        });
    });
};

// ========== CONCORDANCE VIEW ==========
IC.renderConcordance=function(){
    var c=document.getElementById('concordanceView');
    if(!IC.state.categories.length&&!IC.state.chains.length){
        c.innerHTML='<div class="conc-header"><h3>Concordancia visual</h3><p>Crea categorías o cadenas para usar esta vista.</p></div>';return;
    }

    var options='<option value="">— Seleccionar —</option>';
    IC.state.categories.forEach(function(cat){options+='<option value="cat:'+cat.id+'">Categoría: '+IC.esc(cat.name)+'</option>'});
    IC.state.chains.forEach(function(ch){options+='<option value="chain:'+ch.id+'">Cadena: '+IC.esc(ch.name)+'</option>'});

    c.innerHTML='<div class="conc-header"><h3>Concordancia visual</h3><p>Selecciona una categoría o cadena para ver instancias alineadas.</p></div>'+
        '<div class="conc-select"><select id="concSelect">'+options+'</select></div>'+
        '<div class="conc-grid" id="concGrid"></div>';

    document.getElementById('concSelect').addEventListener('change',function(){
        var val=this.value;if(!val){document.getElementById('concGrid').innerHTML='';return}
        var parts=val.split(':'),type=parts[0],id=parts[1];
        var cards=[];
        var firstLevel=IC.state.annotationLevels[0]||'Nivel 1';
        var secondLevel=IC.state.annotationLevels[1]||null;

        if(type==='cat'){
            IC.getVisibleImages().forEach(function(img,idx){
                (img.annotations||[]).filter(function(a){return a.categoryId===id}).forEach(function(a){
                    cards.push({img:img,ann:a,idx:IC.state.images.indexOf(img)});
                });
            });
        } else if(type==='chain'){
            var ch=IC.state.chains.find(function(x){return x.id===id});
            if(ch)(ch.links||[]).forEach(function(l){
                var img=IC.state.images.find(function(i){return i.id===l.imageId});
                var ann=img?(img.annotations||[]).find(function(a){return a.id===l.annotationId}):null;
                if(img&&ann) cards.push({img:img,ann:ann,idx:IC.state.images.indexOf(img)});
            });
        }

        var grid=document.getElementById('concGrid');
        if(!cards.length){grid.innerHTML='<p style="color:var(--t3);font-size:11px">Sin instancias.</p>';return}

        grid.innerHTML=cards.map(function(c){
            var lvl1=c.ann.levels?c.ann.levels[firstLevel]||'':'';
            var lvl2=secondLevel&&c.ann.levels?c.ann.levels[secondLevel]||'':'';
            return'<div class="conc-card" data-id="'+c.img.id+'">'+
                '<div class="conc-card-img"><img src="'+c.img.dataUrl+'" loading="lazy"></div>'+
                '<div class="conc-card-body">'+
                    '<div class="conc-card-from">Img '+(c.idx+1)+' — #'+c.ann.number+'</div>'+
                    (lvl1?'<div class="conc-card-desc">'+IC.esc(lvl1.substring(0,80))+'</div>':'')+
                    (lvl2?'<div style="color:var(--ac2);font-size:10px;margin-top:2px">'+IC.esc(lvl2.substring(0,80))+'</div>':'')+
                '</div></div>';
        }).join('');

        grid.querySelectorAll('.conc-card').forEach(function(el){
            el.addEventListener('dblclick',function(){IC.setViewMode('single');IC.selectImage(el.dataset.id)});
        });
    });
};

})();
