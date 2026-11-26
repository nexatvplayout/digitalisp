// DIGITAL ISP · o aviso de pânico nas páginas da sala e do guichê: uma faixa vermelha piscando no alto, com o bipe
// repetindo, até alguém encerrar (o botão "Encerrar"). Só texto por textContent; o estilo vem de reparticao.css (.pz-*).

let ctx = null; let timer = null; let vistos = '';

function bipe() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    ctx = ctx || new AC(); if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator(); const g = ctx.createGain(); const t = t0 + i * 0.28;
      o.type = 'square'; o.frequency.value = i % 2 ? 660 : 1040;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.linearRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.26);
    }
  } catch { /* sem som */ }
}

/**
 * Mostra (ou tira) os pânicos abertos. lista: [{ id, room, at }]; fechar(id): encerra; minhaSala: o nome da sala desta
 * página (o próprio pânico aparece como "acionado aqui").
 */
export function mostrarPanicos(lista, { fechar, minhaSala = null } = {}) {
  let box = document.getElementById('pzBox');
  if (!box) { box = document.createElement('div'); box.id = 'pzBox'; box.className = 'pz-box'; box.setAttribute('role', 'alert'); document.body.prepend(box); }
  // silencioso em quem aciona: o pânico desta sala não aparece nem toca aqui (o agressor pode estar na sala)
  const abertos = (Array.isArray(lista) ? lista : []).filter((p) => !(minhaSala && p.room === minhaSala));
  box.hidden = !abertos.length;
  box.replaceChildren(...abertos.map((p) => {
    const d = document.createElement('div'); d.className = 'pz-item';
    const b = document.createElement('b');
    const h = new Date(p.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    b.textContent = minhaSala && p.room === minhaSala ? `PÂNICO acionado nesta sala às ${h}` : `PÂNICO em ${p.room} (${h}): vá até lá ou chame ajuda`;
    const x = document.createElement('button'); x.type = 'button'; x.className = 'r-btn small'; x.textContent = 'Encerrar (já atendido)';
    x.addEventListener('click', async () => { if (!confirm(`Encerrar o pânico de ${p.room}?`)) return; x.disabled = true; try { await fechar(p.id); } catch (e) { alert(e.message); x.disabled = false; } });
    d.append(b, x); return d;
  }));
  // o bipe a cada 6 s enquanto houver pânico aberto; um pânico novo toca na hora
  const chave = abertos.map((p) => p.id).join(',');
  if (abertos.length && chave !== vistos) bipe();
  vistos = chave;
  if (abertos.length && !timer) timer = setInterval(bipe, 6000);
  if (!abertos.length && timer) { clearInterval(timer); timer = null; }
}
