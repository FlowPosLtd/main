(function(){
  // scale fixed-size mocks to fit the hero stage
  var stage=document.querySelector('.stage');
  function fit(){if(!stage)return;var s=stage.clientWidth/660;document.querySelectorAll('.stage .mock').forEach(function(m){m.style.transform='scale('+s+')';});}
  fit();window.addEventListener('resize',fit);
  if(document.fonts&&document.fonts.ready)document.fonts.ready.then(fit);

  // tabs
  var tabs=[].slice.call(document.querySelectorAll('.tab')),list=document.querySelector('.tabs'),idx=0,timer=null;
  var reduce=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function show(i){idx=i;tabs.forEach(function(t,j){var on=j===i;t.setAttribute('aria-selected',on);t.tabIndex=on?0:-1;document.getElementById(t.getAttribute('aria-controls')).classList.toggle('on',on);});
    // restart progress animation
    var p=tabs[i].querySelector('.prog i');if(p){p.style.animation='none';p.offsetWidth;p.style.animation='';}}
  function stop(){clearInterval(timer);timer=null;list.classList.remove('auto');}
  tabs.forEach(function(t,i){t.addEventListener('click',function(){stop();show(i);});
    t.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();stop();var n=(idx+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;show(n);tabs[n].focus();}});});
  show(0);
  if(!reduce&&!/[?&]static/.test(location.search)){timer=setInterval(function(){show((idx+1)%tabs.length);},6000);}else{list.classList.remove('auto');}

  // sticky nav state
  var nav=document.querySelector('.nav');
  function onScroll(){nav.classList.toggle('scrolled',window.scrollY>8);}
  onScroll();window.addEventListener('scroll',onScroll,{passive:true});

  // mobile menu
  var mb=document.querySelector('.menu-btn'),mm=document.getElementById('mm');
  mb.addEventListener('click',function(){var o=mm.classList.toggle('open');mb.setAttribute('aria-expanded',o);});
  mm.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){mm.classList.remove('open');mb.setAttribute('aria-expanded','false');});});

  // reveal on scroll
  var els=document.querySelectorAll('.rv');
  if('IntersectionObserver' in window&&!reduce){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}});},{rootMargin:'0px 0px -8% 0px',threshold:.08});els.forEach(function(el){io.observe(el);});}
  else els.forEach(function(el){el.classList.add('in');});

  // form (TODO: replace with real endpoint; this only prevents a dead submit offline)
  var f=document.querySelector('.form');
  f.addEventListener('submit',function(e){if(f.getAttribute('action').indexOf('TODO')>-1){e.preventDefault();if(!f.email.value||!f.name.value){(f.name.value?f.email:f.name).focus();return;}f.querySelector('.ok').style.display='block';}});
  var y=document.getElementById('yr');if(y)y.textContent=new Date().getFullYear();
})();
