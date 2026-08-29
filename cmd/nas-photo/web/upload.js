(() => {
  const SUPPORTED_EXTENSIONS = new Set([
    '.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif',
    '.mp4', '.mov', '.m4v', '.webm', '.mkv', '.avi'
  ]);

  const copy = {
    en: {
      dropTitle: 'Drop files or folders to upload',
      scanning: 'Checking dropped files…',
      preparing: 'Preparing upload…',
      noFiles: 'No supported photos or videos were found.',
      signIn: 'Sign in before uploading.',
      uploadTitle: 'Uploading to NAS-PHOTO',
      found: (count, skipped) => `${count} supported files${skipped ? ` · ${skipped} unsupported files skipped` : ''}`,
      destination: value => `Destination: ${value}`,
      uploading: (done, total) => `Uploading ${done} / ${total}`,
      committing: 'All files received. Saving the batch to the NAS…',
      completed: count => `Upload complete · ${count} files`,
      interrupted: 'Upload was interrupted. Received files are kept temporarily for up to 1 hour.',
      commitFailed: 'The files reached this server, but saving them to the NAS failed. You can retry without re-uploading.',
      retry: 'Retry',
      discard: 'Discard',
      close: 'Close',
      expired: 'The temporary upload expired. Starting a new upload…',
      error: 'Upload failed.'
    },
    ja: {
      dropTitle: 'ファイルまたはフォルダをドロップしてアップロード',
      scanning: 'ドロップした内容を確認しています…',
      preparing: 'アップロードを準備しています…',
      noFiles: '対応している画像・動画が見つかりませんでした。',
      signIn: 'ログイン後にアップロードしてください。',
      uploadTitle: 'NAS-PHOTOへアップロード',
      found: (count, skipped) => `対応ファイル ${count}件${skipped ? ` · 非対応 ${skipped}件を除外` : ''}`,
      destination: value => `保存先: ${value}`,
      uploading: (done, total) => `アップロード中 ${done} / ${total}`,
      committing: '全ファイルを受信しました。NASへまとめて保存しています…',
      completed: count => `アップロード完了 · ${count}件`,
      interrupted: 'アップロードが中断されました。受信済みファイルは最大1時間、一時保存されます。',
      commitFailed: 'サーバーへの受信は完了しましたが、NASへの保存に失敗しました。再アップロードせずに再試行できます。',
      retry: '再試行',
      discard: '破棄',
      close: '閉じる',
      expired: '一時ファイルの保持期限が切れました。新しいアップロードとして開始します…',
      error: 'アップロードに失敗しました。'
    }
  };

  let overlay;
  let panel;
  let dragDepth = 0;
  let activeSession = null;
  let activeXHR = null;
  let dropInProgress = false;

  function language() {
    return document.documentElement.lang === 'ja' ? 'ja' : 'en';
  }

  function msg(key, ...args) {
    const value = copy[language()][key] ?? copy.en[key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
  }

  function ensureUI() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'upload-drop-overlay';
      overlay.hidden = true;
      const card = document.createElement('div');
      card.className = 'upload-drop-card';
      const title = document.createElement('strong');
      title.className = 'upload-drop-title';
      card.append(title);
      overlay.append(card);
      document.body.append(overlay);
    }
    $('.upload-drop-title', overlay).textContent = msg('dropTitle');

    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'upload-status-panel';
      panel.hidden = true;
      panel.innerHTML = `
        <div class="upload-status-head">
          <strong class="upload-status-title"></strong>
          <button type="button" class="upload-close" aria-label="Close">×</button>
        </div>
        <div class="upload-status-message"></div>
        <div class="upload-status-detail"></div>
        <div class="upload-progress" aria-hidden="true"><div class="upload-progress-value"></div></div>
        <div class="upload-status-actions">
          <button type="button" class="upload-retry"></button>
          <button type="button" class="upload-discard"></button>
        </div>`;
      document.body.append(panel);
      $('.upload-close', panel).onclick = () => {
        if (!activeSession || activeSession.finished || activeSession.failed) panel.hidden = true;
      };
      $('.upload-retry', panel).onclick = () => retryActiveUpload();
      $('.upload-discard', panel).onclick = () => discardActiveUpload();
    }
    $('.upload-close', panel).setAttribute('aria-label', msg('close'));
    $('.upload-retry', panel).textContent = msg('retry');
    $('.upload-discard', panel).textContent = msg('discard');
  }

  function $(selector, root = document) {
    return root.querySelector(selector);
  }

  function showOverlay() {
    ensureUI();
    overlay.hidden = false;
  }

  function hideOverlay() {
    if (overlay) overlay.hidden = true;
  }

  function showPanel(message, detail = '') {
    ensureUI();
    panel.hidden = false;
    $('.upload-status-title', panel).textContent = msg('uploadTitle');
    $('.upload-status-message', panel).textContent = message;
    $('.upload-status-detail', panel).textContent = detail;
  }

  function setActions({retry = false, discard = false, close = false} = {}) {
    ensureUI();
    $('.upload-retry', panel).hidden = !retry;
    $('.upload-discard', panel).hidden = !discard;
    $('.upload-close', panel).hidden = !close;
  }

  function setProgress(value) {
    ensureUI();
    const normalized = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
    $('.upload-progress-value', panel).style.width = `${normalized * 100}%`;
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    const digits = unit === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(digits)} ${units[unit]}`;
  }

  function extension(name) {
    const index = name.lastIndexOf('.');
    return index < 0 ? '' : name.slice(index).toLowerCase();
  }

  function isSupported(file) {
    return file && file.size > 0 && SUPPORTED_EXTENSIONS.has(extension(file.name));
  }

  function appendDroppedFile(file, sourcePath, output, counters) {
    if (!file) return false;
    counters.seen++;
    if (isSupported(file)) {
      output.push({file, sourcePath: sourcePath || file.name});
      return true;
    }
    counters.skipped++;
    return false;
  }

  async function walkFileSystemHandle(handle, prefix, output, counters) {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      appendDroppedFile(file, prefix ? `${prefix}/${file.name}` : file.name, output, counters);
      return;
    }
    const current = prefix ? `${prefix}/${handle.name}` : handle.name;
    for await (const child of handle.values()) {
      await walkFileSystemHandle(child, current, output, counters);
    }
  }

  function readEntryFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  function readEntryChildren(reader) {
    return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
  }

  async function walkWebkitEntry(entry, prefix, output, counters) {
    if (entry.isFile) {
      const file = await readEntryFile(entry);
      appendDroppedFile(file, prefix ? `${prefix}/${file.name}` : file.name, output, counters);
      return;
    }
    if (!entry.isDirectory) return;
    const current = prefix ? `${prefix}/${entry.name}` : entry.name;
    const reader = entry.createReader();
    while (true) {
      const children = await readEntryChildren(reader);
      if (!children.length) break;
      for (const child of children) await walkWebkitEntry(child, current, output, counters);
    }
  }

  async function collectDroppedFiles(dataTransfer) {
    const output = [];
    const counters = {seen: 0, skipped: 0};
    const items = [...(dataTransfer.items || [])].filter(item => item.kind === 'file');
    if (items.length) {
      for (const item of items) {
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
        if (entry?.isDirectory) {
          await walkWebkitEntry(entry, '', output, counters);
          continue;
        }
        const file = item.getAsFile();
        if (file) {
          appendDroppedFile(file, file.name, output, counters);
          continue;
        }
        if (entry) {
          await walkWebkitEntry(entry, '', output, counters);
          continue;
        }
        if (typeof item.getAsFileSystemHandle === 'function') {
          try {
            const handle = await item.getAsFileSystemHandle();
            if (handle) {
              await walkFileSystemHandle(handle, '', output, counters);
              continue;
            }
          } catch (_) {}
        }
      }
    }
    if (!items.length || !output.length) {
      if (items.length) {
        counters.seen = 0;
        counters.skipped = 0;
      }
      for (const file of [...(dataTransfer.files || [])]) {
        appendDroppedFile(file, file.webkitRelativePath || file.name, output, counters);
      }
    }
    const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;
    output.sort((left, right) =>
      compareText(left.sourcePath, right.sourcePath) ||
      compareText(left.file.name, right.file.name) ||
      left.file.size - right.file.size
    );
    return {files: output, skipped: counters.skipped};
  }

  async function requestJSON(path, options = {}) {
    const response = await fetch(path, {credentials: 'same-origin', ...options});
    if (!response.ok) {
      const text = (await response.text()).trim() || `HTTP ${response.status}`;
      const error = new Error(text);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    return response.json();
  }

  async function createOrResumeBatch(descriptors) {
    const manifest = descriptors.map(({file, sourcePath}) => ({
      name: file.name,
      sourcePath,
      size: file.size
    }));
    return requestJSON('/api/uploads/batches', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({files: manifest})
    });
  }

  function uploadedBytes(batch) {
    return batch.files.reduce((sum, file) => sum + (file.uploaded ? file.size : 0), 0);
  }

  function uploadedCount(batch) {
    return batch.files.reduce((sum, file) => sum + (file.uploaded ? 1 : 0), 0);
  }

  function totalBytes(batch) {
    return batch.files.reduce((sum, file) => sum + file.size, 0);
  }

  function uploadFile(batchID, index, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      activeXHR = xhr;
      xhr.open('PUT', `/api/uploads/batches/${encodeURIComponent(batchID)}/files/${index}`);
      xhr.withCredentials = true;
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      };
      xhr.onload = () => {
        activeXHR = null;
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (error) {
            reject(error);
          }
          return;
        }
        const error = new Error(xhr.responseText.trim() || `HTTP ${xhr.status}`);
        error.status = xhr.status;
        reject(error);
      };
      xhr.onerror = () => {
        activeXHR = null;
        reject(new Error('network error'));
      };
      xhr.onabort = () => {
        activeXHR = null;
        const error = new Error('upload aborted');
        error.aborted = true;
        reject(error);
      };
      xhr.send(file);
    });
  }

  async function refreshBatch(session) {
    try {
      const response = await requestJSON(`/api/uploads/batches/${encodeURIComponent(session.batch.id)}`);
      session.batch = response.batch;
      return true;
    } catch (error) {
      if (error.status !== 404 && error.status !== 410) throw error;
      return false;
    }
  }

  async function startBatchUpload(session) {
    activeSession = session;
    session.failed = false;
    session.finished = false;
    session.cancelled = false;
    setActions({retry: false, discard: true, close: false});

    const exists = await refreshBatch(session).catch(() => true);
    if (!exists) {
      showPanel(msg('expired'), msg('found', session.descriptors.length, session.skipped));
      const created = await createOrResumeBatch(session.descriptors);
      session.batch = created.batch;
    }

    const total = totalBytes(session.batch);
    for (let index = 0; index < session.descriptors.length; index++) {
      if (session.cancelled) return;
      if (session.batch.files[index]?.uploaded) continue;
      const doneBefore = uploadedBytes(session.batch);
      const countBefore = uploadedCount(session.batch);
      showPanel(
        msg('uploading', countBefore, session.batch.files.length),
        `${msg('destination', session.batch.destination)} · ${formatBytes(total)}`
      );
      try {
        const result = await uploadFile(session.batch.id, index, session.descriptors[index].file, loaded => {
          setProgress(total ? (doneBefore + loaded) / total : 0);
        });
        session.batch = result.batch;
        setProgress(total ? uploadedBytes(session.batch) / total : 1);
      } catch (error) {
        if (session.cancelled || error.aborted) return;
        if (error.status === 404 || error.status === 410) {
          showPanel(msg('expired'), msg('found', session.descriptors.length, session.skipped));
          const created = await createOrResumeBatch(session.descriptors);
          session.batch = created.batch;
          return startBatchUpload(session);
        }
        session.failed = true;
        showPanel(
          msg('interrupted'),
          `${uploadedCount(session.batch)} / ${session.batch.files.length} · ${error.message}`
        );
        setActions({retry: true, discard: true, close: true});
        return;
      }
    }

    if (session.cancelled) return;
    showPanel(msg('committing'), msg('destination', session.batch.destination));
    setProgress(1);
    setActions({retry: false, discard: false, close: false});
    try {
      const result = await requestJSON(`/api/uploads/batches/${encodeURIComponent(session.batch.id)}/commit`, {method: 'POST'});
      session.batch = result.batch;
      session.finished = true;
      session.failed = false;
      showPanel(msg('completed', session.batch.files.length), msg('destination', session.batch.destination));
      setActions({retry: false, discard: false, close: true});
      setTimeout(() => {
        if (typeof window.boot === 'function') window.boot().catch?.(() => {});
      }, 750);
    } catch (error) {
      session.failed = true;
      showPanel(msg('commitFailed'), error.message);
      setActions({retry: true, discard: true, close: true});
    }
  }

  async function retryActiveUpload() {
    const session = activeSession;
    if (!session || session.finished) return;
    setActions({retry: false, discard: false, close: false});
    try {
      await startBatchUpload(session);
    } catch (error) {
      session.failed = true;
      showPanel(msg('error'), error.message);
      setActions({retry: true, discard: true, close: true});
    }
  }

  async function discardActiveUpload() {
    const session = activeSession;
    if (!session || session.finished) {
      if (panel) panel.hidden = true;
      return;
    }
    session.cancelled = true;
    if (activeXHR) activeXHR.abort();
    setActions({retry: false, discard: false, close: false});
    try {
      await requestJSON(`/api/uploads/batches/${encodeURIComponent(session.batch.id)}`, {method: 'DELETE'});
    } catch (_) {}
    activeSession = null;
    if (panel) panel.hidden = true;
  }

  async function processDrop(event) {
    let collected;
    try {
      collected = await collectDroppedFiles(event.dataTransfer);
    } catch (error) {
      ensureUI();
      showPanel(msg('error'), error.message);
      setActions({close: true});
      return;
    }

    ensureUI();
    showPanel(msg('scanning'));
    setProgress(0);
    setActions({retry: false, discard: false, close: false});
    try {
      await requestJSON('/api/auth/me');
    } catch (error) {
      showPanel(msg('signIn'), error.message);
      setActions({close: true});
      return;
    }
    if (!collected.files.length) {
      showPanel(msg('noFiles'), collected.skipped ? msg('found', 0, collected.skipped) : '');
      setActions({close: true});
      return;
    }

    const bytes = collected.files.reduce((sum, item) => sum + item.file.size, 0);
    showPanel(msg('preparing'), `${msg('found', collected.files.length, collected.skipped)} · ${formatBytes(bytes)}`);
    try {
      const created = await createOrResumeBatch(collected.files);
      const session = {
        descriptors: collected.files,
        skipped: collected.skipped,
        batch: created.batch,
        failed: false,
        finished: false,
        cancelled: false
      };
      activeSession = session;
      await startBatchUpload(session);
    } catch (error) {
      showPanel(msg('error'), error.message);
      setActions({retry: !!activeSession, discard: !!activeSession, close: true});
    }
  }

  async function handleDrop(event) {
    dragDepth = 0;
    hideOverlay();
    if (dropInProgress || (activeSession && !activeSession.finished)) return;
    if (activeSession?.finished) activeSession = null;
    dropInProgress = true;
    try {
      await processDrop(event);
    } finally {
      dropInProgress = false;
    }
  }

  function resetDragUI() {
    dragDepth = 0;
    hideOverlay();
  }

  function hasFiles(event) {
    return [...(event.dataTransfer?.types || [])].includes('Files');
  }

  document.addEventListener('dragenter', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    showOverlay();
  });

  document.addEventListener('dragover', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    showOverlay();
  });

  document.addEventListener('dragleave', event => {
    if (event.relatedTarget === null) {
      resetDragUI();
      return;
    }
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) hideOverlay();
  });

  document.addEventListener('drop', event => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    handleDrop(event);
  });
  document.addEventListener('dragend', resetDragUI);
  window.addEventListener('blur', resetDragUI);
})();
