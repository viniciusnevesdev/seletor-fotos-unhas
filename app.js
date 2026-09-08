const $ = (id) => document.getElementById(id);

let photos = [];
let groups = [];

const STORAGE_KEY = "seletor-unhas-preferencias-v04";
const defaultPrefs = {
  uiScale: 92,
  threshold: 22,
  weights: {
    reflexo: 5,
    limpeza: 5,
    nitidez: 4,
    pose: 4,
    visibilidade: 4,
    enquadramento: 2,
    exposicao: 2,
  },
  toggles: {
    glitterIntentional: true,
    emptySpaceLowImportance: true,
    reflectionOnlyIfHides: true,
  },
};

function loadPrefs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return {
      ...defaultPrefs,
      ...saved,
      weights: { ...defaultPrefs.weights, ...(saved.weights || {}) },
      toggles: { ...defaultPrefs.toggles, ...(saved.toggles || {}) },
    };
  } catch {
    return JSON.parse(JSON.stringify(defaultPrefs));
  }
}

let prefs = loadPrefs();

function savePrefs() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}

function applyUIScale() {
  document.documentElement.style.setProperty("--ui-scale", (prefs.uiScale / 100).toFixed(2));
  $("uiScale").value = prefs.uiScale;
  $("uiScaleValue").textContent = `${prefs.uiScale}%`;
}

function syncPrefUI() {
  $("threshold").value = prefs.threshold;
  $("thresholdValue").textContent = prefs.threshold;
  for (const [k, v] of Object.entries(prefs.weights)) {
    const el = document.querySelector(`.prefSlider[data-pref="${k}"]`);
    if (el) el.value = v;
    const out = $("pref-" + k);
    if (out) out.textContent = v;
  }
  $("glitterIntentional").checked = prefs.toggles.glitterIntentional;
  $("emptySpaceLowImportance").checked = prefs.toggles.emptySpaceLowImportance;
  $("reflectionOnlyIfHides").checked = prefs.toggles.reflectionOnlyIfHides;
  applyUIScale();
}

$("uiScale").addEventListener("input", (e) => {
  prefs.uiScale = Number(e.target.value);
  applyUIScale();
  savePrefs();
});

$("threshold").addEventListener("input", (e) => {
  prefs.threshold = Number(e.target.value);
  $("thresholdValue").textContent = prefs.threshold;
  savePrefs();
});

document.querySelectorAll(".prefSlider").forEach((el) => {
  el.addEventListener("input", (e) => {
    const key = e.target.dataset.pref;
    prefs.weights[key] = Number(e.target.value);
    $("pref-" + key).textContent = prefs.weights[key];
    savePrefs();
  });
});

$("glitterIntentional").addEventListener("change", (e) => { prefs.toggles.glitterIntentional = e.target.checked; savePrefs(); });
$("emptySpaceLowImportance").addEventListener("change", (e) => { prefs.toggles.emptySpaceLowImportance = e.target.checked; savePrefs(); });
$("reflectionOnlyIfHides").addEventListener("change", (e) => { prefs.toggles.reflectionOnlyIfHides = e.target.checked; savePrefs(); });

$("photoInput").addEventListener("change", (e) => {
  resetTransient();
  const files = [...e.target.files].filter(f => f.type.startsWith("image/")).slice(0, 60);
  photos = files.map((file, i) => ({ id: i + 1, file, url: URL.createObjectURL(file), hash: null, quality: null }));
  $("selectionInfo").textContent = `${photos.length} foto(s) selecionada(s).`;
  $("groupBtn").disabled = photos.length < 2;
});

$("resetBtn").addEventListener("click", () => location.reload());

function resetTransient() {
  groups = [];
  $("groupStatus").textContent = "";
  $("aiStatus").textContent = "";
  $("groups").innerHTML = "";
  $("results").innerHTML = "";
  $("groupsSection").classList.add("hidden");
  $("aiSection").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
}

async function analyzeLocal(photo) {
  const bmp = await createImageBitmap(photo.file);

  const c = document.createElement("canvas");
  c.width = 9; c.height = 8;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, 9, 8);
  const px = ctx.getImageData(0, 0, 9, 8).data;
  const gray = [];
  for (let i = 0; i < px.length; i += 4) gray.push(px[i] * .299 + px[i+1] * .587 + px[i+2] * .114);
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y*9 + x] > gray[y*9 + x + 1] ? "1" : "0";

  const qc = document.createElement("canvas");
  qc.width = 256;
  qc.height = Math.max(1, Math.round(256 * bmp.height / bmp.width));
  const qctx = qc.getContext("2d", { willReadFrequently: true });
  qctx.drawImage(bmp, 0, 0, qc.width, qc.height);
  const q = qctx.getImageData(0,0,qc.width,qc.height).data;
  let edge = 0, n = 0;
  const W = qc.width, H = qc.height;
  const lum = (x, y) => { const i = (y * W + x) * 4; return q[i]*.299 + q[i+1]*.587 + q[i+2]*.114; };
  for (let y = 1; y < H - 1; y += 3) {
    for (let x = 1; x < W - 1; x += 3) {
      edge += Math.abs(lum(x+1,y) - lum(x-1,y)) + Math.abs(lum(x,y+1) - lum(x,y-1));
      n++;
    }
  }
  bmp.close();
  photo.hash = bits;
  photo.quality = n ? edge / n : 0;
}

function hamming(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

function makeGroups(items, threshold) {
  const result = [];
  for (const photo of items) {
    let best = null, bestD = Infinity;
    for (const g of result) {
      const d = hamming(photo.hash, g.representative.hash);
      if (d < bestD) { bestD = d; best = g; }
    }
    if (best && bestD <= threshold) {
      best.items.push(photo);
      if (photo.quality > best.representative.quality) best.representative = photo;
    } else {
      result.push({ representative: photo, items: [photo] });
    }
  }
  return result.sort((a,b) => b.items.length - a.items.length);
}

function chooseCandidates(items, maxN) {
  if (items.length <= maxN) return [...items].sort((a,b) => b.quality - a.quality);
  const sorted = [...items].sort((a,b) => b.quality - a.quality);
  const chosen = [sorted[0]];
  const remaining = sorted.slice(1);
  while (chosen.length < maxN && remaining.length) {
    let bestIndex = 0, bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      const diversity = Math.min(...chosen.map(c => hamming(p.hash, c.hash)));
      const sharp = p.quality / (sorted[0].quality || 1);
      const score = diversity * 1.35 + sharp * 8;
      if (score > bestScore) { bestScore = score; bestIndex = i; }
    }
    chosen.push(remaining.splice(bestIndex, 1)[0]);
  }
  return chosen;
}

$("groupBtn").addEventListener("click", async () => {
  $("groupBtn").disabled = true;
  resetTransient();
  try {
    for (let i = 0; i < photos.length; i++) {
      $("groupStatus").textContent = `Analisando localmente ${i+1}/${photos.length}…`;
      await analyzeLocal(photos[i]);
      await new Promise(r => setTimeout(r, 0));
    }
    groups = makeGroups(photos, prefs.threshold);
    renderGroups();
    $("groupStatus").textContent = `${groups.length} grupo(s) criado(s). Nenhuma foto foi enviada para a internet.`;
    $("groupsSection").classList.remove("hidden");
    $("aiSection").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    $("groupStatus").textContent = "Falha ao agrupar as fotos.";
  } finally {
    $("groupBtn").disabled = false;
  }
});

function renderGroups() {
  const wrap = $("groups");
  wrap.innerHTML = "";
  groups.forEach((g, index) => {
    const candidates = chooseCandidates(g.items, Math.min(4, g.items.length));
    const candidateIds = new Set(candidates.map(p => p.id));
    const article = document.createElement("article");
    article.className = "group";
    article.innerHTML = `
      <div class="groupHeader">
        <div class="groupTitle">Grupo ${index + 1} · ${g.items.length} foto(s)</div>
        <div class="candidateInfo">${g.items.length === 1 ? "Foto única · será avaliada normalmente" : `${candidates.length} candidatas automáticas → IA`}</div>
      </div>
    `;
    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";
    [...g.items].sort((a,b) => a.id - b.id).forEach((p) => {
      const t = document.createElement("div");
      t.className = "thumb";
      t.innerHTML = `<img src="${p.url}" alt="Foto ${p.id}"><span class="badge">#${p.id}</span>${candidateIds.has(p.id) ? '<span class="autoBadge">AVALIAR</span>' : ''}`;
      thumbs.appendChild(t);
    });
    article.appendChild(thumbs);
    wrap.appendChild(article);
  });
}

async function fileToDataURL(file, maxDim = 1600, quality = .86) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return c.toDataURL("image/jpeg", quality);
}

function profileText() {
  const w = prefs.weights;
  const t = prefs.toggles;
  return [
    `Pesos do usuário (0 a 5): reflexo ${w.reflexo}, limpeza ${w.limpeza}, nitidez ${w.nitidez}, pose ${w.pose}, visibilidade ${w.visibilidade}, enquadramento ${w.enquadramento}, exposição ${w.exposicao}.`,
    t.glitterIntentional ? "Glitter, cromado e brilhos metálicos intensos podem ser intencionais; não trate isso automaticamente como flash forte ou defeito." : "Brilhos muito fortes podem ser penalizados normalmente.",
    t.emptySpaceLowImportance ? "Espaço vazio e enquadramento têm peso baixo, salvo quando realmente prejudicam a leitura ou a apresentação." : "Enquadramento e espaço vazio devem ser julgados normalmente.",
    t.reflectionOnlyIfHides ? "Reflexos fortes só são problema se esconderem detalhes, estourarem áreas relevantes ou deformarem a leitura do acabamento." : "Reflexos fortes podem ser penalizados normalmente.",
  ].join(" ");
}

function buildGroupPrompt(groupNumber, photoIds) {
  return `Você está avaliando fotografia profissional de unhas. Compare SOMENTE as fotos do grupo ${groupNumber}: ${photoIds.map(id => "#" + id).join(", ")}. ${profileText()} Julgue cada foto por qualidade absoluta e também relativa ao grupo. Diferenças pequenas importam. Não invente defeitos invisíveis. Sempre devolva ranking completo, mesmo quando nenhuma foto for excelente. Não use reprovação rígida. Em vez disso, classifique cada foto em uma destas categorias: "forte candidata", "boa candidata", "aceitável" ou "fraca". Responda SOMENTE em JSON válido, sem markdown, exatamente neste formato: {"grupo":${groupNumber},"ranking":[{"foto":0,"nota":0.0,"categoria":"forte candidata","reflexo":0.0,"limpeza":0.0,"nitidez":0.0,"pose":0.0,"apresentacao":0.0,"motivo":"curto e específico","problemas":["..."]}],"vencedora":0,"confianca":0.0}.`;
}

async function callOpenAI(apiKey, model, prompt, selected, max_output_tokens = 1800) {
  const content = [{ type: "input_text", text: prompt }];
  for (const p of selected) {
    content.push({ type: "input_text", text: `Foto #${p.id}` });
    content.push({ type: "input_image", image_url: await fileToDataURL(p.file), detail: "high" });
  }

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify({ model, input: [{ role: "user", content }], max_output_tokens })
  });
  if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 400)}`);
  const data = await resp.json();
  const text = data.output_text || (data.output || []).flatMap(x => x.content || []).map(c => c.text || "").join("");
  return parseMaybeJSON(text);
}

function parseMaybeJSON(text) {
  try { return JSON.parse(text); } catch {}
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```/, "").replace(/```$/i, "").trim();
  try { return JSON.parse(cleaned); } catch {}
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first >= 0 && last > first) return JSON.parse(cleaned.slice(first, last + 1));
  throw new Error("A resposta da IA não veio em JSON válido.");
}

function normalizeCategory(value) {
  const s = String(value || "").toLowerCase();
  if (s.includes("forte")) return "forte candidata";
  if (s.includes("boa")) return "boa candidata";
  if (s.includes("aceit")) return "aceitável";
  return "fraca";
}

function survivorsFromGroupResult(groupResult, selectedPhotos) {
  const selectedById = new Map(selectedPhotos.map(p => [p.id, p]));
  const ranked = (groupResult.ranking || []).map(item => ({ ...item, categoria: normalizeCategory(item.categoria) }));
  const survivors = [];

  ranked.forEach((item, idx) => {
    const p = selectedById.get(item.foto);
    if (!p) return;
    const note = Number(item.nota || 0);
    if (idx === 0) survivors.push(p);
    else if (item.categoria !== "fraca" && note >= 6.3 && survivors.length < 2) survivors.push(p);
  });

  return [...new Map(survivors.map(p => [p.id, p])).values()];
}

function buildFinalPrompt(photoIds, finalCount) {
  return `Estas fotos já são as melhores sobreviventes dos grupos de um ensaio de unhas: ${photoIds.map(id => "#" + id).join(", ")}. ${profileText()} Faça a SELEÇÃO FINAL do ensaio. Não preserve uma foto só por ser diferente; elimine fotos redundantes ou inferiores. Escolha no máximo ${finalCount} foto(s), apenas as que realmente merecem ficar na seleção final. Sempre gere ranking das analisadas, do melhor para o pior. Responda SOMENTE em JSON válido, sem markdown, neste formato: {"ranking":[{"foto":0,"nota_final":0.0,"categoria_final":"selecionada ou reserva","motivo":"curto e específico"}],"selecionadas":[0]}.`;
}

$("analyzeBtn").addEventListener("click", async () => {
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) {
    $("aiStatus").textContent = "Cole sua chave da API primeiro.";
    return;
  }

  const model = $("model").value;
  const maxN = Number($("maxPerGroup").value);
  const finalCount = Number($("finalCount").value);
  const results = [];
  let survivors = [];

  $("analyzeBtn").disabled = true;
  $("results").innerHTML = "";
  $("resultsSection").classList.add("hidden");

  try {
    for (let gi = 0; gi < groups.length; gi++) {
      const selected = chooseCandidates(groups[gi].items, Math.min(maxN, groups[gi].items.length));
      $("aiStatus").textContent = `Avaliando grupo ${gi + 1}/${groups.length}…`;
      const result = await callOpenAI(apiKey, model, buildGroupPrompt(gi + 1, selected.map(p => p.id)), selected);
      result.ranking = (result.ranking || []).map(item => ({ ...item, categoria: normalizeCategory(item.categoria) }));
      results.push(result);
      survivors.push(...survivorsFromGroupResult(result, selected));
    }

    survivors = [...new Map(survivors.map(p => [p.id, p])).values()];
    if (!survivors.length) {
      const fallback = results.map((r) => {
        const topId = r.vencedora ?? r.ranking?.[0]?.foto;
        return photos.find(p => p.id === topId);
      }).filter(Boolean);
      survivors = [...new Map(fallback.map(p => [p.id, p])).values()];
    }

    $("aiStatus").textContent = `Fazendo seleção final entre ${survivors.length} sobrevivente(s)…`;
    const final = await callOpenAI(apiKey, model, buildFinalPrompt(survivors.map(p => p.id), finalCount), survivors, 1800);
    renderResults(results, final);
    $("aiStatus").textContent = "Análise concluída.";
    $("resultsSection").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    $("aiStatus").textContent = "Erro na API: " + err.message;
  } finally {
    $("analyzeBtn").disabled = false;
  }
});

function categoryClass(cat) {
  const c = normalizeCategory(cat);
  if (c === "forte candidata") return "forte";
  if (c === "boa candidata") return "boa";
  if (c === "aceitável") return "aceitavel";
  return "fraca";
}

function renderResults(results, final) {
  const wrap = $("results");
  const selectedIds = final.selecionadas || [];
  const finalRanking = final.ranking || [];

  wrap.innerHTML = `
    <div class="finalBox">
      <h3>Seleção final</h3>
      <p class="hint">Estas são as fotos que a IA considerou mais fortes no conjunto final, usando a sua régua de preferências.</p>
      <div class="finalThumbs"></div>
    </div>
    <h3 class="detailsTitle">Detalhes por grupo</h3>
  `;

  const finalThumbs = wrap.querySelector(".finalThumbs");
  if (!selectedIds.length) {
    finalThumbs.innerHTML = `<p>Nenhuma foto foi marcada como seleção final. Veja abaixo o ranking por grupo para entender o motivo.</p>`;
  } else {
    selectedIds.forEach((id, index) => {
      const photo = photos.find(p => p.id === id);
      const info = finalRanking.find(item => item.foto === id) || {};
      if (!photo) return;
      const item = document.createElement("div");
      item.className = "finalItem";
      item.innerHTML = `
        <img src="${photo.url}" alt="Foto ${id}">
        <div class="finalMeta">
          <strong>${index + 1}º · Foto #${id}</strong>
          <span>${info.nota_final ?? "?"}/10 · ${info.categoria_final || "selecionada"}</span>
          <p>${info.motivo || ""}</p>
        </div>
      `;
      finalThumbs.appendChild(item);
    });
  }

  results.forEach((r) => {
    const box = document.createElement("div");
    box.className = "resultGroup";
    box.innerHTML = `<h4>Grupo ${r.grupo}</h4>`;

    (r.ranking || []).forEach((item) => {
      const div = document.createElement("div");
      div.className = "resultItem";
      const cat = normalizeCategory(item.categoria);
      div.innerHTML = `
        <div class="scoreLine">
          <strong>Foto #${item.foto}</strong>
          <span>${item.nota ?? "?"}/10</span>
          <span class="pill ${categoryClass(cat)}">${cat}</span>
        </div>
        <div>${item.motivo || ""}</div>
        ${(item.problemas || []).length ? `<div class="hint">${item.problemas.join("; ")}</div>` : ""}
      `;
      box.appendChild(div);
    });

    wrap.appendChild(box);
  });
}

syncPrefUI();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
