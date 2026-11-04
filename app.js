const $ = (selector) => document.querySelector(selector);
let openaiApiKeyReady = false;
let background = null;
let products = [];
let outputDataUrl = '';
let outputBackgroundName = '';
let refineReferences = [];
let finalDataUrl = '';
let activeHistoryId = '';
let previewDataUrl = '';
let previewBackgroundName = '';
let editingAnchors = [];
let draggedAnchorIndex = -1;

function openHistoryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('clothing-swap-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('results', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function completeTransaction(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function getHistory() {
  const db = await openHistoryDb();
  const transaction = db.transaction('results', 'readonly');
  const request = transaction.objectStore('results').getAll();
  const items = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  return items.sort((a, b) => b.createdAt - a.createdAt);
}

async function addToHistory(dataUrl, backgroundName, stage = '03 생성') {
  const db = await openHistoryDb();
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let transaction = db.transaction('results', 'readwrite');
  transaction.objectStore('results').put({ id, dataUrl, backgroundName, stage, createdAt: Date.now() });
  await completeTransaction(transaction);
  const items = await getHistory();
  if (items.length > 20) {
    transaction = db.transaction('results', 'readwrite');
    const store = transaction.objectStore('results');
    items.slice(20).forEach((item) => store.delete(item.id));
    await completeTransaction(transaction);
  }
  activeHistoryId = id;
  await renderHistory();
}

function showHistoryItem(item) {
  activeHistoryId = item.id;
  previewDataUrl = item.dataUrl;
  previewBackgroundName = item.backgroundName || '배경';
  $('#preview-image').src = item.dataUrl;
  $('#preview-dialog').showModal();
  renderHistory();
  toast('히스토리 이미지를 확대했습니다.');
}

async function renderHistory() {
  try {
    const items = (await getHistory()).slice(0, 20);
    const track = $('#history-track');
    track.replaceChildren();
    $('#history-count').textContent = `${items.length} / 20`;
    if (!items.length) {
      const empty = document.createElement('p');
      empty.id = 'history-empty';
      empty.textContent = '아직 생성된 결과가 없습니다.';
      track.append(empty);
      return;
    }
    const formatter = new Intl.DateTimeFormat('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    items.forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `history-item${item.id === activeHistoryId ? ' active' : ''}`;
      button.title = `${item.backgroundName || '배경'} · ${formatter.format(item.createdAt)}`;
      const image = document.createElement('img');
      image.src = item.dataUrl;
      image.alt = '이전 생성 결과';
      const label = document.createElement('span');
      label.textContent = `${item.stage || '03 생성'} · ${item.backgroundName?.replace(/\.[^.]+$/, '') || '배경'} · ${formatter.format(item.createdAt)}`;
      button.append(image, label);
      button.addEventListener('click', () => showHistoryItem(item));
      track.append(button);
    });
  } catch {
    const track = $('#history-track');
    const empty = document.createElement('p');
    empty.id = 'history-empty';
    empty.textContent = '히스토리를 불러오지 못했습니다.';
    track.replaceChildren(empty);
  }
}

function toast(message) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('show'), 2800);
}

function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) return reject(new Error('이미지 파일을 선택해 주세요.'));
    if (file.size > 15 * 1024 * 1024) return reject(new Error('15MB 이하 이미지를 선택해 주세요.'));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다.'));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve({ dataUrl: reader.result, image, name: file.name });
      image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function setUpload(kind, input) {
  try {
    const value = await readImage(input.files[0]);
    if (kind === 'background') {
      setBackground(value, 'custom');
      $('#custom-background img').src = value.dataUrl;
      $('#custom-background').hidden = false;
      $('#background-node .replace').hidden = false;
    }
  } catch (error) { toast(error.message); }
}

function setBackground(value, source) {
  value.defaultHangerAnchors = (value.hangerAnchors || []).map((point) => ({ ...point }));
  const savedAnchors = loadSavedAnchors(value);
  if (savedAnchors) value.hangerAnchors = savedAnchors;
  background = value;
  $('#background-node').classList.add('complete');
  $('#background-status').textContent = '선택 완료';
  document.querySelectorAll('.background-choice').forEach((button) => button.classList.toggle('selected', source === button.dataset.url));
  if (source !== 'custom') {
    $('#custom-background').hidden = true;
    $('#background-node .replace').hidden = true;
  }
  updateReady();
  updateAnchorControl();
  drawLines();
}

function anchorStorageKey(value) {
  if (!value) return '';
  const width = value.image?.naturalWidth || value.image?.width || 0;
  const height = value.image?.naturalHeight || value.image?.height || 0;
  return `clothing-hanger-anchors:${value.name || 'custom'}:${width}x${height}`;
}

function loadSavedAnchors(value) {
  try {
    const stored = localStorage.getItem(anchorStorageKey(value));
    const parsed = stored ? JSON.parse(stored) : null;
    return Array.isArray(parsed) ? parsed.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) : null;
  } catch { return null; }
}

function updateAnchorControl() {
  $('#edit-anchors').disabled = !background;
  const count = background?.hangerAnchors?.length || 0;
  $('#anchor-count').textContent = background ? (count ? `${count}개 위치 등록` : '위치 미등록') : '배경을 먼저 선택하세요';
}

function drawAnchorEditor() {
  if (!background?.image) return;
  const canvas = $('#anchor-canvas');
  const image = background.image;
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const radius = Math.max(13, canvas.width * .009);
  ctx.font = `bold ${Math.round(radius * 1.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  editingAnchors.forEach((point, index) => {
    const x = point.x * canvas.width;
    const y = point.y * canvas.height;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(4, canvas.width * .0025);
    ctx.fillStyle = '#00a651';
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(index + 1), x, y + 1);
  });
  $('#anchor-editor-count').textContent = `${editingAnchors.length}개 위치`;
}

function canvasPoint(event) {
  const canvas = $('#anchor-canvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    hitRadius: 22 / rect.width
  };
}

function openAnchorEditor() {
  if (!background) return;
  editingAnchors = (background.hangerAnchors || []).map((point) => ({ ...point }));
  drawAnchorEditor();
  $('#anchor-dialog').showModal();
}

async function dataUrlFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error('기본 배경을 불러오지 못했습니다.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function selectLibraryBackground(url, name, garmentCount, hangerAnchors = []) {
  try {
    const dataUrl = await dataUrlFromUrl(url);
    const image = await loadDataImage(dataUrl);
    setBackground({ dataUrl, image, name, garmentCount, hangerAnchors }, url);
    toast(`${name} 배경을 선택했습니다.`);
  } catch (error) { toast(error.message); }
}

async function loadBackgroundLibrary() {
  const host = $('#background-library');
  try {
    const response = await fetch('/api/backgrounds');
    const payload = await response.json();
    if (!response.ok) throw new Error('기본 배경 목록을 불러오지 못했습니다.');
    if (!payload.backgrounds?.length) {
      host.innerHTML = '<span>BG 폴더에 이미지가 없습니다.</span>';
      return;
    }
    host.innerHTML = payload.backgrounds.map((item) => `<button class="background-choice" data-url="${item.url}" data-name="${item.name}" data-garment-count="${item.garmentCount || ''}" data-hanger-anchors='${JSON.stringify(item.hangerAnchors || [])}'><img src="${item.url}" alt="${item.name}"><b>${item.name.replace(/\.[^.]+$/, '')}</b></button>`).join('');
    host.querySelectorAll('.background-choice').forEach((button) => button.addEventListener('click', () => selectLibraryBackground(button.dataset.url, button.dataset.name, Number(button.dataset.garmentCount) || null, JSON.parse(button.dataset.hangerAnchors || '[]'))));
  } catch (error) {
    host.innerHTML = `<span>${error.message}</span>`;
  }
}

async function loadServerConfig() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    openaiApiKeyReady = Boolean(config.openaiApiKeyReady);
  } catch {
    openaiApiKeyReady = false;
  }
  $('#api-ready').textContent = openaiApiKeyReady ? '● CHATGPT IMAGE 연결됨' : '● OPENAI KEY 입력';
  $('#api-ready').classList.toggle('needs-key', !openaiApiKeyReady);
  if (!openaiApiKeyReady) openApiKeyDialog();
}

function openApiKeyDialog() {
  const dialog = $('#api-key-dialog');
  $('#api-key-input').value = '';
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => $('#api-key-input').focus());
}

async function saveSessionApiKey(event) {
  event.preventDefault();
  const key = $('#api-key-input').value.trim();
  if (!key) return toast('OpenAI API 키를 입력해 주세요.');
  const button = $('#save-api-key');
  button.disabled = true;
  try {
    const response = await fetch('/api/session-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: key }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || 'API 키를 적용하지 못했습니다.');
    openaiApiKeyReady = true;
    $('#api-key-input').value = '';
    $('#api-key-dialog').close();
    $('#api-ready').textContent = '● CHATGPT IMAGE 연결됨';
    $('#api-ready').classList.remove('needs-key');
    updateReady();
    updateRefineReady();
    toast('OpenAI API 키가 현재 실행 세션에 적용되었습니다.');
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function setProducts(input) {
  try {
    const files = [...input.files].slice(0, 6);
    if (!files.length) return;
    products = await Promise.all(files.map(readImage));
    const node = $('#product-node');
    node.classList.add('complete');
    $('#product-preview').innerHTML = products.map((item, index) => `<figure><img src="${item.dataUrl}" alt="제품 ${index + 1}"><b>${index + 1}</b></figure>`).join('');
    node.querySelector('.upload-copy').hidden = true;
    node.querySelector('.replace').hidden = false;
    $('#product-status').textContent = `${products.length}장 완료`;
    updateReady();
    drawLines();
    toast(`제품 이미지 ${products.length}장을 첨부했습니다.`);
    if (input.files.length > 6) toast('제품 이미지는 최대 6개까지 적용됩니다.');
  } catch (error) { toast(error.message); }
}

async function setRefineReferences(input) {
  try {
    const files = [...input.files].slice(0, 6);
    if (!files.length) return;
    refineReferences = await Promise.all(files.map(readImage));
    $('#reference-preview').innerHTML = refineReferences.map((item, index) => `<figure><img src="${item.dataUrl}" alt="수정 레퍼런스 ${index + 1}"><b>${index + 1}</b></figure>`).join('');
    $('#reference-copy').hidden = true;
    $('#clear-references').hidden = false;
    updateRefineReady();
    drawLines();
    toast(`수정 레퍼런스 ${refineReferences.length}장을 첨부했습니다.`);
    if (input.files.length > 6) toast('수정 레퍼런스는 최대 6장까지 적용됩니다.');
  } catch (error) { toast(error.message); }
}

function clearRefineReferences() {
  refineReferences = [];
  $('#reference-input').value = '';
  $('#reference-preview').replaceChildren();
  $('#reference-copy').hidden = false;
  $('#clear-references').hidden = true;
  updateRefineReady();
}

function updateRefineReady() {
  const hasInstruction = Boolean($('#refine-prompt').value.trim() || refineReferences.length);
  const ready = Boolean(outputDataUrl && hasInstruction);
  $('#refine-generate').disabled = !ready;
  $('#refine-status').textContent = outputDataUrl ? (hasInstruction ? '준비 완료' : '입력 필요') : '03 결과 필요';
}

function closestAspect(width, height) {
  const ratio = width / height;
  return [['1:1', 1], ['4:3', 4/3], ['3:2', 3/2], ['16:9', 16/9], ['3:4', 3/4], ['2:3', 2/3], ['9:16', 9/16]].sort((a, b) => Math.abs(a[1] - ratio) - Math.abs(b[1] - ratio))[0][0];
}

function updateReady() {
  const ready = Boolean(background && products.length);
  const button = $('#generate');
  const status = $('#ready-status');
  button.disabled = !ready;
  status.classList.toggle('ready', ready);
  if (ready) status.textContent = `준비 완료 · 배경 1장 + 제품 ${products.length}장`;
  else if (!background && !products.length) status.textContent = '배경 이미지와 새 의상을 선택하세요';
  else if (!background) status.textContent = '배경 이미지를 선택하세요';
  else status.textContent = '새 의상 이미지를 첨부하세요';
}

function loadDataImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    image.src = dataUrl;
  });
}

async function normalizeToOutput(dataUrl) {
  const generated = await loadDataImage(dataUrl);
  const width = 1920;
  const height = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(generated, 0, 0, width, height);
  return canvas.toDataURL('image/png');
}

function createAnchorGuide(image, anchors) {
  if (!image || !Array.isArray(anchors) || !anchors.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = Math.max(4, canvas.width * .003);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, canvas.width - ctx.lineWidth, canvas.height - ctx.lineWidth);
  const points = anchors.map((point) => ({ x: point.x * canvas.width, y: point.y * canvas.height }));
  ctx.strokeStyle = '#ff2a2a';
  ctx.lineWidth = Math.max(6, canvas.width * .004);
  ctx.beginPath();
  ctx.moveTo(Math.min(...points.map((point) => point.x)) - canvas.width * .03, points[0].y);
  ctx.lineTo(Math.max(...points.map((point) => point.x)) + canvas.width * .03, points[0].y);
  ctx.stroke();
  const radius = Math.max(14, canvas.width * .012);
  ctx.font = `bold ${Math.round(radius * 1.15)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  points.forEach((point, index) => {
    ctx.fillStyle = '#00a651';
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(index + 1), point.x, point.y + 1);
  });
  ctx.fillStyle = '#111111';
  ctx.font = `bold ${Math.max(22, Math.round(canvas.width * .018))}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('POSITION GUIDE ONLY - DO NOT RENDER MARKS', canvas.width * .03, canvas.height * .06);
  return canvas.toDataURL('image/png');
}

async function generate() {
  if (!openaiApiKeyReady) { openApiKeyDialog(); return toast('본인의 OpenAI API 키를 먼저 입력해 주세요.'); }
  const button = $('#generate');
  button.disabled = true;
  $('#loading').hidden = false;
  $('#result-empty').hidden = true;
  try {
    const hangerAnchors = background.hangerAnchors || [];
    const anchorGuide = createAnchorGuide(background.image, hangerAnchors);
    const response = await fetch('/api/swap', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ background: background.dataUrl, backgroundName: background.name, products: products.map((item) => item.dataUrl), garmentCount: background.garmentCount || null, hangerAnchors, anchorGuide, aspectRatio: '16:9' }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || '의상 교체에 실패했습니다.');
    outputDataUrl = await normalizeToOutput(payload.dataUrl);
    outputBackgroundName = background.name;
    finalDataUrl = '';
    $('#final-image').src = '';
    $('#final-image').classList.remove('visible');
    $('#final-node').classList.remove('complete');
    $('#final-full-view').hidden = true;
    $('.final-actions').hidden = true;
    $('#final-empty').hidden = false;
    $('#result-image').src = outputDataUrl;
    $('#result-image').classList.add('visible');
    $('#result-node').classList.add('complete');
    $('#full-view').hidden = false;
    $('.result-actions').hidden = false;
    try {
      await addToHistory(outputDataUrl, outputBackgroundName, '03 생성');
    } catch {
      toast('결과는 생성됐지만 브라우저 히스토리에 저장하지 못했습니다.');
    }
    toast('ChatGPT 이미지 생성으로 의상 교체가 완료되었습니다.');
    updateRefineReady();
  } catch (error) {
    $('#result-empty').hidden = false;
    toast(error.message);
  } finally {
    $('#loading').hidden = true;
    button.disabled = false;
  }
}

async function refineImage() {
  if (!openaiApiKeyReady) { openApiKeyDialog(); return toast('본인의 OpenAI API 키를 먼저 입력해 주세요.'); }
  if (!outputDataUrl) return toast('먼저 03번 의상 교체 결과를 생성해 주세요.');
  const instruction = $('#refine-prompt').value.trim();
  if (!instruction && !refineReferences.length) return toast('수정 프롬프트 또는 레퍼런스 이미지를 추가해 주세요.');
  const button = $('#refine-generate');
  button.disabled = true;
  $('#final-loading').hidden = false;
  $('#final-empty').hidden = true;
  try {
    const response = await fetch('/api/refine', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: outputDataUrl, prompt: instruction, references: refineReferences.map((item) => item.dataUrl) })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || '최종 이미지 수정에 실패했습니다.');
    finalDataUrl = await normalizeToOutput(payload.dataUrl);
    $('#final-image').src = finalDataUrl;
    $('#final-image').classList.add('visible');
    $('#final-node').classList.add('complete');
    $('#final-full-view').hidden = false;
    $('.final-actions').hidden = false;
    try {
      await addToHistory(finalDataUrl, outputBackgroundName || background?.name || '배경', '05 수정');
    } catch {
      toast('최종 결과는 생성됐지만 브라우저 히스토리에 저장하지 못했습니다.');
    }
    toast('최종 수정 이미지가 생성되었습니다.');
  } catch (error) {
    $('#final-empty').hidden = false;
    toast(error.message);
  } finally {
    $('#final-loading').hidden = true;
    updateRefineReady();
  }
}

$('#background-input').addEventListener('change', (event) => setUpload('background', event.target));
$('#product-input').addEventListener('change', (event) => setProducts(event.target));
$('#reference-input').addEventListener('change', (event) => setRefineReferences(event.target));
$('#refine-prompt').addEventListener('input', updateRefineReady);
$('#clear-references').addEventListener('click', () => { clearRefineReferences(); $('#reference-input').click(); });
document.querySelectorAll('.replace').forEach((button) => button.addEventListener('click', () => $(`#${button.dataset.for}`).click()));
$('#generate').addEventListener('click', generate);
$('#retry').addEventListener('click', generate);
$('#refine-generate').addEventListener('click', refineImage);
$('#final-retry').addEventListener('click', refineImage);
$('#download').addEventListener('click', async () => {
  if (!outputDataUrl) return toast('먼저 결과 이미지를 생성해 주세요.');
  const button = $('#download');
  button.disabled = true;
  try {
    const response = await fetch('/api/save-output', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: outputDataUrl, backgroundName: outputBackgroundName || background?.name || '배경' }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || '결과 저장에 실패했습니다.');
    toast(`${payload.folder} 폴더에 ${payload.filename} 저장 완료`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
$('#final-download').addEventListener('click', async () => {
  if (!finalDataUrl) return toast('먼저 최종 수정 이미지를 생성해 주세요.');
  const button = $('#final-download');
  button.disabled = true;
  try {
    const response = await fetch('/api/save-output', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: finalDataUrl, backgroundName: `${(outputBackgroundName || background?.name || '배경').replace(/\.[^.]+$/, '')}_수정` }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || '최종 결과 저장에 실패했습니다.');
    toast(`${payload.folder} 폴더에 ${payload.filename} 저장 완료`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
$('#full-view').addEventListener('click', () => { previewDataUrl = outputDataUrl; previewBackgroundName = outputBackgroundName || background?.name || '배경'; $('#preview-image').src = outputDataUrl; $('#preview-dialog').showModal(); });
$('#final-full-view').addEventListener('click', () => { previewDataUrl = finalDataUrl; previewBackgroundName = `${(outputBackgroundName || background?.name || '배경').replace(/\.[^.]+$/, '')}_수정`; $('#preview-image').src = finalDataUrl; $('#preview-dialog').showModal(); });
$('#api-ready').addEventListener('click', openApiKeyDialog);
$('#api-key-form').addEventListener('submit', saveSessionApiKey);
$('#close-api-key-dialog').addEventListener('click', () => $('#api-key-dialog').close());
$('#close-preview').addEventListener('click', () => $('#preview-dialog').close());
$('#preview-dialog').addEventListener('click', (event) => { if (event.target === $('#preview-dialog')) $('#preview-dialog').close(); });
$('#preview-download').addEventListener('click', async () => {
  if (!previewDataUrl) return toast('저장할 확대 이미지가 없습니다.');
  const button = $('#preview-download');
  button.disabled = true;
  try {
    const response = await fetch('/api/save-output', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dataUrl: previewDataUrl, backgroundName: previewBackgroundName || '배경' }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error?.message || '확대 이미지 저장에 실패했습니다.');
    toast(`${payload.folder} 폴더에 ${payload.filename} 저장 완료`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
});
$('#edit-anchors').addEventListener('click', openAnchorEditor);
$('#close-anchor-dialog').addEventListener('click', () => $('#anchor-dialog').close());
$('#anchor-dialog').addEventListener('click', (event) => { if (event.target === $('#anchor-dialog')) $('#anchor-dialog').close(); });
$('#remove-last-anchor').addEventListener('click', () => {
  editingAnchors.pop();
  drawAnchorEditor();
});
$('#reset-anchors').addEventListener('click', () => {
  editingAnchors = (background?.defaultHangerAnchors || []).map((point) => ({ ...point }));
  drawAnchorEditor();
});
$('#save-anchors').addEventListener('click', () => {
  if (!background) return;
  editingAnchors.sort((a, b) => a.x - b.x);
  background.hangerAnchors = editingAnchors.map((point) => ({ ...point }));
  background.garmentCount = background.hangerAnchors.length || null;
  localStorage.setItem(anchorStorageKey(background), JSON.stringify(background.hangerAnchors));
  updateAnchorControl();
  updateReady();
  $('#anchor-dialog').close();
  toast(`${background.hangerAnchors.length}개 옷걸이 위치를 저장했습니다.`);
});

$('#anchor-canvas').addEventListener('pointerdown', (event) => {
  const canvas = $('#anchor-canvas');
  const point = canvasPoint(event);
  draggedAnchorIndex = editingAnchors.findIndex((anchor) => Math.hypot(anchor.x - point.x, anchor.y - point.y) <= point.hitRadius);
  if (draggedAnchorIndex < 0) {
    if (editingAnchors.length >= 12) return toast('옷걸이 위치는 최대 12개까지 등록할 수 있습니다.');
    editingAnchors.push({ x: point.x, y: point.y });
    draggedAnchorIndex = editingAnchors.length - 1;
  }
  canvas.setPointerCapture(event.pointerId);
  drawAnchorEditor();
});

$('#anchor-canvas').addEventListener('pointermove', (event) => {
  if (draggedAnchorIndex < 0) return;
  const point = canvasPoint(event);
  editingAnchors[draggedAnchorIndex] = { x: point.x, y: point.y };
  drawAnchorEditor();
});

function finishAnchorDrag(event) {
  if (draggedAnchorIndex < 0) return;
  const canvas = $('#anchor-canvas');
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  draggedAnchorIndex = -1;
}

$('#anchor-canvas').addEventListener('pointerup', finishAnchorDrag);
$('#anchor-canvas').addEventListener('pointercancel', finishAnchorDrag);

function drawLines() {
  const flow = $('.workflow').getBoundingClientRect();
  const pairs = [
    ['line-bg-result', '#background-node .port.out', '#result-node .port.in.top'],
    ['line-product-result', '#product-node .port.out', '#result-node .port.in.bottom'],
    ['line-result-refine', '#result-node .port.out', '#refine-node .port.in'],
    ['line-refine-final', '#refine-node .port.out', '#final-node .port.in'],
    ['line-result-history', '#result-node .port.out', '#history-node .port.in.top'],
    ['line-final-history', '#final-node .port.out', '#history-node .port.in.bottom']
  ];
  for (const [id, fromSelector, toSelector] of pairs) {
    const from = $(fromSelector)?.getBoundingClientRect();
    const to = $(toSelector)?.getBoundingClientRect();
    if (!from || !to) continue;
    const x1 = (from.left + from.width / 2 - flow.left) / workflowZoom, y1 = (from.top + from.height / 2 - flow.top) / workflowZoom;
    const x2 = (to.left + to.width / 2 - flow.left) / workflowZoom, y2 = (to.top + to.height / 2 - flow.top) / workflowZoom;
    const bend = Math.max(45, Math.abs(x2 - x1) * .45);
    $(`#${id}`).setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
  }
}

const nodePositions = JSON.parse(sessionStorage.getItem('clothing-node-positions') || '{}');
const nodeSizes = JSON.parse(sessionStorage.getItem('clothing-node-sizes') || '{}');
let workflowZoom = Math.min(1.2, Math.max(.45, Number(sessionStorage.getItem('clothing-workflow-zoom')) || 1));
let sizePersistenceEnabled = false;

function applyWorkflowZoom() {
  $('.workflow').style.zoom = workflowZoom;
  $('#zoom-level').textContent = `${Math.round(workflowZoom * 100)}%`;
  sessionStorage.setItem('clothing-workflow-zoom', String(workflowZoom));
  requestAnimationFrame(drawLines);
}

function applyNodePosition(node) {
  const position = nodePositions[node.id];
  if (!position) return;
  node.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
}

function applyNodeSize(node) {
  const size = nodeSizes[node.id];
  if (!size || window.matchMedia('(max-width: 680px)').matches) return;
  node.style.width = `${size.width}px`;
  node.style.height = `${size.height}px`;
}

document.querySelectorAll('.node').forEach((node) => {
  applyNodePosition(node);
  applyNodeSize(node);
  node.title = '상단을 드래그하면 이동 · 우측 아래 꼭짓점을 드래그하면 크기 조절';
  new ResizeObserver(([entry]) => {
    drawLines();
    if (!sizePersistenceEnabled || window.matchMedia('(max-width: 680px)').matches) return;
    const width = Math.round(entry.borderBoxSize?.[0]?.inlineSize || node.getBoundingClientRect().width);
    const height = Math.round(entry.borderBoxSize?.[0]?.blockSize || node.getBoundingClientRect().height);
    nodeSizes[node.id] = { width, height };
    sessionStorage.setItem('clothing-node-sizes', JSON.stringify(nodeSizes));
  }).observe(node);
  const handle = node.querySelector('.node-head');
  handle.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 680px)').matches) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const start = nodePositions[node.id] || { x: 0, y: 0 };
    const origin = { x: event.clientX, y: event.clientY };
    node.classList.add('dragging');

    const move = (moveEvent) => {
      const next = { x: start.x + (moveEvent.clientX - origin.x) / workflowZoom, y: start.y + (moveEvent.clientY - origin.y) / workflowZoom };
      nodePositions[node.id] = next;
      node.style.transform = `translate3d(${next.x}px, ${next.y}px, 0)`;
      drawLines();
    };
    const finish = () => {
      node.classList.remove('dragging');
      sessionStorage.setItem('clothing-node-positions', JSON.stringify(nodePositions));
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  });
});

$('#reset-nodes').addEventListener('click', () => {
  sizePersistenceEnabled = false;
  Object.keys(nodePositions).forEach((key) => delete nodePositions[key]);
  Object.keys(nodeSizes).forEach((key) => delete nodeSizes[key]);
  sessionStorage.removeItem('clothing-node-positions');
  sessionStorage.removeItem('clothing-node-sizes');
  document.querySelectorAll('.node').forEach((node) => { node.style.transform = ''; node.style.width = ''; node.style.height = ''; });
  drawLines();
  requestAnimationFrame(() => { sizePersistenceEnabled = true; });
  toast('노드 위치와 크기를 초기화했습니다.');
});

$('#reset-zoom').addEventListener('click', () => {
  workflowZoom = 1;
  applyWorkflowZoom();
  toast('화면 배율을 100%로 복원했습니다.');
});

window.addEventListener('wheel', (event) => {
  if (!event.ctrlKey) return;
  event.preventDefault();
  const direction = event.deltaY > 0 ? -1 : 1;
  workflowZoom = Math.min(1.2, Math.max(.45, Math.round((workflowZoom + direction * .05) * 100) / 100));
  applyWorkflowZoom();
}, { passive: false });

window.addEventListener('resize', drawLines);
applyWorkflowZoom();
requestAnimationFrame(() => { drawLines(); sizePersistenceEnabled = true; });
loadBackgroundLibrary();
loadServerConfig();
renderHistory();
