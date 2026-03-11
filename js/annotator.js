/* ========================================
   IMG-CORPUS V2 — Annotator
   Canvas, tools, structured annotations
   ======================================== */
(function(){
var canvas=null, currentZoom=1, isDrawing=false, drawStart=null, tempShape=null;
var polyPoints=[], polyLines=[], polyDots=[];
var relationMode=null; // {fromAnnId} when picking second annotation

IC.initCanvas=function(){
    var el=document.getElementById('canvasContainer'), rect=el.getBoundingClientRect();
    canvas=new fabric.Canvas('mainCanvas',{width:rect.width,height:rect.height-4,backgroundColor:IC.state.canvasBg||'#111118',selection:true,preserveObjectStacking:true});
    IC.canvas=canvas;
    window.addEventListener('resize',function(){var r=el.getBoundingClientRect();if(r.width>0){canvas.setWidth(r.width);canvas.setHeight(r.height-4);canvas.renderAll()}});
    canvas.on('mouse:down',onDown);canvas.on('mouse:move',onMove);canvas.on('mouse:up',onUp);
    canvas.on('selection:created',onSel);canvas.on('selection:updated',onSel);canvas.on('selection:cleared',function(){document.querySelectorAll('.ann-item').forEach(function(e){e.classList.remove('selected')})});
    canvas.on('path:created',function(o){if(IC.state.activeTool==='freedraw')finalize(o.path)});
    canvas.on('object:modified',function(o){var obj=o.target;if(obj&&obj.annotationId&&!obj._isBadge){reposBadge(obj);IC.saveCurrentCanvasState()}});
    canvas.on('mouse:wheel',function(o){var z=canvas.getZoom()*(0.999**o.e.deltaY);z=Math.min(Math.max(.1,z),10);canvas.zoomToPoint({x:o.e.offsetX,y:o.e.offsetY},z);currentZoom=z;updZoom();o.e.preventDefault();o.e.stopPropagation()});

    // Pan: Alt+drag, middle-click, or Space+drag
    var pan=false,ps=null,spacePan=false;
    canvas.on('mouse:down',function(o){if(o.e.altKey||o.e.button===1||spacePan){pan=true;ps={x:o.e.clientX,y:o.e.clientY};var wrap=document.getElementById('canvasContainer');wrap.classList.add('panning-active');canvas.selection=false}});
    canvas.on('mouse:move',function(o){if(!pan)return;var v=canvas.viewportTransform;v[4]+=o.e.clientX-ps.x;v[5]+=o.e.clientY-ps.y;ps={x:o.e.clientX,y:o.e.clientY};canvas.requestRenderAll()});
    canvas.on('mouse:up',function(){if(pan){pan=false;var wrap=document.getElementById('canvasContainer');wrap.classList.remove('panning-active');if(!spacePan)IC.applyTool(IC.state.activeTool)}});

    // Space key hold for pan
    document.addEventListener('keydown',function(e){
        if(e.code==='Space'&&!e.repeat&&!isInputFocused()){
            e.preventDefault();spacePan=true;
            var wrap=document.getElementById('canvasContainer');wrap.classList.add('panning');
            canvas.selection=false;canvas.forEachObject(function(o){o.selectable=false});
        }
    });
    document.addEventListener('keyup',function(e){
        if(e.code==='Space'&&spacePan){
            spacePan=false;
            var wrap=document.getElementById('canvasContainer');wrap.classList.remove('panning');wrap.classList.remove('panning-active');
            IC.applyTool(IC.state.activeTool);
        }
    });
    function isInputFocused(){var t=document.activeElement;if(!t)return false;var tn=t.tagName.toLowerCase();return tn==='input'||tn==='textarea'||tn==='select'||t.isContentEditable}

    // Hover highlight: canvas → panel
    canvas.on('mouse:over',function(o){
        if(o.target&&o.target.annotationId&&!o.target._isBadge){
            document.querySelectorAll('.ann-item').forEach(function(el){el.classList.toggle('hover-highlight',el.dataset.ann===o.target.annotationId)});
        }
    });
    canvas.on('mouse:out',function(){
        document.querySelectorAll('.ann-item.hover-highlight').forEach(function(el){el.classList.remove('hover-highlight')});
    });
};

IC.loadImageToCanvas=function(d){
    if(!canvas)return;canvas.clear();canvas.setBackgroundColor(IC.state.canvasBg||'#111118',canvas.renderAll.bind(canvas));cancelPoly();relationMode=null;
    fabric.Image.fromURL(d.dataUrl,function(img){
        var el=document.getElementById('canvasContainer'),cw=el.clientWidth,ch=el.clientHeight;
        var sc=Math.min(cw*.9/img.width,ch*.9/img.height,1);
        img.set({left:cw/2,top:ch/2,originX:'center',originY:'center',scaleX:sc,scaleY:sc,selectable:false,evented:false,hoverCursor:'default'});
        canvas.setBackgroundImage(img,function(){
            canvas.setViewportTransform([1,0,0,1,0,0]);currentZoom=1;updZoom();
            if(d.canvasObjects&&d.canvasObjects.length){
                fabric.util.enlivenObjects(d.canvasObjects,function(objs){objs.forEach(function(o){canvas.add(o)});rebuildBadges(d);canvas.renderAll()});
            } else {rebuildBadges(d);canvas.renderAll();}
            IC.showCanvasEmpty(false);
        });
    },{crossOrigin:'anonymous'});
};

IC.saveCurrentCanvasState=function(){
    if(!canvas||!IC.state.currentImageId)return;var img=IC.getCurrentImage();if(!img)return;
    img.canvasObjects=canvas.getObjects().filter(function(o){return!o._isBadge&&!o._isPolyTemp}).map(function(o){return o.toObject(['annotationId','annotationNumber','categoryId','isAnnotation'])});
    canvas.getObjects().filter(function(o){return o._isBadge}).forEach(function(b){
        var ann=(img.annotations||[]).find(function(a){return a.id===b.annotationId});
        if(ann&&ann.badges){var bb=ann.badges.find(function(x){return x.uid===b._badgeUid});if(bb){bb.x=b.left;bb.y=b.top}}
    });
};

function rebuildBadges(d){if(!d.annotations)return;d.annotations.forEach(function(a){var c=IC.getCategoryColor(a.categoryId);(a.badges||[]).forEach(function(b){canvas.add(mkBadge(b.x,b.y,a.number,c,a.id,b.uid))})})}

IC.applyTool=function(t){
    if(!canvas)return;canvas.isDrawingMode=false;canvas.selection=true;canvas.defaultCursor='default';canvas.hoverCursor='move';
    canvas.forEachObject(function(o){if(!o._isBadge)o.selectable=true});
    document.getElementById('markerNumberSelect').classList.toggle('hidden',t!=='marker');
    if(t==='marker'&&IC.updateMarkerSelect) IC.updateMarkerSelect();
    if(t!=='polygon'&&polyPoints.length)cancelPoly();
    if(t==='relation'){canvas.defaultCursor='crosshair';canvas.selection=false;relationMode=null;return}
    if(t==='freedraw'){if(!IC.hasCategories()){IC.openModal('modalCategory');IC.setTool('select');return}canvas.isDrawingMode=true;canvas.freeDrawingBrush.color=IC.getCategoryColor(IC.state.activeCategory);canvas.freeDrawingBrush.width=3;canvas.selection=false}
    else if(t!=='select'){canvas.defaultCursor='crosshair';canvas.selection=false;canvas.forEachObject(function(o){o.selectable=false})}
};

function ptr(e){return canvas.getPointer(e.e)}

function onDown(opt){
    var t=IC.state.activeTool;if(t==='select'||t==='freedraw')return;
    if(!IC.hasCategories()&&t!=='relation'){IC.openModal('modalCategory');return}
    var p=ptr(opt);

    // Relation tool: pick annotations by clicking near their badges
    if(t==='relation'){
        var target=findNearestAnnotation(p);
        if(!target)return;
        if(!relationMode){
            relationMode={fromAnnId:target};
        } else {
            if(target!==relationMode.fromAnnId) createRelation(relationMode.fromAnnId,target);
            relationMode=null;
        }
        return;
    }

    if(t==='polygon'){polyClick(p);return}
    if(t==='marker'){mkMarker(p.x,p.y);return}
    if(t==='text'){mkText(p.x,p.y);return}

    isDrawing=true;drawStart=p;var c=IC.getCategoryColor(IC.state.activeCategory);
    if(t==='rect'){tempShape=new fabric.Rect({left:p.x,top:p.y,width:0,height:0,fill:cA(c,.12),stroke:c,strokeWidth:2,strokeDashArray:[6,3],selectable:false});canvas.add(tempShape)}
    else if(t==='ellipse'){tempShape=new fabric.Ellipse({left:p.x,top:p.y,rx:0,ry:0,fill:cA(c,.12),stroke:c,strokeWidth:2,strokeDashArray:[6,3],selectable:false});canvas.add(tempShape)}
    else if(t==='arrow'){tempShape=new fabric.Line([p.x,p.y,p.x,p.y],{stroke:c,strokeWidth:2.5,selectable:false});canvas.add(tempShape)}
}

function onMove(opt){
    if(!isDrawing||!tempShape)return;var p=ptr(opt),t=IC.state.activeTool;
    if(t==='rect')tempShape.set({left:Math.min(drawStart.x,p.x),top:Math.min(drawStart.y,p.y),width:Math.abs(p.x-drawStart.x),height:Math.abs(p.y-drawStart.y)});
    else if(t==='ellipse')tempShape.set({left:Math.min(drawStart.x,p.x),top:Math.min(drawStart.y,p.y),rx:Math.abs(p.x-drawStart.x)/2,ry:Math.abs(p.y-drawStart.y)/2});
    else if(t==='arrow')tempShape.set({x2:p.x,y2:p.y});
    canvas.renderAll();
}

function onUp(opt){
    if(!isDrawing)return;isDrawing=false;var t=IC.state.activeTool,p=ptr(opt);
    if(t==='rect'||t==='ellipse'){if(Math.abs(p.x-drawStart.x)<5&&Math.abs(p.y-drawStart.y)<5){canvas.remove(tempShape);tempShape=null;return}finalize(tempShape)}
    else if(t==='arrow'){var dx=p.x-drawStart.x,dy=p.y-drawStart.y;if(Math.sqrt(dx*dx+dy*dy)<10){canvas.remove(tempShape);tempShape=null;return}canvas.remove(tempShape);var ar=mkArrow(drawStart.x,drawStart.y,p.x,p.y);canvas.add(ar);finalize(ar)}
    tempShape=null;
}

function mkArrow(x1,y1,x2,y2){
    var c=IC.getCategoryColor(IC.state.activeCategory),a=Math.atan2(y2-y1,x2-x1),hl=16,ha=Math.PI/7;
    var hx1=x2-hl*Math.cos(a-ha),hy1=y2-hl*Math.sin(a-ha),hx2=x2-hl*Math.cos(a+ha),hy2=y2-hl*Math.sin(a+ha);
    return new fabric.Path('M '+x1+' '+y1+' L '+x2+' '+y2+' M '+hx1+' '+hy1+' L '+x2+' '+y2+' L '+hx2+' '+hy2,{fill:'',stroke:c,strokeWidth:2.5,strokeLineCap:'round',strokeLineJoin:'round',selectable:true});
}

// Polygon
function polyClick(p){
    var c=IC.getCategoryColor(IC.state.activeCategory);
    if(polyPoints.length>=3){var dx=p.x-polyPoints[0].x,dy=p.y-polyPoints[0].y;if(Math.sqrt(dx*dx+dy*dy)<15){closePoly();return}}
    polyPoints.push({x:p.x,y:p.y});
    var dot=new fabric.Circle({left:p.x,top:p.y,originX:'center',originY:'center',radius:4,fill:c,selectable:false,evented:false,_isPolyTemp:true});canvas.add(dot);polyDots.push(dot);
    if(polyPoints.length>1){var pv=polyPoints[polyPoints.length-2];var ln=new fabric.Line([pv.x,pv.y,p.x,p.y],{stroke:c,strokeWidth:2,strokeDashArray:[6,3],selectable:false,evented:false,_isPolyTemp:true});canvas.add(ln);polyLines.push(ln)}
    canvas.renderAll();
}
function closePoly(){polyDots.forEach(function(d){canvas.remove(d)});polyLines.forEach(function(l){canvas.remove(l)});var c=IC.getCategoryColor(IC.state.activeCategory);var poly=new fabric.Polygon(polyPoints.map(function(p){return{x:p.x,y:p.y}}),{fill:cA(c,.12),stroke:c,strokeWidth:2,strokeDashArray:[6,3],selectable:true});canvas.add(poly);finalize(poly);polyPoints=[];polyLines=[];polyDots=[]}
function cancelPoly(){polyDots.forEach(function(d){canvas.remove(d)});polyLines.forEach(function(l){canvas.remove(l)});polyPoints=[];polyLines=[];polyDots=[];if(canvas)canvas.renderAll()}
document.addEventListener('dblclick',function(){if(IC.state.activeTool==='polygon'&&polyPoints.length>=3)closePoly()});

// Text
function mkText(x,y){var inp=prompt('Texto (máx. 5 palabras):');if(!inp||!inp.trim())return;var w=inp.trim().split(/\s+/).slice(0,5).join(' ');var c=IC.getCategoryColor(IC.state.activeCategory);var t=new fabric.IText(w,{left:x,top:y,fontFamily:'IBM Plex Sans,sans-serif',fontSize:16,fontWeight:'600',fill:c,stroke:'#000',strokeWidth:.3,selectable:true,editable:false});canvas.add(t);finalize(t)}

// Marker
function mkMarker(x,y){
    var img=IC.getCurrentImage();if(!img)return;var sel=document.getElementById('markerNumberSelect').value;
    IC.pushUndo();var cat=IC.state.activeCategory,c=IC.getCategoryColor(cat);
    if(sel==='new'){
        var id=IC.uid(),num=(img.annotations?img.annotations.length:0)+1,bu=IC.uid();
        canvas.add(mkBadge(x,y,num,c,id,bu));canvas.renderAll();
        if(!img.annotations)img.annotations=[];
        img.annotations.push({id:id,number:num,categoryId:cat,levels:{},type:'marker',badges:[{uid:bu,x:x,y:y}],chainIds:[],_pending:true});
        IC.saveCurrentCanvasState();IC.renderAnnotationsPanel(img);if(IC.updateMarkerSelect)IC.updateMarkerSelect();autoFocus(id);
    } else {
        var ann=img.annotations.find(function(a){return a.id===sel});if(!ann)return;
        var bu2=IC.uid();canvas.add(mkBadge(x,y,ann.number,IC.getCategoryColor(ann.categoryId),ann.id,bu2));canvas.renderAll();
        if(!ann.badges)ann.badges=[];ann.badges.push({uid:bu2,x:x,y:y});IC.saveCurrentCanvasState();
    }
}

// Finalize any shape
function finalize(shape){
    var img=IC.getCurrentImage();if(!img)return;IC.pushUndo();
    var id=IC.uid(),num=(img.annotations?img.annotations.length:0)+1,cat=IC.state.activeCategory,c=IC.getCategoryColor(cat);
    shape.set({annotationId:id,annotationNumber:num,categoryId:cat,isAnnotation:true,selectable:true});
    var b=shape.getBoundingRect(),bx=b.left+b.width+6,by=b.top-6,bu=IC.uid();
    canvas.add(mkBadge(bx,by,num,c,id,bu));canvas.renderAll();
    if(!img.annotations)img.annotations=[];
    img.annotations.push({id:id,number:num,categoryId:cat,levels:{},type:IC.state.activeTool,badges:[{uid:bu,x:bx,y:by}],chainIds:[],_pending:true});
    IC.saveCurrentCanvasState();IC.renderAnnotationsPanel(img);if(IC.updateMarkerSelect)IC.updateMarkerSelect();autoFocus(id);
}

function mkBadge(x,y,n,c,aid,uid){
    var ci=new fabric.Circle({radius:12,fill:c,originX:'center',originY:'center'});
    var tx=new fabric.Text(String(n),{fontSize:11,fontFamily:'IBM Plex Mono,monospace',fontWeight:'700',fill:'#0d0d12',originX:'center',originY:'center'});
    return new fabric.Group([ci,tx],{left:x,top:y,selectable:false,evented:false,hoverCursor:'default',_isBadge:true,_badgeUid:uid,annotationId:aid});
}

function reposBadge(shape){
    if(!shape.annotationId)return;var b=shape.getBoundingRect(),bx=b.left+b.width+6,by=b.top-6;
    var badge=canvas.getObjects().find(function(o){return o._isBadge&&o.annotationId===shape.annotationId});
    if(badge){badge.set({left:bx,top:by});badge.setCoords();
        var img=IC.getCurrentImage();if(img){var ann=(img.annotations||[]).find(function(a){return a.id===shape.annotationId});if(ann&&ann.badges){var bb=ann.badges.find(function(x){return x.uid===badge._badgeUid});if(bb){bb.x=bx;bb.y=by}}}
    }
}

IC.updateMarkerSelect=function(){
    var img=IC.getCurrentImage(),sel=document.getElementById('markerNumberSelect');if(!img||!sel)return;
    var prev=sel.value,html='<option value="new">+ Nuevo</option>';
    if(img.annotations&&img.annotations.length){img.annotations.forEach(function(a){var ct=IC.getCategoryById(a.categoryId);html+='<option value="'+a.id+'">#'+a.number+' '+(ct?ct.name:'')+'</option>'})}
    sel.innerHTML=html;if(img.annotations&&img.annotations.find(function(a){return a.id===prev}))sel.value=prev;else sel.value='new';
};

function autoFocus(annId){setTimeout(function(){var lvl=IC.state.annotationLevels[0]||'Nivel 1';var d=document.querySelector('.ann-note-display[data-ann="'+annId+'"]');if(d)d.click()},120)}

// Relation tool helpers
function findNearestAnnotation(p){
    var img=IC.getCurrentImage();if(!img||!img.annotations)return null;
    var best=null,bestDist=30; // 30px threshold
    canvas.getObjects().filter(function(o){return o._isBadge&&o.annotationId}).forEach(function(b){
        var dx=p.x-b.left-12,dy=p.y-b.top-12;var d=Math.sqrt(dx*dx+dy*dy);
        if(d<bestDist){bestDist=d;best=b.annotationId}
    });
    return best;
}

function createRelation(fromId,toId){
    var img=IC.getCurrentImage();if(!img)return;
    var type=prompt('Tipo de relación (contraste, complementariedad, dirección, jerarquía, repetición, otro):');
    if(!type||!type.trim())return;
    IC.pushUndo();
    if(!img.relations)img.relations=[];
    img.relations.push({id:IC.uid(),fromAnnId:fromId,toAnnId:toId,type:type.trim(),note:''});
    var fromAnn=img.annotations.find(function(a){return a.id===fromId});
    var toAnn=img.annotations.find(function(a){return a.id===toId});
    IC.log('Relación creada: #'+(fromAnn?fromAnn.number:'?')+' → #'+(toAnn?toAnn.number:'?')+' ('+type.trim()+')');
    IC.renderRelationsPanel(img);
    IC.setTool('select');
}

IC.updateAnnotationColors=function(annId,catId){
    if(!canvas)return;var c=IC.getCategoryColor(catId);
    canvas.getObjects().forEach(function(o){if(o.annotationId!==annId)return;if(o._isBadge){if(o._objects&&o._objects[0])o._objects[0].set('fill',c)}else{if(o.stroke)o.set('stroke',c);if(o.fill&&o.fill!==''&&o.type!=='path')o.set('fill',cA(c,.12))}o.categoryId=catId});
    canvas.renderAll();IC.saveCurrentCanvasState();
};

IC.deleteSelectedAnnotation=function(){
    if(!canvas)return;var active=canvas.getActiveObjects();if(!active.length)return;IC.pushUndo();
    var img=IC.getCurrentImage();if(!img)return;
    active.forEach(function(obj){if(obj.annotationId){canvas.getObjects().filter(function(o){return o.annotationId===obj.annotationId}).forEach(function(o){canvas.remove(o)});if(img.annotations)img.annotations=img.annotations.filter(function(a){return a.id!==obj.annotationId});IC.state.chains.forEach(function(ch){ch.links=ch.links.filter(function(l){return l.annotationId!==obj.annotationId})});img.relations=(img.relations||[]).filter(function(r){return r.fromAnnId!==obj.annotationId&&r.toAnnId!==obj.annotationId})}canvas.remove(obj)});
    canvas.discardActiveObject();canvas.renderAll();IC.saveCurrentCanvasState();IC.renderAnnotationsPanel(img);if(IC.updateMarkerSelect)IC.updateMarkerSelect();
};

function onSel(opt){var obj=opt.selected&&opt.selected[0];if(obj&&obj.annotationId)document.querySelectorAll('.ann-item').forEach(function(e){e.classList.toggle('selected',e.dataset.ann===obj.annotationId)})}

IC.zoomIn=function(){if(!canvas)return;currentZoom=Math.min(currentZoom*1.2,10);canvas.setZoom(currentZoom);updZoom()};
IC.zoomOut=function(){if(!canvas)return;currentZoom=Math.max(currentZoom/1.2,.1);canvas.setZoom(currentZoom);updZoom()};
IC.zoomFit=function(){if(!canvas)return;canvas.setViewportTransform([1,0,0,1,0,0]);currentZoom=1;updZoom()};
function updZoom(){document.getElementById('zoomLevel').textContent=Math.round(currentZoom*100)+'%'}

IC.getCanvasDataURL=function(){return canvas?canvas.toDataURL({format:'png',multiplier:2}):null};

function cA(h,a){if(!h||h.charAt(0)!=='#')return'rgba(136,136,136,'+a+')';return'rgba('+parseInt(h.slice(1,3),16)+','+parseInt(h.slice(3,5),16)+','+parseInt(h.slice(5,7),16)+','+a+')'}
})();
