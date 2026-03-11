/* ========================================
   IMG-CORPUS V2 — Graph
   D3 relationship map of corpus
   ======================================== */
(function(){

IC.initGraph=function(){};

IC.renderGraph=function(){
    var svg=d3.select('#graphSvg');
    svg.selectAll('*').remove();

    var container=document.getElementById('graphView');
    var w=container.clientWidth,h=container.clientHeight;
    svg.attr('viewBox','0 0 '+w+' '+h);

    // Build nodes (images) and links (chains + relations)
    var nodes=IC.state.images.map(function(img,i){
        var annCount=(img.annotations||[]).length;
        return{id:img.id,label:(i+1)+'. '+img.name.substring(0,16),r:Math.max(16,Math.min(30,10+annCount*3)),idx:i};
    });

    var links=[];
    // Chain links: images sharing the same chain
    IC.state.chains.forEach(function(ch){
        var imgIds=[...new Set(ch.links.map(function(l){return l.imageId}))];
        for(var i=0;i<imgIds.length;i++){
            for(var j=i+1;j<imgIds.length;j++){
                links.push({source:imgIds[i],target:imgIds[j],label:ch.name,color:ch.color,type:'chain'});
            }
        }
    });

    if(!nodes.length){
        svg.append('text').attr('x',w/2).attr('y',h/2).attr('text-anchor','middle').attr('fill','#686880').attr('font-size','14px').text('Agrega imágenes al corpus para ver el mapa.');
        return;
    }

    var simulation=d3.forceSimulation(nodes)
        .force('link',d3.forceLink(links).id(function(d){return d.id}).distance(120))
        .force('charge',d3.forceManyBody().strength(-200))
        .force('center',d3.forceCenter(w/2,h/2))
        .force('collision',d3.forceCollide().radius(function(d){return d.r+10}));

    var link=svg.append('g').selectAll('line').data(links).enter().append('line')
        .attr('class','gv-link')
        .attr('stroke',function(d){return d.color||'#3a3a4e'})
        .attr('stroke-width',2)
        .attr('stroke-dasharray',function(d){return d.type==='chain'?'6,3':''});

    var linkLabel=svg.append('g').selectAll('text').data(links).enter().append('text')
        .attr('fill','#686880').attr('font-size','9px').attr('text-anchor','middle')
        .text(function(d){return d.label||''});

    var node=svg.append('g').selectAll('g').data(nodes).enter().append('g').attr('class','gv-node')
        .call(d3.drag().on('start',dragStart).on('drag',dragging).on('end',dragEnd));

    node.append('circle').attr('r',function(d){return d.r}).attr('fill','#22222e').attr('stroke','#4ecdc4').attr('stroke-width',2)
        .style('cursor','pointer');

    node.append('text').attr('dy',function(d){return d.r+14}).attr('text-anchor','middle')
        .text(function(d){return d.label});

    // Click to navigate
    node.on('dblclick',function(event,d){
        IC.setViewMode('single');IC.selectImage(d.id);
    });

    simulation.on('tick',function(){
        link.attr('x1',function(d){return d.source.x}).attr('y1',function(d){return d.source.y})
            .attr('x2',function(d){return d.target.x}).attr('y2',function(d){return d.target.y});
        linkLabel.attr('x',function(d){return(d.source.x+d.target.x)/2}).attr('y',function(d){return(d.source.y+d.target.y)/2-4});
        node.attr('transform',function(d){return'translate('+d.x+','+d.y+')'});
    });

    function dragStart(event,d){if(!event.active)simulation.alphaTarget(.3).restart();d.fx=d.x;d.fy=d.y}
    function dragging(event,d){d.fx=event.x;d.fy=event.y}
    function dragEnd(event,d){if(!event.active)simulation.alphaTarget(0);d.fx=null;d.fy=null}
};

})();
