// Ajustes finais da v1.0: faz o treino A/B influenciar a IA de verdade,
// registra escolhas finais no histórico, evita custo silencioso ao refinar
// o perfil e evita contar a sessão atual duas vezes na métrica de acerto.
(function(){
  if (typeof savePairChoice === 'function') {
    const originalSavePairChoice = savePairChoice;
    savePairChoice = function(choice) {
      const before = profile.pairwise?.length || 0;
      originalSavePairChoice(choice);
      if ((profile.pairwise?.length || 0) > before) {
        const entry = profile.pairwise[profile.pairwise.length - 1];
        entry.sessionId = currentSessionId;
        entry.sessionName = currentSessionName || '';
        saveProfile();
      }
    };
  }

  if (typeof learnedText === 'function') {
    const originalLearnedText = learnedText;
    learnedText = function() {
      const base = originalLearnedText();
      const pairs = (profile.pairwise || []).slice(-20);
      const current = pairs.filter(x => x.sessionId === currentSessionId && x.aSessionPhoto && x.bSessionPhoto).slice(-8).map(x => {
        const pref = x.preferred === 'a' ? `#${x.aSessionPhoto}` : x.preferred === 'b' ? `#${x.bSessionPhoto}` : x.preferred === 'tie' ? 'quase iguais' : 'nenhuma';
        return `Nesta sessão, entre #${x.aSessionPhoto} e #${x.bSessionPhoto}, o usuário escolheu ${pref}${x.comment ? `; motivo: ${x.comment}` : ''}.`;
      });
      const historical = pairs.filter(x => x.comment && x.sessionId !== currentSessionId).slice(-8).map(x => `Comparação A/B anterior: escolha=${x.preferred}; motivo do usuário=${x.comment}.`);
      const extra = [...current, ...historical];
      return extra.length ? `${base}\nCOMPARAÇÕES A/B DO USUÁRIO:\n${extra.join('\n')}` : base;
    };
  }

  if (typeof buildLocalPreferenceSummary === 'function') {
    const originalSummary = buildLocalPreferenceSummary;
    buildLocalPreferenceSummary = function() {
      const out = originalSummary();
      const comments = (profile.pairwise || []).map(x => x.comment || '').filter(Boolean).join(' ').toLowerCase();
      const rules = [...(out.rules || [])];
      if (/reflexo/.test(comments)) rules.push('Reflexo aparece repetidamente nas comparações A/B e deve ser observado com atenção.');
      if (/posição|dedo|pose|mão/.test(comments)) rules.push('Posição da mão e dos dedos aparece repetidamente nas comparações A/B.');
      if (/espaço|corte|crop|enquadramento/.test(comments)) rules.push('Enquadramento e possibilidade de corte aparecem nas comparações A/B; trate problemas corrigíveis como menos graves.');
      if (/glitter|cromad|metálic|brilho/.test(comments)) rules.push('Brilho, glitter e acabamento metálico aparecem nas comparações A/B e devem ser julgados conforme o gosto demonstrado, não como defeito automático.');
      return { ...out, rules: [...new Set(rules)].slice(0,12), summary: `${out.summary} Comentários A/B também entram no perfil quando você explica o motivo da escolha.` };
    };
    try { refreshLocalProfile(); } catch {}
  }

  if (typeof renderAccuracy === 'function') {
    renderAccuracy = function() {
      const sessions = (history || []).filter(x => x.id !== currentSessionId && Number.isFinite(x.agreement));
      const current = typeof calculateCurrentAgreement === 'function' ? calculateCurrentAgreement() : null;
      const vals = [...sessions.map(x => x.agreement), ...(current != null ? [current] : [])];
      const overall = vals.length ? Math.round(vals.reduce((a,b) => a + b, 0) / vals.length) : null;
      const value = document.getElementById('accuracyValue');
      const hint = document.getElementById('accuracyHint');
      if (value) value.textContent = overall == null ? 'Ainda sem dados' : `${overall}% de concordância média`;
      if (hint) hint.textContent = vals.length ? `Baseado em ${vals.length} sessão(ões) com avaliações suas.` : 'Depois que você avaliar as escolhas da IA, esta métrica mostra se ela está se aproximando do seu gosto.';
    };
    try { renderAccuracy(); } catch {}
  }

  const refineBtn = document.getElementById('refineProfileBtn');
  if (refineBtn && refineBtn.onclick) {
    const originalRefine = refineBtn.onclick;
    refineBtn.onclick = async function(e) {
      if (!confirm('Refinar o perfil com IA envia apenas o histórico textual (nenhuma foto) e gera um pequeno custo de API. Continuar?')) return;
      const beforeIn = usageTotals?.input_tokens || 0, beforeOut = usageTotals?.output_tokens || 0;
      await originalRefine.call(this,e);
      const di = (usageTotals?.input_tokens || 0) - beforeIn, dout = (usageTotals?.output_tokens || 0) - beforeOut;
      if ((di > 0 || dout > 0) && typeof moneyFromTokens === 'function') {
        const c = moneyFromTokens(di,dout);
        alert(`Perfil refinado. Custo aproximado desta atualização textual: R$ ${c.brl.toFixed(2)}.`);
      }
    };
  }

  const results = document.getElementById('results');
  if (results) results.addEventListener('change', async (e) => {
    if (e.target.matches('.manualFinalToggle input')) {
      try { await archiveCurrentSession(); } catch {}
    }
  });
})();