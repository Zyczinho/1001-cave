/* Ratchet icon system — consistent 24x24 outline icons, no font downloads. */
(function(){
  'use strict';
  const paths={
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    bot:'<rect width="16" height="12" x="4" y="8" rx="3"/><path d="M12 8V4m-3 0h6M8 14h.01M16 14h.01M4 12H2m20 0h-2"/>',
    glasses:'<circle cx="7.5" cy="13" r="4"/><circle cx="16.5" cy="13" r="4"/><path d="M3.5 12L2 9m19 3 1.5-3M11.5 12h1"/>',
    link:'<path d="M10 13a5 5 0 0 0 7.1 0l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2a5 5 0 0 0 7.1 7.1l1.1-1.1"/>',
    external:'<path d="M13 5h6v6M19 5l-9 9"/><path d="M19 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>',
    settings:'<path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l-1.8 1.8a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66H9.12a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-1.8-1.8A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.66-1.1V10.1A1.8 1.8 0 0 0 4.6 9a1.8 1.8 0 0 0-.36-1.98l1.8-1.8A1.8 1.8 0 0 0 8.02 5.6a1.8 1.8 0 0 0 1.1-1.66h5.76a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 1.98-.36l1.8 1.8A1.8 1.8 0 0 0 19.4 9a1.8 1.8 0 0 0 1.66 1.1v3.8A1.8 1.8 0 0 0 19.4 15Z"/>',
    more:'<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    x:'<path d="M18 6 6 18M6 6l12 12"/>',
    refresh:'<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9A7 7 0 0 1 18 7l2 5M4 12l2 5a7 7 0 0 0 12.4-2"/>',
    power:'<path d="M12 3v9"/><path d="M6 6.5a9 9 0 1 0 12 0"/>',
    folder:'<path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    edit:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L10 16l-4 1 1-4Z"/>',
    trash:'<path d="M3 6h18M8 6V4h8v2m3 0-1 14H6L5 6M10 10v7m4-7v7"/>',
    check:'<path d="m5 12 4 4L19 6"/>',
    play:'<path d="m8 5 12 7-12 7Z"/>',
    copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    alert:'<path d="m10.3 3.8-8.1 14a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3l-8.1-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/>',
    calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 11h18"/>',
    bell:'<path d="M18 8a6 6 0 0 0-12 0c0 8-3 8-3 10h18c0-2-3-2-3-10M10 21h4"/>',
    arrow:'<path d="M7 17 17 7M7 7h10v10"/>',
    snooze:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l-3 3"/>',
    shield:'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    download:'<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>',
    minimize:'<path d="M4 12h16"/>'
  };
  function icon(name,size=16){const p=paths[name]||paths.check;return `<svg class="ui-icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${p}</svg>`;}
  window.ratchetIcon=icon;
  window.ratchetHydrateIcons=function(root=document){root.querySelectorAll('[data-icon]').forEach(el=>{const name=el.getAttribute('data-icon');if(!paths[name])return;el.innerHTML=icon(name,el.getAttribute('data-size')||16);el.classList.add('icon-slot');});};
})();
