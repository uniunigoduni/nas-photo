const CACHE='nas-photo-shell-v32';
const SHELL=['/','/index.html','/theme.css','/base.css','/shell.css','/gallery.css','/dialogs.css','/viewer.css','/upload.css','/m3e.bundle.js','/layout.js','/core.js','/shell.js','/gallery.js','/dialogs.js','/viewer.js','/viewer-zoom.js','/viewer-gestures.js','/settings.js','/upload.js','/runtime.js','/manifest.webmanifest','/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL))));
self.addEventListener('activate',event=>event.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.origin!==location.origin||url.pathname.startsWith('/api/'))return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).catch(()=>caches.match('/index.html'))); return;
  }
  event.respondWith(fetch(event.request).then(response=>{
    const copy=response.clone();
    caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    return response;
  }).catch(()=>caches.match(event.request)));
});
