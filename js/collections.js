/* ========================================
   IMG-CORPUS V2 — Collections
   Tree management, sequencing, assignment
   ======================================== */
(function(){

IC.initCollections=function(){
    document.getElementById('btnAddCollection').addEventListener('click',function(){
        document.getElementById('collModalTitle').textContent='Nueva colección';
        document.getElementById('collName').value='';document.getElementById('collNotes').value='';
        populateParentSelect('');
        IC.openModal('modalCollection');
        setTimeout(function(){document.getElementById('collName').focus()},100);
    });
    document.getElementById('btnCollApply').addEventListener('click',function(){
        var name=document.getElementById('collName').value.trim();if(!name)return;
        IC.pushUndo();
        var coll={id:IC.uid(),name:name,parentId:document.getElementById('collParent').value||null,notes:document.getElementById('collNotes').value.trim(),imageOrder:[]};
        IC.state.collections.push(coll);
        IC.log('Colección creada: '+name);
        IC.closeModal('modalCollection');
        IC.renderCollectionsTree();
    });
};

function populateParentSelect(exclude){
    var sel=document.getElementById('collParent');
    sel.innerHTML='<option value="">— Raíz —</option>';
    IC.state.collections.forEach(function(c){
        if(c.id!==exclude) sel.innerHTML+='<option value="'+c.id+'">'+IC.esc(c.name)+'</option>';
    });
}

IC.renderCollectionsTree=function(){
    var container=document.getElementById('collectionsTree');
    if(!IC.state.collections.length){container.innerHTML='<div class="coll-empty">Crea tu primera colección con el botón de arriba.</div>';return}

    // Check if current image is in each collection
    var curImg = IC.getCurrentImage();

    function buildTree(parentId){
        var children=IC.state.collections.filter(function(c){return(c.parentId||null)===(parentId||null)});
        if(!children.length)return'';
        return children.map(function(c){
            var imgCount=IC.state.images.filter(function(i){return(i.collectionIds||[]).indexOf(c.id)>=0}).length;
            var curInColl = curImg && (curImg.collectionIds||[]).indexOf(c.id) >= 0;
            var sub=buildTree(c.id);
            var assignTitle = IC.state.batchMode && IC.state.batchSelected.size > 0
                ? 'Agregar ' + IC.state.batchSelected.size + ' seleccionadas'
                : curImg ? 'Agregar imagen activa' : 'Selecciona una imagen primero';
            var removeTitle = curInColl ? 'Quitar imagen activa de esta colección' : '';

            return'<div class="coll-node"><div class="coll-row'+(curInColl?' coll-has-current':'')+'" data-id="'+c.id+'">'+
                '<span class="material-symbols-outlined" style="font-size:15px">'+(sub?'folder_open':'folder')+'</span>'+
                '<span class="coll-label">'+IC.esc(c.name)+'</span>'+
                '<span class="coll-count">'+imgCount+'</span>'+
                '<div class="coll-actions">'+
                    (curInColl?'<button data-action="unassign" data-id="'+c.id+'" title="'+removeTitle+'"><span class="material-symbols-outlined" style="font-size:14px">remove_circle_outline</span></button>':'')+
                    '<button data-action="assign" data-id="'+c.id+'" title="'+assignTitle+'"><span class="material-symbols-outlined" style="font-size:14px">add_circle_outline</span></button>'+
                    '<button data-action="delete" data-id="'+c.id+'" title="Eliminar colección"><span class="material-symbols-outlined" style="font-size:14px">delete_outline</span></button>'+
                '</div>'+
            '</div>'+sub+'</div>';
        }).join('');
    }
    container.innerHTML=buildTree(null);

    // Click to filter view
    container.querySelectorAll('.coll-row').forEach(function(el){
        el.addEventListener('click',function(e){
            if(e.target.closest('.coll-actions'))return;
            container.querySelectorAll('.coll-row').forEach(function(r){r.classList.remove('active')});
            el.classList.add('active');
        });
    });

    // Assign images (batch or current)
    container.querySelectorAll('[data-action="assign"]').forEach(function(btn){
        btn.addEventListener('click',function(e){
            e.stopPropagation();
            var collId=btn.dataset.id;
            var collName=(IC.state.collections.find(function(c){return c.id===collId})||{}).name||'';
            var targets;

            if(IC.state.batchMode && IC.state.batchSelected.size > 0) {
                targets = IC.state.images.filter(function(i){return IC.state.batchSelected.has(i.id)});
            } else if(curImg) {
                targets = [curImg];
            } else {
                alert('Selecciona o abre una imagen primero.');
                return;
            }

            IC.pushUndo();
            var added = 0;
            targets.forEach(function(img){
                if(!img.collectionIds)img.collectionIds=[];
                if(img.collectionIds.indexOf(collId)<0){img.collectionIds.push(collId);added++}
            });

            if(added > 0){
                IC.log(added+' imagen(es) asignada(s) a colección "'+collName+'"');
                IC.renderCollectionsTree();
            } else {
                alert('Las imágenes ya están en esta colección.');
            }
        });
    });

    // Unassign current image
    container.querySelectorAll('[data-action="unassign"]').forEach(function(btn){
        btn.addEventListener('click',function(e){
            e.stopPropagation();
            if(!curImg) return;
            var collId=btn.dataset.id;
            var collName=(IC.state.collections.find(function(c){return c.id===collId})||{}).name||'';
            IC.pushUndo();
            curImg.collectionIds=(curImg.collectionIds||[]).filter(function(x){return x!==collId});
            IC.log('Imagen "'+curImg.name+'" quitada de colección "'+collName+'"');
            IC.renderCollectionsTree();
        });
    });

    // Delete collection
    container.querySelectorAll('[data-action="delete"]').forEach(function(btn){
        btn.addEventListener('click',function(e){
            e.stopPropagation();
            if(!confirm('¿Eliminar esta colección?'))return;
            IC.pushUndo();
            var id=btn.dataset.id;
            var coll=IC.state.collections.find(function(c){return c.id===id});
            // Reparent children
            IC.state.collections.forEach(function(c){if(c.parentId===id)c.parentId=coll?coll.parentId:null});
            // Remove from images
            IC.state.images.forEach(function(i){if(i.collectionIds)i.collectionIds=i.collectionIds.filter(function(x){return x!==id})});
            IC.state.collections=IC.state.collections.filter(function(c){return c.id!==id});
            IC.log('Colección eliminada: '+(coll?coll.name:''));
            IC.renderCollectionsTree();
        });
    });
};

// Populate report collection select
IC.populateReportCollections=function(){
    var sel=document.getElementById('reportCollection');
    sel.innerHTML='<option value="">Todo el corpus / selección batch</option>';
    IC.state.collections.forEach(function(c){
        sel.innerHTML+='<option value="'+c.id+'">'+IC.esc(c.name)+'</option>';
    });
};

// Get images for a collection (including subcollections)
IC.getCollectionImages=function(collId){
    var ids=new Set();
    function gather(pid){
        IC.state.images.forEach(function(i){if((i.collectionIds||[]).indexOf(pid)>=0)ids.add(i.id)});
        IC.state.collections.filter(function(c){return c.parentId===pid}).forEach(function(c){gather(c.id)});
    }
    gather(collId);
    return IC.state.images.filter(function(i){return ids.has(i.id)});
};

})();
