const $ = (id) => document.getElementById(id);

let photos = [];
let groups = [];

$("threshold").addEventListener("input", e => $("thresholdValue").textContent = e.target.value);
$("photoInput").addEventListener("change", async (e) => {
  cleanup();
  const files = [...e.target.files].filter(f => f.type.startsWith("image/")).slice(0, 60);
  photos = files.map((file, i) => ({
    id: i + 1,
    file,
    url: URL.createObjectURL(file),
    hash: null,
    quality: null
  }));
  $("selectionInfo").textContent = `${photos.length} foto(s) selecionada(s).`;
  $("groupBtn").disabled = photos.length < 2;
});

$("resetBtn").addEventListener("click", () => {
  photos.forEach(p => URL.revokeObjectURL(p.url));
  photos = [];
  groups = [];
  $("photoInput").value = "";
  $("selectionInfo").textContent = "";
  $("groupStatus").textContent = "";
  $("aiStatus").textContent = "";
  $("groups").innerHTML = "";
  $("results").innerHTML = "";
  $("groupsSection").classList.add("hidden");
  $("aiSection").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
  $("groupBtn").disabled = true;
});

function cleanup() {
  photos.forEach(p => p.url && URL.revokeObjectURL(p.url));
  groups = [];
  $("groups").innerHTML = "";
  $("results").innerHTML = "";
  $("groupsSection").classList.add("hidden");
  $("aiSection").classList.add("hidden");
  $("resultsSection").classList.add("hidden");
}

async function imageBitmapFromFile(file) {
  return await createImageBitmap(file);
}

async function analyzeLocal(photo) {
  const bmp = await imageBitmapFromFile(photo.file);
  const c = document.createElement("canvas");
  c.width = 9; c.height = 8;
  const ctx = c.getContext("2d", {willReadFrequently:true});
  ctx.drawImage(bmp, 0, 0, 9, 8);
  const px = ctx.getImageData(0,0,9,8).data;
  const gray = [];
  for (let i=0;i<px.length;i+=4) gray.push(px[i]*.299 + px[i+1]*.587 + px[i+2]*.114);
  let bits = "";
  for (let y=0;y<8;y++) {
    for (let x=0;x<8;x++) {
      bits += gray[y*9+x] > gray[y*9+x+1] ? "1" : "0";
    }
  }

  const qc = document.createElement("canvas");
  qc.width = 256;
  qc.height = Math.max(1, Math.round(256 * bmp.height / bmp.width));
  const qctx = qc.getContext("2d", {willReadFrequently:true});
  qctx.drawImage(bmp,0,0,qc.width,qc.height);
  const q = qctx.getImageData(0,0,qc.width,qc.height).data;
  let edge = 0, n = 0;
  const W = qc.width, H = qc.height;
  const lum = (x,y) => {
    const i=(y*W+x)*4; return q[i]*.299+q[i+1]*.587+q[i+2]*.114;
  };
  for(let y=1;y<H-1;y+=3){
    for(let x=1;x<W-1;x+=3){
      edge += Math.abs(lum(x+1,y)-lum(x-1,y)) + Math.abs(lum(x,y+1)-lum(x,y-1));
      n++;
    }
  }
  bmp.close();
  photo.hash = bits;
  photo.quality = n ? edge/n : 0;
}

function hamming(a,b) {
  let d=0;
  for(let i=0;i<a.length;i++) if(a[i]!==b[i]) d++;
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
      result.push({ representative: photo, items:[photo] });
    }
  }
  return result.sort((a,b)=>b.items.length-a.items.length);
}

$("groupBtn").addEventListener("click", async () => {
  $("groupBtn").disabled = true;
  $("groupStatus").textContent = "Analisando as fotos localmente…";
  try {
    for (let i=0;i<photos.length;i++) {
      $("groupStatus").textContent = `Analisando localmente ${i+1}/${photos.length}…`;
      await analyzeLocal(photos[i]);
      await new Promise(r => setTimeout(r, 0));
    }
    groups = makeGroups(photos, Number($("threshold").value));
    renderGroups();
    $("groupStatus").textContent = `${groups.length} grupo(s) criado(s). Nenhuma foto foi enviada para a internet nesta etapa.`;
    $("groupsSection").classList.remove("hidden");
    $("aiSection").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    $("groupStatus").textContent = "Falha ao processar alguma foto. Tente novamente com menos imagens.";
  } finally {
    $("groupBtn").disabled = false;
  }
});

function renderGroups() {
  const wrap = $("groups");
  wrap.innerHTML = "";
  groups.forEach((g, gi) => {
    const article = document.createElement("article");
    article.className = "group";
    const title = document.createElement("div");
    title.className = "groupTitle";
    title.textContent = `Grupo ${gi+1} — ${g.items.length} foto(s)`;
    article.appendChild(title);

    const thumbs = document.createElement("div");
    thumbs.className = "thumbs";

    const sorted = [...g.items].sort((a,b)=>b.quality-a.quality);
    const defaultCount = Math.min(4, sorted.length);
    sorted.forEach((p, idx) => {
      p.aiSelected = idx < defaultCount;
      const t = document.createElement("div");
      t.className = "thumb" + (p.aiSelected ? " selected" : "");
      t.innerHTML = `<img src="${p.url}" alt="Foto ${p.id}"><span class="badge">#${p.id}</span><span class="pick">${p.aiSelected ? "✓" : ""}</span>`;
      t.addEventListener("click", () => {
        p.aiSelected = !p.aiSelected;
        t.classList.toggle("selected", p.aiSelected);
        t.querySelector(".pick").textContent = p.aiSelected ? "✓" : "";
      });
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
  c.getContext("2d").drawImage(bmp,0,0,w,h);
  bmp.close();
  return c.toDataURL("image/jpeg", quality);
}

function buildPrompt(groupNumber, photoIds) {
  return `Você é um avaliador extremamente criterioso de fotografia profissional de unhas.
Compare SOMENTE as fotos deste grupo e faça ranking da melhor para a pior.

Fotos e IDs: ${photoIds.map(id=>"#"+id).join(", ")}.

Avalie principalmente:
1. nitidez/foco das unhas;
2. reflexos: contínuos, elegantes, não deformados e não estourados;
3. partículas de pó/lixamento, sujeira ou pequenos resíduos visíveis (penalize);
4. acabamento visual e limpeza da superfície;
5. posição natural/elegante da mão e dos dedos;
6. visibilidade equilibrada das unhas;
7. enquadramento e perspectiva;
8. exposição, sombras e distrações;
9. apresentação profissional geral.

Não invente defeitos invisíveis. Se um detalhe não puder ser confirmado, diga que é incerto.
Diferenças pequenas importam.

Responda SOMENTE em JSON válido, sem markdown:
{
  "grupo": ${groupNumber},
  "ranking": [
    {
      "foto": 0,
      "nota": 0.0,
      "reflexo": 0.0,
      "limpeza": 0.0,
      "nitidez": 0.0,
      "pose": 0.0,
      "apresentacao": 0.0,
      "motivo": "curto e específico",
      "problemas": ["..."]
    }
  ],
  "vencedora": 0,
  "confianca": 0.0
}`;
}

async function callOpenAI(apiKey, model, groupNumber, selected) {
  const content = [{ type:"input_text", text: buildPrompt(groupNumber, selected.map(p=>p.id)) }];
  for (const p of selected) {
    const dataUrl = await fileToDataURL(p.file);
    content.push({ type:"input_text", text:`Foto #${p.id}` });
    content.push({ type:"input_image", image_url:dataUrl, detail:"high" });
  }

  const resp = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Authorization":`Bearer ${apiKey}`
    },
    body:JSON.stringify({
      model,
      input:[{ role:"user", content }],
      max_output_tokens:1800
    })
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`${resp.status}: ${txt.slice(0,400)}`);
  }
  const data = await resp.json();
  const text = data.output_text || (data.output||[]).flatMap(x=>x.content||[]).map(c=>c.text||"").join("");
  return JSON.parse(text);
}

$("analyzeBtn").addEventListener("click", async () => {
  const apiKey = $("apiKey").value.trim();
  if (!apiKey) {
    $("aiStatus").textContent = "Cole sua chave da API primeiro.";
    return;
  }
  const model = $("model").value;
  const maxN = Number($("maxPerGroup").value);
  const results = [];
  $("analyzeBtn").disabled = true;
  $("results").innerHTML = "";
  $("resultsSection").classList.add("hidden");

  try {
    for (let gi=0; gi<groups.length; gi++) {
      let selected = groups[gi].items.filter(p=>p.aiSelected);
      if (!selected.length) selected = [...groups[gi].items].sort((a,b)=>b.quality-a.quality).slice(0,maxN);
      selected = selected.slice(0,maxN);

      if (selected.length === 1) {
        results.push({
          grupo:gi+1,
          ranking:[{foto:selected[0].id,nota:10,motivo:"Única candidata do grupo.",problemas:[]}],
          vencedora:selected[0].id,
          confianca:1
        });
        continue;
      }

      $("aiStatus").textContent = `IA analisando grupo ${gi+1}/${groups.length} (${selected.length} fotos)…`;
      const r = await callOpenAI(apiKey, model, gi+1, selected);
      results.push(r);
    }
    renderResults(results);
    $("aiStatus").textContent = "Análise concluída.";
    $("resultsSection").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    $("aiStatus").textContent = "Erro na API: " + err.message;
  } finally {
    $("analyzeBtn").disabled = false;
  }
});

function renderResults(results) {
  const wrap = $("results");
  wrap.innerHTML = "";
  results.forEach(r => {
    const box = document.createElement("div");
    box.className = "resultGroup";
    const winner = photos.find(p=>p.id===r.vencedora);
    box.innerHTML = `<h3>Grupo ${r.grupo} — vencedora #${r.vencedora}</h3>`;
    if (winner) {
      const img = document.createElement("img");
      img.src = winner.url;
      img.alt = `Vencedora ${r.vencedora}`;
      img.style.cssText = "width:160px;max-width:100%;border-radius:12px;display:block;margin:8px 0 12px";
      box.appendChild(img);
    }
    (r.ranking||[]).forEach(item => {
      const div = document.createElement("div");
      div.className = "resultItem";
      const probs = (item.problemas||[]).length ? `<div class="hint">Problemas: ${(item.problemas||[]).join("; ")}</div>` : "";
      div.innerHTML = `<div><strong>Foto #${item.foto}</strong> <span class="score">— ${item.nota ?? "?"}/10</span></div>
        <div>${item.motivo || ""}</div>${probs}`;
      box.appendChild(div);
    });
    wrap.appendChild(box);
  });
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(()=>{}));
}
