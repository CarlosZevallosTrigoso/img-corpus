/* ========================================
   IMG-CORPUS V2 — Diary & Audit Log
   Research diary, analytical decisions log
   ======================================== */
(function(){

IC.initDiary=function(){
    document.getElementById('btnDiaryAdd').addEventListener('click',addEntry);
    document.getElementById('diaryNewEntry').addEventListener('keydown',function(e){
        if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();addEntry()}
    });
};

function addEntry(){
    var ta=document.getElementById('diaryNewEntry');
    var text=ta.value.trim();if(!text)return;
    IC.state.diary.push({id:IC.uid(),date:new Date().toISOString(),text:text});
    IC.log('Entrada de diario agregada');
    ta.value='';
    renderDiaryEntries();
}

function renderDiaryEntries(){
    var c=document.getElementById('diaryEntries');
    if(!IC.state.diary.length){c.innerHTML='<p style="color:var(--t3);font-size:11px;padding:8px 0">Sin entradas aún.</p>';return}
    // Newest first
    var sorted=IC.state.diary.slice().reverse();
    c.innerHTML=sorted.map(function(e){
        var d=new Date(e.date);
        var dateStr=d.toLocaleDateString('es-PE',{year:'numeric',month:'short',day:'numeric'})+' '+d.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
        return'<div class="diary-entry"><button class="diary-entry-rm" data-id="'+e.id+'">&times;</button><div class="diary-entry-date">'+dateStr+'</div><div class="diary-entry-text">'+IC.esc(e.text)+'</div></div>';
    }).join('');
    c.querySelectorAll('.diary-entry-rm').forEach(function(b){
        b.addEventListener('click',function(){
            IC.state.diary=IC.state.diary.filter(function(x){return x.id!==b.dataset.id});
            renderDiaryEntries();
        });
    });
}

IC.openDiary=function(){IC.openModal('modalDiary');renderDiaryEntries()};

IC.openAuditLog=function(){
    IC.openModal('modalAudit');
    var c=document.getElementById('auditEntries');
    if(!IC.state.auditLog.length){c.innerHTML='<p style="color:var(--t3);font-size:11px">Sin registros.</p>';return}
    var sorted=IC.state.auditLog.slice().reverse();
    c.innerHTML=sorted.map(function(e){
        var d=new Date(e.date);
        var dateStr=d.toLocaleDateString('es-PE',{year:'numeric',month:'short',day:'numeric'})+' '+d.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
        return'<div class="audit-entry"><div class="audit-entry-time">'+dateStr+'</div><div class="audit-entry-text">'+IC.esc(e.text)+'</div></div>';
    }).join('');
};

})();
