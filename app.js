const $ = (id) => document.getElementById(id);

const CONFIG_KEY = 'seletor-unhas-config-v10';
const PROFILE_KEY = 'seletor-unhas-profile-v2';
const HISTORY_KEY = 'seletor-unhas-history-v1';
const DB_NAME = 'seletor-unhas-db-v1';
const DB_STORE = 'kv';
const MAX_HISTORY = 8;

const MODEL_PRICES = {
  'gpt-5.6-luna': { input: 0.20, output: 1.20 },
  'gpt-5.6-terra': { input: 2.00, output: 12.00 },
  'gpt-5.6-sol': { input: 4.00, output: 20.00 },
};

let photos = [];
let groups = [];
let lastResults = [];
let lastFinal = { ranking: [], selecionadas: [] };
let sessionFeedback = {};
let manualFinal = new Set();
let galleryMode = 'ai';
let currentSessionId = crypto.randomUUID?.() || String(Date.now());
let currentSessionName = '';
let usageTotals = { input_tokens: 0, output_tokens: 0 };
let activePair = null;
let pairQueue = [];
let freshCache = new Map();
let freshPreparing = new Map();

const defaultConfig = {
  threshold: 22,
  maxPerGroup: 4,
  finalCount: 5,
  maxFinalists: 12,
  model: 'gpt-5.6-terra',
  usdBrl: 5.10,
  proxyUrl: '',
};

const defaultProfile = {
  schemaVersion: 2,
  examples: [],
  pairwise: [],
  learnedProfile: {
    summary: 'Ainda há poucos exemplos para resumir seu gosto.',
    rules: [],
    updatedAt: null,
    source: 'local',
  },
};

let config = loadJSON(CONFIG_KEY, defaultConfig);
let profile = loadJSON(PROFILE_KEY, defaultProfile);
let history = loadJSON(HISTORY_KEY, []);

function loadJSON(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key));
    return parsed ? { ...structuredClone(fallback), ...parsed } : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}

function saveConfig() {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

function saveProfile() {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  updateProfileUI();
  persistState();
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY)));
  renderHistory();
}

function escapeHTML(v = '') {
  return String(v).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
}

function formatDate(iso) {
  try { return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)); }
  catch { return iso || ''; }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, value) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (e) { console.warn('IndexedDB save failed', e); }
}

async function dbGet(key) {
  try {
    const db = await openDB();
    const value = await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readonly');
      const req = tx.objectStore(DB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return value;
  } catch (e) {
    console.warn('IndexedDB read failed', e);
    return null;
  }
}

async function dbDelete(key) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {}
}

async function persistFiles() {
  if (!photos.length) return;
  await dbSet('current-files', photos.map((p) => p.file));
}

function serializeGroups() {
  return groups.map((g) => ({ ids: g.items.map((p) => p.id), repId: g.rep?.id || g.items[0]?.id }));
}

async function persistState() {
  const state = {
    sessionId: currentSessionId,
    sessionName: currentSessionName,
    photoMeta: photos.map((p) => ({ id: p.id, hash: p.hash, quality: p.quality, width: p.width, height: p.height, name: p.file?.name })),
    groups: serializeGroups(),
    lastResults,
    lastFinal,
    sessionFeedback,
    manualFinal: [...manualFinal],
    usageTotals,
    updatedAt: new Date().toISOString(),
  };
  await dbSet('current-state', state);
  updateRestoreCard();
}

async function updateRestoreCard() {
  const state = await dbGet('current-state');
  const files = await dbGet('current-files');
  const card = $('restoreCard');
  if (!card) return;
  const usable = state && Array.isArray(files) && files.length;
  card.classList.toggle('hidden', !usable || photos.length > 0);
  if (usable) {
    $('restoreInfo').textContent = `${state.sessionName || 'Sessão anterior'} · ${files.length} foto(s) · ${formatDate(state.updatedAt)}`;
  }
}

async function restoreSession() {
  const state = await dbGet('current-state');
  const files = await dbGet('current-files');
  if (!state || !Array.isArray(files) || !files.length) return;
  resetTransient(false);
  currentSessionId = state.sessionId || currentSessionId;
  currentSessionName = state.sessionName || '';
  $('sessionName').value = currentSessionName;
  const meta = new Map((state.photoMeta || []).map((m) => [m.id, m]));
  photos = files.map((file, i) => {
    const id = i + 1;
    const m = meta.get(id) || {};
    return { id, file, url: URL.createObjectURL(file), hash: m.hash || null, quality: m.quality || 0, width: m.width || 0, height: m.height || 0 };
  });
  groups = (state.groups || []).map((g) => {
    const items = g.ids.map((id) => photos.find((p) => p.id === id)).filter(Boolean);
    return { items, rep: photos.find((p) => p.id === g.repId) || items[0] };
  }).filter((g) => g.items.length);
  lastResults = state.lastResults || [];
  lastFinal = state.lastFinal || { ranking: [], selecionadas: [] };
  sessionFeedback = state.sessionFeedback || {};
  manualFinal = new Set(state.manualFinal || []);
  usageTotals = state.usageTotals || { input_tokens: 0, output_tokens: 0 };
  $('selectionInfo').textContent = `${photos.length} foto(s) restaurada(s).`;
  $('groupBtn').disabled = photos.length < 2;
  if (groups.length) {
    renderGroups();
    $('groupsSection').classList.remove('hidden');
    $('aiSection').classList.remove('hidden');
    $('trainingSection').classList.remove('hidden');
    buildPairQueue();
    updateCostEstimate();
  }
  if (lastResults.length || lastFinal.selecionadas?.length) {
    renderResults(lastResults, lastFinal);
    $('resultsSection').classList.remove('hidden');
    renderPostCost();
  }
  updateRestoreCard();
}

function setupConfigUI() {
  $('threshold').value = config.threshold;
  $('thresholdValue').textContent = config.threshold;
  $('maxPerGroup').value = config.maxPerGroup;
  $('finalCount').value = config.finalCount;
  $('maxFinalists').value = config.maxFinalists;
  $('model').value = config.model;
  $('usdBrl').value = config.usdBrl;
  $('proxyUrl').value = config.proxyUrl || '';

  $('threshold').oninput = (e) => { config.threshold = +e.target.value; $('thresholdValue').textContent = config.threshold; saveConfig(); };
  for (const id of ['maxPerGroup', 'finalCount', 'maxFinalists', 'model', 'usdBrl', 'proxyUrl']) {
    $(id).addEventListener(id === 'proxyUrl' ? 'change' : 'input', () => {
      config[id] = id === 'model' || id === 'proxyUrl' ? $(id).value.trim() : +$(id).value;
      saveConfig();
      updateCostEstimate();
    });
  }
}

function profileReactionScore(reaction) {
  return reaction === 'gostei_muito' ? 4 : reaction === 'gostei' ? 3 : reaction === 'neutro' ? 2 : reaction === 'nao_gostei' ? 0 : 1;
}

function buildLocalPreferenceSummary() {
  const examples = profile.examples || [];
  const pairwise = profile.pairwise || [];
  if (!examples.length && !pairwise.length) {
    return { summary: 'Ainda há poucos exemplos para resumir seu gosto.', rules: [] };
  }
  const liked = examples.filter((x) => profileReactionScore(x.reacao) >= 3);
  const disliked = examples.filter((x) => profileReactionScore(x.reacao) <= 0);
  const tags = new Map();
  function bump(tag, delta) { if (tag) tags.set(tag, (tags.get(tag) || 0) + delta); }
  liked.forEach((x) => (x.likedTags || []).forEach((t) => bump(t, 2)));
  disliked.forEach((x) => (x.dislikedTags || []).forEach((t) => bump(t, -2)));
  examples.forEach((x) => {
    if (x.correctable === 'crop') bump('problemas de enquadramento podem ser corrigidos por corte', 1.5);
    if (x.correctable === 'edit') bump('alguns defeitos leves podem ser corrigidos por edição', 1);
    if (x.correctable === 'acceptable') bump('alguns defeitos citados pela IA são aceitáveis sem correção', 1);
  });
  const ordered = [...tags.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
  const rules = ordered.map(([tag, score]) => score > 0 ? `Tende a valorizar/aceitar: ${tag}.` : `Tende a rejeitar: ${tag}.`);
  if (pairwise.length >= 3) rules.push(`Há ${pairwise.length} comparações A/B registradas; use preferências relativas quando fotos forem muito parecidas.`);
  const summary = `${examples.length} avaliações e ${pairwise.length} comparações A/B. ${rules.slice(0, 4).join(' ') || 'Continue avaliando para o perfil ficar mais específico.'}`;
  return { summary, rules };
}

function refreshLocalProfile() {
  const local = buildLocalPreferenceSummary();
  if (!profile.learnedProfile || profile.learnedProfile.source !== 'ai') {
    profile.learnedProfile = { ...local, updatedAt: new Date().toISOString(), source: 'local' };
  } else {
    profile.learnedProfile.localSummary = local.summary;
    profile.learnedProfile.localRules = local.rules;
  }
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  updateProfileUI();
}

function updateProfileUI() {
  const e = profile.examples?.length || 0;
  const p = profile.pairwise?.length || 0;
  $('trainingCount').textContent = `${e} avaliação(ões) · ${p} comparação(ões) A/B`;
  const learned = profile.learnedProfile || {};
  $('profileSummary').textContent = learned.summary || buildLocalPreferenceSummary().summary;
  const rules = learned.rules || [];
  $('profileRules').innerHTML = rules.length ? rules.map((r) => `<li>${escapeHTML(r)}</li>`).join('') : '<li>Sem regras suficientes ainda.</li>';
  renderLearningManager();
  renderAccuracy();
}

function renderLearningManager() {
  const wrap = $('learningExamples');
  if (!wrap) return;
  const recent = (profile.examples || []).slice(-8).reverse();
  wrap.innerHTML = recent.length ? recent.map((x) => `
    <div class="learningRow" data-learning-id="${escapeHTML(x.id)}">
      <div><strong>${reactionLabel(x.reacao)}</strong><span>${escapeHTML((x.comentario || x.opiniaoIA || '').slice(0, 110))}</span></div>
      <button class="ghost small deleteLearning">Apagar</button>
    </div>`).join('') : '<div class="muted">Nenhuma avaliação salva ainda.</div>';
  wrap.querySelectorAll('.deleteLearning').forEach((btn) => btn.onclick = () => {
    const id = btn.closest('.learningRow').dataset.learningId;
    profile.examples = (profile.examples || []).filter((x) => x.id !== id);
    profile.learnedProfile.source = 'local';
    refreshLocalProfile();
    saveProfile();
  });
}

function reactionLabel(v) {
  return v === 'gostei_muito' ? '❤️ Gostei muito' : v === 'gostei' ? '👍 Gostei' : v === 'nao_gostei' ? '👎 Não gostei' : v === 'neutro' ? '➖ Aceitável' : '✍️ Comentário';
}

function renderAccuracy() {
  const sessions = history.filter((x) => Number.isFinite(x.agreement));
  const current = calculateCurrentAgreement();
  const vals = [...sessions.map((x) => x.agreement), ...(current != null ? [current] : [])];
  const overall = vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  $('accuracyValue').textContent = overall == null ? 'Ainda sem dados' : `${overall}% de concordância média`;
  $('accuracyHint').textContent = vals.length ? `Baseado em ${vals.length} sessão(ões) com avaliações suas.` : 'Depois que você avaliar as escolhas da IA, esta métrica mostra se ela está se aproximando do seu gosto.';
}

function calculateCurrentAgreement() {
  const ai = lastFinal.selecionadas || [];
  const evaluated = ai.filter((id) => sessionFeedback[id]?.reacao);
  if (!evaluated.length) return null;
  const positive = evaluated.filter((id) => profileReactionScore(sessionFeedback[id].reacao) >= 3).length;
  return Math.round(positive / evaluated.length * 100);
}

$('exportProfileBtn').onclick = () => {
  const exportData = { ...profile, exportedAt: new Date().toISOString(), fixedUiScale: .75 };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'perfil-preferencias-unhas-v2.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

$('importProfileInput').onchange = async (e) => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(data.examples)) throw new Error();
    profile = {
      ...structuredClone(defaultProfile),
      ...data,
      pairwise: Array.isArray(data.pairwise) ? data.pairwise : [],
      learnedProfile: { ...defaultProfile.learnedProfile, ...(data.learnedProfile || {}) },
    };
    refreshLocalProfile();
    saveProfile();
    alert('Perfil importado.');
  } catch { alert('JSON de perfil inválido.'); }
};

$('resetLearningBtn').onclick = () => {
  if (!confirm('Apagar todo o aprendizado salvo neste aparelho?')) return;
  profile = structuredClone(defaultProfile);
  saveProfile();
};

function isImageFile(file) {
  return file.type?.startsWith('image/') || /\.(heic|heif|jpg|jpeg|png|webp)$/i.test(file.name || '');
}

$('photoInput').onchange = async (e) => {
  resetTransient();
  const files = [...e.target.files].filter(isImageFile).slice(0, 60);
  currentSessionId = crypto.randomUUID?.() || String(Date.now());
  currentSessionName = $('sessionName').value.trim() || `Ensaio ${new Date().toLocaleDateString('pt-BR')}`;
  photos = files.map((file, i) => ({ id: i + 1, file, url: URL.createObjectURL(file), hash: null, quality: 0, width: 0, height: 0 }));
  $('selectionInfo').textContent = `${photos.length} foto(s) selecionada(s).`;
  $('groupBtn').disabled = photos.length < 2;
  await persistFiles();
  await persistState();
};

$('sessionName').onchange = () => {
  currentSessionName = $('sessionName').value.trim();
  persistState();
};

$('resetBtn').onclick = () => location.reload();
$('restoreBtn').onclick = restoreSession;
$('discardRestoreBtn').onclick = async () => { await dbDelete('current-state'); await dbDelete('current-files'); updateRestoreCard(); };

function resetTransient(clearFiles = true) {
  groups = [];
  lastResults = [];
  lastFinal = { ranking: [], selecionadas: [] };
  sessionFeedback = {};
  manualFinal = new Set();
  usageTotals = { input_tokens: 0, output_tokens: 0 };
  activePair = null;
  pairQueue = [];
  freshCache.clear();
  freshPreparing.clear();
  for (const id of ['groupStatus', 'aiStatus', 'groups', 'results', 'chosenGallery', 'pairArea', 'costAfter']) if ($(id)) $(id).textContent = '';
  for (const id of ['groupsSection', 'aiSection', 'trainingSection', 'resultsSection']) $(id)?.classList.add('hidden');
  if (clearFiles) photos.forEach((p) => { try { URL.revokeObjectURL(p.url); } catch {} });
}

async function loadDrawable(file) {
  try {
    const bmp = await createImageBitmap(file);
    return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
  } catch (bitmapError) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = reject;
        im.src = url;
      });
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
    } catch (imgError) {
      URL.revokeObjectURL(url);
      throw new Error(`Não consegui abrir ${file.name || 'uma imagem'}. Se for HEIC/HEIF, tente selecionar novamente pelo app Fotos ou converter apenas esta imagem.`);
    }
  }
}

async function analyzeLocal(photo) {
  const d = await loadDrawable(photo.file);
  photo.width = d.width;
  photo.height = d.height;

  const c = document.createElement('canvas');
  c.width = 9; c.height = 8;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(d.source, 0, 0, 9, 8);
  const px = ctx.getImageData(0, 0, 9, 8).data;
  const gray = [];
  for (let i = 0; i < px.length; i += 4) gray.push(px[i] * .299 + px[i + 1] * .587 + px[i + 2] * .114);
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';

  const qc = document.createElement('canvas');
  qc.width = 256;
  qc.height = Math.max(1, Math.round(256 * d.height / d.width));
  const qctx = qc.getContext('2d', { willReadFrequently: true });
  qctx.drawImage(d.source, 0, 0, qc.width, qc.height);
  const q = qctx.getImageData(0, 0, qc.width, qc.height).data;
  const W = qc.width, H = qc.height;
  const lum = (x, y) => { const i = (y * W + x) * 4; return q[i] * .299 + q[i + 1] * .587 + q[i + 2] * .114; };
  let edge = 0, n = 0;
  for (let y = 1; y < H - 1; y += 3) for (let x = 1; x < W - 1; x += 3) {
    edge += Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
    n++;
  }
  d.close();
  photo.hash = bits;
  photo.quality = n ? edge / n : 0;
}

function hamming(a, b) {
  if (!a || !b) return 64;
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d;
}

function makeGroups(items, threshold) {
  const result = [];
  for (const photo of items) {
    let best = null, bestD = Infinity;
    for (const g of result) {
      const d = hamming(photo.hash, g.rep.hash);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (best && bestD <= threshold) {
      best.items.push(photo);
      if (photo.quality > best.rep.quality) best.rep = photo;
    } else result.push({ rep: photo, items: [photo] });
  }
  return result.sort((a, b) => b.items.length - a.items.length);
}

function chooseCandidates(items, max) {
  if (items.length <= max) return [...items].sort((a, b) => b.quality - a.quality);
  const sorted = [...items].sort((a, b) => b.quality - a.quality);
  const out = [sorted.shift()];
  while (out.length < max && sorted.length) {
    let bi = 0, bs = -Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const diversity = Math.min(...out.map((c) => hamming(sorted[i].hash, c.hash)));
      const sharp = sorted[i].quality / (out[0].quality || 1);
      const score = diversity * 1.35 + sharp * 8;
      if (score > bs) { bs = score; bi = i; }
    }
    out.push(sorted.splice(bi, 1)[0]);
  }
  return out;
}

$('groupBtn').onclick = async () => {
  $('groupBtn').disabled = true;
  try {
    for (let i = 0; i < photos.length; i++) {
      $('groupStatus').textContent = `Analisando localmente ${i + 1}/${photos.length}…`;
      await analyzeLocal(photos[i]);
      await new Promise((r) => setTimeout(r, 0));
    }
    groups = makeGroups(photos, config.threshold);
    renderGroups();
    buildPairQueue();
    renderPairTraining();
    $('groupStatus').textContent = `${groups.length} grupo(s) criado(s). Esta etapa foi local e não teve custo de API.`;
    $('groupsSection').classList.remove('hidden');
    $('aiSection').classList.remove('hidden');
    $('trainingSection').classList.remove('hidden');
    updateCostEstimate();
    await persistState();
  } catch (e) {
    console.error(e);
    $('groupStatus').textContent = e.message || 'Falha ao agrupar.';
  } finally { $('groupBtn').disabled = false; }
};

function renderGroups() {
  const wrap = $('groups');
  wrap.innerHTML = '';
  groups.forEach((g, i) => {
    const cs = chooseCandidates(g.items, Math.min(config.maxPerGroup, g.items.length));
    const ids = new Set(cs.map((p) => p.id));
    const a = document.createElement('article');
    a.className = 'group';
    a.innerHTML = `<div class="groupHeader"><div class="groupTitle">Grupo ${i + 1} · ${g.items.length} foto(s)</div><div class="candidateInfo">${cs.length} candidatas → IA</div></div><div class="thumbs">${g.items.map((p) => `<div class="thumb"><img src="${p.url}" alt="Foto ${p.id}"><span class="badge">#${p.id}</span>${ids.has(p.id) ? '<span class="autoBadge">AVALIAR</span>' : ''}</div>`).join('')}</div>`;
    wrap.appendChild(a);
  });
}

function buildPairQueue() {
  const pairs = [];
  for (const g of groups) {
    const sorted = [...g.items].sort((a, b) => a.id - b.id);
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1];
      pairs.push({ a: a.id, b: b.id, distance: hamming(a.hash, b.hash), source: 'local' });
    }
  }
  pairQueue = pairs.sort((x, y) => x.distance - y.distance).slice(0, 20);
  activePair = pairQueue[0] || null;
}

function renderPairTraining() {
  const area = $('pairArea');
  if (!activePair) {
    area.innerHTML = '<div class="emptyGallery">Não há um par adequado nesta sessão.</div>';
    return;
  }
  const a = photos.find((p) => p.id === activePair.a), b = photos.find((p) => p.id === activePair.b);
  if (!a || !b) return;
  area.innerHTML = `
    <div class="pairGrid">
      <button class="pairPhoto" data-choice="a"><img src="${a.url}"><strong>A · Foto #${a.id}</strong></button>
      <button class="pairPhoto" data-choice="b"><img src="${b.url}"><strong>B · Foto #${b.id}</strong></button>
    </div>
    <div class="pairActions">
      <button data-pair-choice="a">Prefiro A</button><button data-pair-choice="b">Prefiro B</button><button data-pair-choice="tie" class="ghost">Quase iguais</button><button data-pair-choice="neither" class="ghost">Nenhuma</button>
    </div>
    <label>Comentário opcional<textarea id="pairComment" placeholder="Ex.: prefiro o reflexo da A; a posição dos dedos da B me incomoda."></textarea></label>`;
  area.querySelectorAll('[data-pair-choice]').forEach((btn) => btn.onclick = () => savePairChoice(btn.dataset.pairChoice));
  area.querySelectorAll('.pairPhoto').forEach((btn) => btn.onclick = () => savePairChoice(btn.dataset.choice));
}

function savePairChoice(choice) {
  if (!activePair) return;
  profile.pairwise.push({
    id: crypto.randomUUID?.() || String(Date.now() + Math.random()),
    createdAt: new Date().toISOString(),
    aFingerprint: photos.find((p) => p.id === activePair.a)?.hash,
    bFingerprint: photos.find((p) => p.id === activePair.b)?.hash,
    aSessionPhoto: activePair.a,
    bSessionPhoto: activePair.b,
    preferred: choice,
    comment: $('pairComment')?.value.trim() || '',
  });
  profile.learnedProfile.source = 'local';
  refreshLocalProfile();
  saveProfile();
  pairQueue.shift();
  activePair = pairQueue[0] || null;
  renderPairTraining();
}

$('nextPairBtn').onclick = () => {
  if (pairQueue.length > 1) pairQueue.push(pairQueue.shift());
  activePair = pairQueue[0] || null;
  renderPairTraining();
};

function estimateImageTokens(w, h) {
  if (!w || !h) return 2280;
  const scale = Math.min(1, 1600 / Math.max(w, h));
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const patches = Math.min(2500, Math.ceil(sw / 32) * Math.ceil(sh / 32));
  return Math.round(patches * 1.2);
}

function moneyFromTokens(inputTokens, outputTokens, model = config.model) {
  const price = MODEL_PRICES[model] || MODEL_PRICES['gpt-5.6-terra'];
  const usd = inputTokens / 1e6 * price.input + outputTokens / 1e6 * price.output;
  return { usd, brl: usd * (Number(config.usdBrl) || 5.10) };
}

function preCostRange() {
  if (!groups.length) return null;
  const maxPer = Number(config.maxPerGroup) || 4;
  const candidates = groups.flatMap((g) => chooseCandidates(g.items, Math.min(maxPer, g.items.length)));
  const candidateTokens = candidates.reduce((s, p) => s + estimateImageTokens(p.width, p.height), 0);
  const lowerFinalCount = Math.min(groups.length, Number(config.maxFinalists) || 12);
  const upperFinalCount = Math.min(groups.length * 2, Number(config.maxFinalists) || 12, candidates.length);
  const avg = candidates.length ? candidateTokens / candidates.length : 2280;
  const commonInput = candidateTokens + groups.length * 650;
  const lowIn = commonInput + lowerFinalCount * avg + 700;
  const highIn = commonInput + upperFinalCount * avg + 900;
  const lowOut = groups.length * 280 + 350;
  const highOut = groups.length * 520 + 700;
  return { candidates: candidates.length, lowerFinalCount, upperFinalCount, low: moneyFromTokens(lowIn, lowOut), high: moneyFromTokens(highIn, highOut) };
}

function updateCostEstimate() {
  const est = preCostRange();
  if (!est) {
    $('costEstimate').innerHTML = '<span class="muted">Agrupe as fotos para calcular a estimativa desta sessão.</span>';
    return;
  }
  $('costEstimate').innerHTML = `<strong>Estimativa: R$ ${est.low.brl.toFixed(2)}–R$ ${est.high.brl.toFixed(2)}</strong><span>${est.candidates} imagem(ns) na primeira etapa; aproximadamente ${est.lowerFinalCount}–${est.upperFinalCount} podem ser reenviadas na comparação final. É uma estimativa, não cobrança garantida.</span>`;
}

function renderPostCost() {
  const { brl, usd } = moneyFromTokens(usageTotals.input_tokens || 0, usageTotals.output_tokens || 0);
  $('costAfter').innerHTML = `<strong>Custo calculado pelos tokens reportados: ~R$ ${brl.toFixed(2)}</strong><span>${usageTotals.input_tokens || 0} tokens de entrada + ${usageTotals.output_tokens || 0} de saída · US$ ${usd.toFixed(4)} aproximados, usando câmbio de R$ ${Number(config.usdBrl || 5.10).toFixed(2)}.</span>`;
}

async function fileToDataURL(file, maxDim = 1600, quality = .86) {
  const d = await loadDrawable(file);
  const scale = Math.min(1, maxDim / Math.max(d.width, d.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(d.width * scale));
  c.height = Math.max(1, Math.round(d.height * scale));
  c.getContext('2d').drawImage(d.source, 0, 0, c.width, c.height);
  d.close();
  return c.toDataURL('image/jpeg', quality);
}

function learnedText() {
  const local = buildLocalPreferenceSummary();
  const learned = profile.learnedProfile || {};
  const rules = [...(learned.rules || []), ...(learned.localRules || [])].slice(0, 12);
  const examples = (profile.examples || []).slice(-14).map((x, i) => `${i + 1}) ${reactionLabel(x.reacao)}; IA: ${x.opiniaoIA || ''}; usuário: ${x.comentario || 'sem comentário'}; tags positivas=${(x.likedTags || []).join(',')}; negativas=${(x.dislikedTags || []).join(',')}; corrigível=${x.correctable || 'não informado'}`).join('\n');
  return `PREFERÊNCIAS DO USUÁRIO TÊM PRIORIDADE SOBRE CONVENÇÕES ESTÉTICAS GENÉRICAS. Resumo: ${learned.summary || local.summary}. Regras: ${rules.join(' ')}. Glitter/cromado intenso não é defeito por si só. Espaço vazio pode ser corrigível por corte. Exemplos recentes:\n${examples}`;
}

function groupPrompt(groupNumber, ids) {
  return `Você avalia fotografia profissional de unhas. Grupo ${groupNumber}: ${ids.map((x) => '#' + x).join(', ')}. ${learnedText()} Compare detalhes pequenos, não invente defeitos e seja específico sobre ONDE está cada problema. Analise reflexo, pó/partículas, nitidez, pose, visibilidade das unhas, exposição e enquadramento. Se enquadramento puder ser resolvido com crop, não elimine a foto só por isso. Para cada foto, explique contra qual foto ela perdeu quando aplicável. Se houver quase empate, sinalize baixa confiança. Retorne somente JSON válido: {"grupo":${groupNumber},"ranking":[{"foto":0,"nota":0.0,"categoria":"forte candidata|boa candidata|aceitável|fraca","motivo":"curto","diagnostico":{"reflexo":"","limpeza":"","nitidez":"","pose":"","visibilidade":"","exposicao":"","enquadramento":""},"problemas":[{"area":"","problema":"","gravidade":"leve|media|forte","corrigivel":"crop|edicao|nao"}],"comparacao":{"perdeu_para":0,"porque":""},"crop_sugerido":{"aplicar":false,"top":0,"right":0,"bottom":0,"left":0},"confianca":0.0}],"vencedora":0,"confianca":0.0}.`;
}

function finalPrompt(ids, max) {
  return `Compare as sobreviventes ${ids.map((x) => '#' + x).join(', ')} usando estas preferências: ${learnedText()} Escolha no máximo ${max}. Não force diferenças: se duas forem quase empatadas, diga isso. Retorne apenas JSON: {"ranking":[{"foto":0,"nota_final":0.0,"categoria_final":"selecionada|reserva","motivo":"curto","confianca":0.0,"quase_empate_com":0}],"selecionadas":[0],"confianca_geral":0.0}.`;
}

function parseMaybeJSON(text) {
  try { return JSON.parse(text); } catch {}
  const cleaned = String(text || '').replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/i, '').trim();
  const first = cleaned.indexOf('{'), last = cleaned.lastIndexOf('}');
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error('A resposta da IA não veio em JSON válido.');
}

async function apiCall(prompt, selected, maxOutputTokens = 1800) {
  const content = [{ type: 'input_text', text: prompt }];
  for (const p of selected) {
    content.push({ type: 'input_text', text: `Foto #${p.id}` });
    content.push({ type: 'input_image', image_url: await fileToDataURL(p.file), detail: 'high' });
  }
  const body = { model: config.model, input: [{ role: 'user', content }], max_output_tokens: maxOutputTokens };
  const proxy = (config.proxyUrl || '').trim();
  const key = $('apiKey').value.trim();
  if (!proxy && !key) throw new Error('Cole sua chave da API ou configure um proxy seguro.');
  const endpoint = proxy || 'https://api.openai.com/v1/responses';
  const headers = { 'Content-Type': 'application/json' };
  if (!proxy) headers.Authorization = `Bearer ${key}`;
  const resp = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  const data = await resp.json();
  const text = data.output_text || (data.output || []).flatMap((x) => x.content || []).map((c) => c.text || '').join('');
  const usage = data.usage || {};
  usageTotals.input_tokens += usage.input_tokens || 0;
  usageTotals.output_tokens += usage.output_tokens || 0;
  return parseMaybeJSON(text);
}

function normalizeCategory(value) {
  const s = String(value || '').toLowerCase();
  if (s.includes('forte')) return 'forte candidata';
  if (s.includes('boa')) return 'boa candidata';
  if (s.includes('aceit')) return 'aceitável';
  return 'fraca';
}

function categoryClass(v) {
  const c = normalizeCategory(v);
  return c.startsWith('forte') ? 'forte' : c.startsWith('boa') ? 'boa' : c === 'aceitável' ? 'aceitavel' : 'fraca';
}

function addNearTiePairsFromResults(results) {
  for (const r of results) {
    const rank = r.ranking || [];
    if (rank.length < 2) continue;
    const a = rank[0], b = rank[1];
    const near = Math.abs((a.nota || 0) - (b.nota || 0)) <= .45 || Math.min(a.confianca ?? 1, b.confianca ?? 1, r.confianca ?? 1) < .68;
    if (near) pairQueue.unshift({ a: a.foto, b: b.foto, distance: 0, source: 'ai-tie' });
  }
  if (!activePair && pairQueue.length) activePair = pairQueue[0];
  renderPairTraining();
}

$('analyzeBtn').onclick = async () => {
  const max = Number(config.maxPerGroup) || 4;
  const finalCount = Number(config.finalCount) || 5;
  const maxFinalists = Number(config.maxFinalists) || 12;
  usageTotals = { input_tokens: 0, output_tokens: 0 };
  $('analyzeBtn').disabled = true;
  try {
    const results = [], survivors = [];
    for (let i = 0; i < groups.length; i++) {
      const sel = chooseCandidates(groups[i].items, Math.min(max, groups[i].items.length));
      $('aiStatus').textContent = `Avaliando grupo ${i + 1}/${groups.length}…`;
      const r = await apiCall(groupPrompt(i + 1, sel.map((p) => p.id)), sel, 1800);
      r.ranking = (r.ranking || []).map((x) => ({ ...x, categoria: normalizeCategory(x.categoria) }));
      results.push(r);
      const byId = new Map(sel.map((p) => [p.id, p]));
      const ranked = r.ranking || [];
      if (ranked[0] && byId.get(ranked[0].foto)) survivors.push(byId.get(ranked[0].foto));
      if (ranked[1] && normalizeCategory(ranked[1].categoria) !== 'fraca' && byId.get(ranked[1].foto)) survivors.push(byId.get(ranked[1].foto));
    }
    let unique = [...new Map(survivors.filter(Boolean).map((p) => [p.id, p])).values()];
    unique = unique.slice(0, maxFinalists);
    $('aiStatus').textContent = `Comparando ${unique.length} finalistas…`;
    const final = unique.length ? await apiCall(finalPrompt(unique.map((p) => p.id), finalCount), unique, 1200) : { ranking: [], selecionadas: [] };
    lastResults = results;
    lastFinal = final;
    addNearTiePairsFromResults(results);
    renderResults(results, final);
    $('resultsSection').classList.remove('hidden');
    $('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    $('aiStatus').textContent = 'Análise concluída.';
    renderPostCost();
    await persistState();
    await archiveCurrentSession();
  } catch (e) {
    console.error(e);
    $('aiStatus').textContent = `Erro na API: ${e.message}`;
  } finally { $('analyzeBtn').disabled = false; }
};

async function refineProfileWithAI() {
  const examples = (profile.examples || []).slice(-30);
  const pairs = (profile.pairwise || []).slice(-30);
  if (examples.length + pairs.length < 3) return alert('Faça pelo menos 3 avaliações/comparações primeiro.');
  const text = `Resuma preferências pessoais de fotografia de unhas a partir destes dados. Não invente. Dê prioridade a padrões repetidos e diferencie defeitos inaceitáveis de problemas corrigíveis. Retorne JSON apenas: {"summary":"...","rules":["..."]}. Avaliações=${JSON.stringify(examples)} Comparações=${JSON.stringify(pairs)}`;
  try {
    $('refineProfileBtn').disabled = true;
    $('refineProfileBtn').textContent = 'Refinando…';
    const out = await apiCall(text, [], 700);
    profile.learnedProfile = { summary: out.summary || buildLocalPreferenceSummary().summary, rules: Array.isArray(out.rules) ? out.rules.slice(0, 12) : [], updatedAt: new Date().toISOString(), source: 'ai' };
    saveProfile();
  } catch (e) { alert(`Não foi possível refinar: ${e.message}`); }
  finally { $('refineProfileBtn').disabled = false; $('refineProfileBtn').textContent = 'Refinar resumo com IA'; }
}
$('refineProfileBtn').onclick = refineProfileWithAI;

function mineIds() {
  return Object.entries(sessionFeedback).filter(([, v]) => profileReactionScore(v.reacao) >= 3).sort((a, b) => profileReactionScore(b[1].reacao) - profileReactionScore(a[1].reacao)).map(([id]) => +id);
}

function renderResults(results, final) {
  galleryMode = 'ai';
  renderGallery();
  const wrap = $('results');
  wrap.innerHTML = '';
  results.forEach((r) => (r.ranking || []).forEach((item) => {
    const p = photos.find((x) => x.id === item.foto);
    if (!p) return;
    const d = document.createElement('article');
    d.className = 'trainingCard';
    const comparison = item.comparacao?.perdeu_para ? `Perdeu para #${item.comparacao.perdeu_para}: ${item.comparacao.porque || ''}` : '';
    const problems = Array.isArray(item.problemas) ? item.problemas : [];
    const diag = item.diagnostico || {};
    d.innerHTML = `
      <button class="trainingImageOpen"><img src="${p.url}" alt="Foto ${p.id}"><span>Toque para ampliar</span></button>
      <div class="trainingBody">
        <div class="scoreLine"><strong>Foto #${item.foto}</strong><span>${item.nota ?? '?'}/10</span><span class="pill ${categoryClass(item.categoria)}">${normalizeCategory(item.categoria)}</span><span class="confidence">Confiança ${Math.round((item.confianca ?? r.confianca ?? .5) * 100)}%</span></div>
        <p><strong>Opinião da IA:</strong> ${escapeHTML(item.motivo || '')}</p>
        ${comparison ? `<p class="comparisonWhy"><strong>Comparação:</strong> ${escapeHTML(comparison)}</p>` : ''}
        <details class="diagnostic"><summary>Ver diagnóstico detalhado</summary><div class="diagGrid">${Object.entries(diag).map(([k, v]) => `<div><strong>${escapeHTML(k)}</strong><span>${escapeHTML(v)}</span></div>`).join('')}</div>${problems.length ? `<ul>${problems.map((x) => `<li><strong>${escapeHTML(x.area || '')}:</strong> ${escapeHTML(x.problema || '')} · ${escapeHTML(x.gravidade || '')}${x.corrigivel && x.corrigivel !== 'nao' ? ` · corrigível por ${escapeHTML(x.corrigivel)}` : ''}</li>`).join('')}</ul>` : ''}</details>
        ${item.crop_sugerido?.aplicar ? '<button class="ghost cropPreview">✂️ Ver prévia do corte sugerido</button>' : ''}
        <div class="reactionRow"><button data-r="gostei_muito">❤️ Gostei muito</button><button data-r="gostei">👍 Gostei</button><button data-r="neutro">➖ Aceitável</button><button data-r="nao_gostei">👎 Não gostei</button></div>
        <div class="tagSection"><strong>O que pesou para você?</strong><div class="tagButtons">${['reflexo','limpeza','nitidez','posição dos dedos','visibilidade','brilho/exposição','enquadramento'].map((t) => `<button class="tagBtn" data-tag="${t}" data-kind="like">+ ${t}</button><button class="tagBtn negative" data-tag="${t}" data-kind="dislike">− ${t}</button>`).join('')}</div></div>
        <label>Se houver um problema, ele é corrigível?<select class="correctable"><option value="">Não informar</option><option value="crop">Posso corrigir com corte</option><option value="edit">Posso corrigir com edição</option><option value="acceptable">É aceitável sem correção</option><option value="no">Não é aceitável/corrigível</option></select></label>
        <label>Minha avaliação<textarea placeholder="Ex.: Mesmo mais escura, eu gosto porque preserva o brilho. Espaço vazio não me incomoda porque posso cortar."></textarea></label>
        <label class="manualFinalToggle"><input type="checkbox" ${manualFinal.has(item.foto) ? 'checked' : ''}> ⭐ Esta é uma das minhas finais definitivas</label>
        <button class="saveFeedback">Salvar aprendizado</button><span class="savedFeedback muted"></span>
      </div>`;

    d.querySelector('.trainingImageOpen').onclick = () => openViewer(p);
    if (d.querySelector('.cropPreview')) d.querySelector('.cropPreview').onclick = () => openCropPreview(p, item.crop_sugerido);
    let reaction = sessionFeedback[item.foto]?.reacao || '';
    const likedTags = new Set(sessionFeedback[item.foto]?.likedTags || []);
    const dislikedTags = new Set(sessionFeedback[item.foto]?.dislikedTags || []);
    d.querySelectorAll('[data-r]').forEach((b) => {
      if (b.dataset.r === reaction) b.classList.add('chosen');
      b.onclick = () => {
        reaction = b.dataset.r;
        d.querySelectorAll('[data-r]').forEach((x) => x.classList.toggle('chosen', x === b));
        sessionFeedback[item.foto] = { ...(sessionFeedback[item.foto] || {}), reacao: reaction };
        renderGallery(); renderAccuracy(); persistState();
      };
    });
    d.querySelectorAll('.tagBtn').forEach((b) => {
      const set = b.dataset.kind === 'like' ? likedTags : dislikedTags;
      if (set.has(b.dataset.tag)) b.classList.add('chosen');
      b.onclick = () => { set.has(b.dataset.tag) ? set.delete(b.dataset.tag) : set.add(b.dataset.tag); b.classList.toggle('chosen'); };
    });
    d.querySelector('.manualFinalToggle input').onchange = (e) => {
      e.target.checked ? manualFinal.add(item.foto) : manualFinal.delete(item.foto);
      renderGallery(); persistState();
    };
    d.querySelector('.saveFeedback').onclick = async () => {
      const comment = d.querySelector('textarea').value.trim();
      const correctable = d.querySelector('.correctable').value;
      if (!reaction && !comment && !likedTags.size && !dislikedTags.size) {
        d.querySelector('.savedFeedback').textContent = 'Marque uma reação, tags ou escreva um comentário.';
        return;
      }
      const existing = sessionFeedback[item.foto]?.learningId;
      if (existing) profile.examples = profile.examples.filter((x) => x.id !== existing);
      const entry = {
        id: crypto.randomUUID?.() || String(Date.now() + Math.random()),
        createdAt: new Date().toISOString(),
        sessionId: currentSessionId,
        photoFingerprint: p.hash,
        fotoSessao: item.foto,
        reacao: reaction || 'comentario',
        comentario: comment,
        likedTags: [...likedTags],
        dislikedTags: [...dislikedTags],
        correctable,
        opiniaoIA: item.motivo || '',
        problemasIA: problems,
        notaIA: item.nota ?? null,
        categoriaIA: item.categoria || '',
        aiSelected: (lastFinal.selecionadas || []).includes(item.foto),
        manualFinal: manualFinal.has(item.foto),
      };
      profile.examples.push(entry);
      sessionFeedback[item.foto] = { reacao: entry.reacao, comentario: comment, likedTags: [...likedTags], dislikedTags: [...dislikedTags], correctable, learningId: entry.id };
      profile.learnedProfile.source = 'local';
      refreshLocalProfile();
      saveProfile();
      renderGallery(); renderAccuracy();
      d.querySelector('.savedFeedback').textContent = '✓ Salvo e aplicado ao perfil.';
      await persistState();
      await archiveCurrentSession();
    };
    wrap.appendChild(d);
  }));
}

$('showAiBtn').onclick = () => { galleryMode = 'ai'; renderGallery(); };
$('showMineBtn').onclick = () => { galleryMode = 'mine'; renderGallery(); };
$('showManualBtn').onclick = () => { galleryMode = 'manual'; renderGallery(); };

function galleryIds() {
  if (galleryMode === 'mine') return mineIds();
  if (galleryMode === 'manual') return [...manualFinal];
  return lastFinal.selecionadas || [];
}

function renderGallery() {
  const ids = galleryIds();
  const rank = lastFinal.ranking || [];
  const w = $('chosenGallery');
  $('mineCount').textContent = mineIds().length ? `(${mineIds().length})` : '';
  $('manualCount').textContent = manualFinal.size ? `(${manualFinal.size})` : '';
  $('showAiBtn').classList.toggle('chosen', galleryMode === 'ai');
  $('showMineBtn').classList.toggle('chosen', galleryMode === 'mine');
  $('showManualBtn').classList.toggle('chosen', galleryMode === 'manual');
  if (!ids.length) {
    w.innerHTML = `<div class="emptyGallery">${galleryMode === 'mine' ? 'Marque ❤️ ou 👍 para preencher sua escolha.' : galleryMode === 'manual' ? 'Marque ⭐ nas fotos que você quer como finais definitivas.' : 'A IA não retornou fotos selecionadas.'}</div>`;
    return;
  }
  w.innerHTML = `<div class="chosenSummary"><div><strong>${ids.length} foto(s) escolhida(s)</strong><span>Salvar no Fotos cria uma cópia nova sem a data EXIF original.</span></div><button class="saveAllPhotos" disabled>Preparando cópias…</button></div><div class="chosenGrid"></div>`;
  const g = w.querySelector('.chosenGrid');
  ids.forEach((id, i) => {
    const p = photos.find((x) => x.id === id), info = rank.find((x) => x.foto === id) || {};
    if (!p) return;
    const d = document.createElement('div');
    d.className = 'chosenItem';
    d.innerHTML = `<button class="imageOpen"><img src="${p.url}"></button><div class="chosenMeta"><strong>${i + 1}º · Foto #${id}</strong>${galleryMode === 'ai' ? `<span>${info.nota_final ?? '?'}/10</span><p>${escapeHTML(info.motivo || '')}</p>` : ''}<button class="saveToPhotos" data-save-photo="${id}" disabled>Preparando…</button><a class="downloadOriginal" href="${p.url}" download="${escapeHTML(p.file.name || `foto-${id}`)}">Baixar original</a></div>`;
    d.querySelector('.imageOpen').onclick = () => openViewer(p);
    g.appendChild(d);
  });
  prepareFreshForGallery(ids, w);
}

function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function makeFreshFile(p) {
  if (freshCache.has(p.id)) return freshCache.get(p.id);
  if (freshPreparing.has(p.id)) return freshPreparing.get(p.id);
  const job = (async () => {
    const d = await loadDrawable(p.file);
    const c = document.createElement('canvas');
    c.width = d.width; c.height = d.height;
    c.getContext('2d').drawImage(d.source, 0, 0);
    d.close();
    const blob = await new Promise((resolve, reject) => c.toBlob((x) => x ? resolve(x) : reject(new Error('Não foi possível criar a cópia.')), 'image/jpeg', .98));
    const file = new File([blob], `Selecionada_${stamp()}_foto-${p.id}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    freshCache.set(p.id, file);
    freshPreparing.delete(p.id);
    return file;
  })().catch((e) => { freshPreparing.delete(p.id); throw e; });
  freshPreparing.set(p.id, job);
  return job;
}

function canShare(files) {
  try { return !!(navigator.share && (!navigator.canShare || navigator.canShare({ files }))); }
  catch { return false; }
}

function shareFresh(file, id) {
  if (canShare([file])) navigator.share({ files: [file] }).catch((e) => { if (e?.name !== 'AbortError') openFreshViewer(file, id); });
  else openFreshViewer(file, id);
}

function shareFreshBatch(files, ids) {
  if (canShare(files)) navigator.share({ files }).catch((e) => { if (e?.name !== 'AbortError') openFreshViewer(files[0], ids[0]); });
  else openFreshViewer(files[0], ids[0]);
}

async function prepareFreshForGallery(ids, w) {
  const batch = w.querySelector('.saveAllPhotos');
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i], p = photos.find((x) => x.id === id), btn = w.querySelector(`[data-save-photo="${id}"]`);
    if (!p || !btn) continue;
    try {
      await makeFreshFile(p);
      btn.disabled = false; btn.textContent = 'Salvar no Fotos'; btn.onclick = () => shareFresh(freshCache.get(id), id);
    } catch { btn.disabled = false; btn.textContent = 'Abrir original'; btn.onclick = () => openViewer(p); }
    if (batch) batch.textContent = `Preparando ${i + 1}/${ids.length}…`;
  }
  if (batch) {
    batch.disabled = false;
    batch.textContent = `Salvar todas no Fotos (${ids.length})`;
    batch.onclick = () => shareFreshBatch(ids.map((id) => freshCache.get(id)).filter(Boolean), ids);
  }
}

function openViewer(p) {
  const o = document.createElement('div');
  o.className = 'viewer';
  o.innerHTML = `<div class="viewerTop"><strong>Foto #${p.id}</strong><button class="ghost viewerClose">Fechar</button></div><img src="${p.url}"><div class="viewerHint">Visualização em tamanho grande para avaliar detalhes.</div>`;
  o.querySelector('.viewerClose').onclick = () => o.remove();
  o.onclick = (e) => { if (e.target === o) o.remove(); };
  document.body.appendChild(o);
}

function openFreshViewer(file, id) {
  const url = URL.createObjectURL(file), o = document.createElement('div');
  o.className = 'viewer';
  o.innerHTML = `<div class="viewerTop"><strong>Foto #${id} · cópia nova</strong><button class="ghost viewerClose">Fechar</button></div><img src="${url}"><div class="viewerHint">Toque e segure a imagem se precisar usar “Salvar Imagem”.</div><a class="fileButton" href="${url}" download="${file.name}">Baixar esta cópia</a>`;
  const close = () => { URL.revokeObjectURL(url); o.remove(); };
  o.querySelector('.viewerClose').onclick = close;
  document.body.appendChild(o);
}

async function openCropPreview(p, crop = {}) {
  try {
    const d = await loadDrawable(p.file);
    const top = Math.max(0, Math.min(35, Number(crop.top) || 0)) / 100;
    const right = Math.max(0, Math.min(35, Number(crop.right) || 0)) / 100;
    const bottom = Math.max(0, Math.min(35, Number(crop.bottom) || 0)) / 100;
    const left = Math.max(0, Math.min(35, Number(crop.left) || 0)) / 100;
    const sx = d.width * left, sy = d.height * top;
    const sw = d.width * (1 - left - right), sh = d.height * (1 - top - bottom);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh));
    c.getContext('2d').drawImage(d.source, sx, sy, sw, sh, 0, 0, c.width, c.height);
    d.close();
    const url = c.toDataURL('image/jpeg', .92);
    const o = document.createElement('div');
    o.className = 'viewer';
    o.innerHTML = `<div class="viewerTop"><strong>Prévia de corte · Foto #${p.id}</strong><button class="ghost viewerClose">Fechar</button></div><img src="${url}"><div class="viewerHint">É apenas uma prévia; o original não foi alterado.</div>`;
    o.querySelector('.viewerClose').onclick = () => o.remove();
    document.body.appendChild(o);
  } catch (e) { alert(e.message); }
}

async function archiveCurrentSession() {
  if (!photos.length || (!lastResults.length && !lastFinal.selecionadas?.length)) return;
  const agreement = calculateCurrentAgreement();
  const selectedIds = [...new Set([...(lastFinal.selecionadas || []), ...mineIds(), ...manualFinal])];
  const entry = {
    id: currentSessionId,
    name: currentSessionName || `Ensaio ${new Date().toLocaleDateString('pt-BR')}`,
    date: new Date().toISOString(),
    photoCount: photos.length,
    selectedCount: selectedIds.length,
    aiSelected: lastFinal.selecionadas || [],
    mineSelected: mineIds(),
    manualSelected: [...manualFinal],
    agreement,
    costBrl: moneyFromTokens(usageTotals.input_tokens || 0, usageTotals.output_tokens || 0).brl,
  };
  history = [entry, ...history.filter((x) => x.id !== entry.id)].slice(0, MAX_HISTORY);
  saveHistory();
  const selectedFiles = selectedIds.map((id) => photos.find((p) => p.id === id)?.file).filter(Boolean);
  if (selectedFiles.length) await dbSet(`archive:${entry.id}`, { files: selectedFiles, originalIds: selectedIds });
}

function renderHistory() {
  const wrap = $('historyList');
  if (!wrap) return;
  wrap.innerHTML = history.length ? history.map((h) => `<div class="historyRow"><div><strong>${escapeHTML(h.name)}</strong><span>${formatDate(h.date)} · ${h.photoCount} fotos · ${h.selectedCount} escolhidas${Number.isFinite(h.agreement) ? ` · ${h.agreement}% concordância` : ''}${Number.isFinite(h.costBrl) ? ` · ~R$ ${h.costBrl.toFixed(2)}` : ''}</span></div><button class="ghost small openHistory" data-id="${h.id}">Abrir escolhidas</button></div>`).join('') : '<div class="muted">Nenhum ensaio arquivado ainda.</div>';
  wrap.querySelectorAll('.openHistory').forEach((b) => b.onclick = () => openHistory(b.dataset.id));
}

async function openHistory(id) {
  const archive = await dbGet(`archive:${id}`);
  if (!archive?.files?.length) return alert('As imagens deste histórico não estão mais armazenadas neste aparelho. O resumo do ensaio continua salvo.');
  const o = document.createElement('div');
  o.className = 'viewer historyViewer';
  const urls = archive.files.map((f) => URL.createObjectURL(f));
  o.innerHTML = `<div class="viewerTop"><strong>Escolhidas do ensaio</strong><button class="ghost viewerClose">Fechar</button></div><div class="historyImages">${urls.map((u) => `<img src="${u}">`).join('')}</div>`;
  const close = () => { urls.forEach(URL.revokeObjectURL); o.remove(); };
  o.querySelector('.viewerClose').onclick = close;
  document.body.appendChild(o);
}

$('clearHistoryBtn').onclick = async () => {
  if (!confirm('Apagar o histórico de ensaios deste aparelho?')) return;
  const old = [...history]; history = []; saveHistory();
  for (const h of old) await dbDelete(`archive:${h.id}`);
};

setupConfigUI();
refreshLocalProfile();
renderHistory();
updateCostEstimate();
updateRestoreCard();

if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));