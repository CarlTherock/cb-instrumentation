(() => {
  const STORAGE_KEY = 'cbAlerteKeywordsV1';
  const SETTINGS_KEY = 'cbAlerteSettingsV1';
  const HISTORY_KEY = 'cbAlerteHistoryV1';
  const CUSTOM_SOUND_KEY = 'cbAlerteCustomSoundV1';
  const CONTEXT_WINDOW = 8000;
  const DEFAULT_KEYWORDS = [
    { phrase: 'Carl Desrochers', variants: ['Karl Desrochers', 'Carl des Rochers', 'Karl des Rochers'], mode: 'immediate' },
    { phrase: 'Desrochers', variants: ['des Rochers', 'des rochets', 'dérocher'], mode: 'immediate' },
    { phrase: 'TEI', variants: ['té i', 't i', 'ti', 'T.E.I.'], mode: 'immediate' },
    { phrase: 'Instrumentiste', variants: ['instrumentistes'], mode: 'immediate' },
    { phrase: 'Instrumentation', variants: ['instrumentations'], mode: 'immediate' },
    { phrase: 'Technicien', variants: ['techniciens'], mode: 'context' },
    { phrase: 'Instrument', variants: ['instruments'], mode: 'context' }
  ];

  const $ = id => document.getElementById(id);
  const ui = {
    statusPill: $('statusPill'), statusText: $('statusText'), signalDot: $('signalDot'), signalText: $('signalText'),
    meterFill: $('meterFill'), start: $('startButton'), stop: $('stopButton'), test: $('testButton'),
    language: $('languageSelect'), soundSelect: $('soundSelect'), soundFileInput: $('soundFileInput'), vibrateToggle: $('vibrateToggle'), cooldown: $('cooldownRange'), cooldownValue: $('cooldownValue'),
    live: $('transcriptLive'), transcriptHistory: $('transcriptHistory'), clearTranscript: $('clearTranscriptButton'),
    keywordForm: $('keywordForm'), phraseInput: $('phraseInput'), variantsInput: $('variantsInput'), modeInput: $('modeInput'), keywordList: $('keywordList'),
    alarmPanel: $('alarmPanel'), alarmWord: $('alarmWord'), alarmDetail: $('alarmDetail'), silence: $('silenceButton'),
    eventList: $('eventList'), clearHistory: $('clearHistoryButton')
  };

  let keywords = load(STORAGE_KEY, DEFAULT_KEYWORDS).map((item, index) => ({ id: item.id || `${Date.now()}-${index}`, ...item }));
  let settings = load(SETTINGS_KEY, { language: 'fr-CA', cooldown: 0, sound: 'police', vibrate: true });
  let events = load(HISTORY_KEY, []);
  let customSoundBase64 = load(CUSTOM_SOUND_KEY, null);
  let customSoundBuffer = null;
  let recognition, stream, audioContext, analyser, audioData, animationId, wakeLock, alarmBus;
  let listening = false, intentionalStop = false, lastAlarmAt = 0, contextHits = [], transcriptRows = [];
  let alarmSoundInterval, vibrateInterval, torchTrack, torchFlashInterval, torchState = false, activeAlarmNodes = [];
  let recordScriptNode, recordBuffer, recordWritePos = 0, recordedSamples = 0;
  const RECORD_SECONDS = 20;

  function load(key, fallback) { try { const value = JSON.parse(localStorage.getItem(key)); return value ?? fallback; } catch { return fallback; } }
  function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
  function normalize(value) { return ` ${String(value).toLocaleLowerCase('fr-CA').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()} `; }
  function nowLabel(date = new Date()) { return date.toLocaleTimeString('fr-CA', { hour: '2-digit', minute: '2-digit', second: '2-digit' }); }

  function renderKeywords() {
    ui.keywordList.innerHTML = '';
    keywords.forEach(keyword => {
      const row = document.createElement('div'); row.className = 'keyword-item';
      const variants = keyword.variants?.filter(Boolean) || [];
      row.innerHTML = `<div><div class="keyword-main">${escapeHtml(keyword.phrase)}</div><div class="keyword-meta"><span class="tag ${keyword.mode === 'context' ? 'context' : ''}">${keyword.mode === 'context' ? 'CONTEXTE' : 'IMMÉDIAT'}</span>${variants.length ? `Variantes : ${escapeHtml(variants.join(', '))}` : 'Aucune variante'}</div></div><button class="delete-button" type="button" title="Supprimer ${escapeHtml(keyword.phrase)}" aria-label="Supprimer ${escapeHtml(keyword.phrase)}">×</button>`;
      row.querySelector('button').addEventListener('click', () => { keywords = keywords.filter(item => item.id !== keyword.id); save(STORAGE_KEY, keywords); renderKeywords(); });
      ui.keywordList.appendChild(row);
    });
  }
  function renderEvents() {
    if (!events.length) { ui.eventList.innerHTML = '<p class="empty">Aucune alerte pour le moment.</p>'; return; }
    ui.eventList.innerHTML = events.slice(0, 40).map(event => `<div class="event-item"><div><div class="event-word">⚠ ${escapeHtml(event.word)}</div><div class="event-text">${escapeHtml(event.text)}</div></div><div class="event-time">${escapeHtml(event.time)}</div></div>`).join('');
  }
  function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
  function setStatus(on, text) { ui.statusPill.textContent = on ? 'ÉCOUTE ACTIVE' : 'ARRÊTÉ'; ui.statusPill.className = `status-pill ${on ? 'status-on' : 'status-off'}`; ui.statusText.textContent = text; ui.start.disabled = on; ui.stop.disabled = !on; }

  function matchKeyword(keyword, normalizedText) {
    const candidates = [keyword.phrase, ...(keyword.variants || [])].map(normalize);
    return candidates.some(candidate => normalizedText.includes(candidate));
  }
  function getMatches(text) {
    const clean = normalize(text);
    return keywords.filter(keyword => matchKeyword(keyword, clean));
  }
  function processFinalText(text) {
    if (!text.trim()) return;
    appendTranscript(text, true);
    const matches = getMatches(text);
    const immediate = matches.find(item => item.mode === 'immediate');
    if (immediate) { triggerAlarm(immediate.phrase, text); return; }
    const currentContexts = matches.filter(item => item.mode === 'context');
    const timestamp = Date.now();
    contextHits = contextHits.filter(hit => timestamp - hit.time < CONTEXT_WINDOW);
    currentContexts.forEach(item => contextHits.push({ id: item.id, phrase: item.phrase, time: timestamp }));
    const distinct = [...new Map(contextHits.map(hit => [hit.id, hit])).values()];
    if (distinct.length >= 2) triggerAlarm(distinct.map(hit => hit.phrase).join(' + '), text);
  }
  function appendTranscript(text, isFinal) {
    ui.live.textContent = text || 'Écoute en cours…';
    if (!isFinal) return;
    transcriptRows.unshift({ text, time: nowLabel() }); transcriptRows = transcriptRows.slice(0, 12);
    ui.transcriptHistory.innerHTML = transcriptRows.map(row => `<div class="transcript-row"><span class="transcript-time">${row.time}</span>${escapeHtml(row.text)}</div>`).join('');
  }

  function triggerAlarm(word, text) {
    const time = Date.now();
    if (time - lastAlarmAt < Number(settings.cooldown) * 1000) return;
    lastAlarmAt = time;
    ui.alarmWord.textContent = word;
    ui.alarmDetail.textContent = `Entendu : « ${text} »`;
    ui.alarmPanel.hidden = false; document.body.classList.add('alarming');
    events.unshift({ word, text, time: nowLabel() }); events = events.slice(0, 80); save(HISTORY_KEY, events); renderEvents();
    if (settings.vibrate !== false) startVibrateLoop();
    startAlarmSoundLoop();
    startTorch();
  }
  function snoozeAlarm() {
    ui.alarmPanel.hidden = true; document.body.classList.remove('alarming');
    stopAlarmSoundLoop();
    stopVibrateLoop();
    stopTorch();
    const played = playRecordedClip();
    if (!played && !listening && audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
  }
  function playRecordedClip() {
    if (!audioContext) return false;
    const snapshot = getRecordedSnapshot();
    if (!snapshot || snapshot.length < audioContext.sampleRate * 0.5) return false;
    const ctx = audioContext;
    const buffer = ctx.createBuffer(1, snapshot.length, ctx.sampleRate);
    buffer.copyToChannel(snapshot, 0);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => { if (!listening && audioContext === ctx) { try { ctx.close(); } catch {} audioContext = null; } };
    source.start();
    return true;
  }
  function ensureAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
  }
  function getAlarmBus(ctx) {
    if (!alarmBus || alarmBus.ctx !== ctx) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -20; compressor.knee.value = 10; compressor.ratio.value = 12; compressor.attack.value = 0.003; compressor.release.value = 0.15;
      const boost = ctx.createGain(); boost.gain.value = 2.2;
      compressor.connect(boost).connect(ctx.destination);
      alarmBus = { ctx, input: compressor };
    }
    return alarmBus.input;
  }
  const SOUND_PRESETS = {
    police: (ctx, bus, t0, dur) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.linearRampToValueAtTime(1250, t0 + dur / 2);
      osc.frequency.linearRampToValueAtTime(520, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0); gain.gain.linearRampToValueAtTime(1, t0 + .04);
      gain.gain.setValueAtTime(1, t0 + dur - .05); gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur);
      return [osc];
    },
    ambulance: (ctx, bus, t0, dur) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square'; const step = .15;
      for (let t = t0, i = 0; t < t0 + dur; t += step, i++) osc.frequency.setValueAtTime(i % 2 ? 950 : 650, t);
      gain.gain.setValueAtTime(1, t0); gain.gain.setValueAtTime(1, t0 + dur - .05); gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur);
      return [osc];
    },
    pompier: (ctx, bus, t0, dur) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; const step = .5;
      for (let t = t0, i = 0; t < t0 + dur; t += step, i++) osc.frequency.setValueAtTime(i % 2 ? 440 : 800, t);
      gain.gain.setValueAtTime(1, t0); gain.gain.setValueAtTime(1, t0 + dur - .05); gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur);
      return [osc];
    },
    klaxon: (ctx, bus, t0, dur) => {
      const osc1 = ctx.createOscillator(); const osc2 = ctx.createOscillator(); const gain = ctx.createGain();
      osc1.type = 'sawtooth'; osc1.frequency.value = 220; osc2.type = 'sawtooth'; osc2.frequency.value = 277;
      gain.gain.setValueAtTime(0.0001, t0); gain.gain.linearRampToValueAtTime(1, t0 + .04);
      gain.gain.setValueAtTime(1, t0 + dur - .05); gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc1.connect(gain); osc2.connect(gain); gain.connect(bus);
      osc1.start(t0); osc1.stop(t0 + dur); osc2.start(t0); osc2.stop(t0 + dur);
      return [osc1, osc2];
    },
    sonnerie: (ctx, bus, t0, dur) => {
      const nodes = []; const ringLen = .4, gap = .2, pairGap = .6; let t = t0;
      while (t < t0 + dur - ringLen) {
        for (let r = 0; r < 2 && t < t0 + dur - ringLen; r++) {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = 'sine'; osc.frequency.value = 950;
          gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(1, t + .02);
          gain.gain.setValueAtTime(1, t + ringLen - .02); gain.gain.linearRampToValueAtTime(0.0001, t + ringLen);
          osc.connect(gain).connect(bus); osc.start(t); osc.stop(t + ringLen);
          nodes.push(osc); t += ringLen + gap;
        }
        t += pairGap;
      }
      return nodes;
    },
    original: (ctx, bus, t0, dur) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = 860; gain.gain.value = 0.0001;
      for (let i = 0; i < 8; i++) { gain.gain.setValueAtTime(0.0001, t0 + i * .25); gain.gain.linearRampToValueAtTime(1, t0 + i * .25 + .025); gain.gain.setValueAtTime(1, t0 + i * .25 + .15); gain.gain.linearRampToValueAtTime(0.0001, t0 + i * .25 + .19); }
      osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur);
      return [osc];
    },
    cloche: (ctx, bus, t0, dur) => {
      const nodes = []; const freqs = [660, 660 * 2.42, 660 * 3.86];
      freqs.forEach((f, i) => {
        const osc = ctx.createOscillator(); const gain = ctx.createGain();
        osc.type = 'sine'; osc.frequency.value = f;
        const peak = i === 0 ? 1 : .35 / i;
        gain.gain.setValueAtTime(0.0001, t0); gain.gain.linearRampToValueAtTime(peak, t0 + .01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur); nodes.push(osc);
      });
      return nodes;
    },
    corne: (ctx, bus, t0, dur) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = 110;
      gain.gain.setValueAtTime(0.0001, t0); gain.gain.linearRampToValueAtTime(1, t0 + .15);
      gain.gain.setValueAtTime(1, t0 + dur - .3); gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur);
      return [osc];
    },
    detecteur: (ctx, bus, t0, dur) => {
      const nodes = []; const beepLen = .15, gap = .15, groupGap = .6; let t = t0;
      while (t < t0 + dur - beepLen) {
        for (let b = 0; b < 3 && t < t0 + dur - beepLen; b++) {
          const osc = ctx.createOscillator(); const gain = ctx.createGain();
          osc.type = 'square'; osc.frequency.value = 3200;
          gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(1, t + .01);
          gain.gain.setValueAtTime(1, t + beepLen - .01); gain.gain.linearRampToValueAtTime(0.0001, t + beepLen);
          osc.connect(gain).connect(bus); osc.start(t); osc.stop(t + beepLen);
          nodes.push(osc); t += beepLen + gap;
        }
        t += groupGap;
      }
      return nodes;
    },
    buzzer: (ctx, bus, t0, dur) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'square'; osc.frequency.value = 180;
      gain.gain.setValueAtTime(0.0001, t0); gain.gain.linearRampToValueAtTime(1, t0 + .03);
      gain.gain.setValueAtTime(1, t0 + dur - .05); gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur);
      return [osc];
    },
    raid: (ctx, bus, t0, dur) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(300, t0);
      osc.frequency.linearRampToValueAtTime(900, t0 + dur * .6);
      osc.frequency.linearRampToValueAtTime(300, t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0); gain.gain.linearRampToValueAtTime(1, t0 + .1);
      gain.gain.setValueAtTime(1, t0 + dur - .1); gain.gain.linearRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain).connect(bus); osc.start(t0); osc.stop(t0 + dur);
      return [osc];
    }
  };
  function getRecordedSnapshot() {
    if (!recordBuffer) return null;
    const capacity = recordBuffer.length;
    const len = recordedSamples < capacity ? recordedSamples : capacity;
    if (len < 1) return null;
    const out = new Float32Array(len);
    if (recordedSamples < capacity) { out.set(recordBuffer.subarray(0, len)); }
    else {
      const tailLen = capacity - recordWritePos;
      out.set(recordBuffer.subarray(recordWritePos), 0);
      out.set(recordBuffer.subarray(0, recordWritePos), tailLen);
    }
    return out;
  }
  function playCallReplay(ctx, bus, t0) {
    const snapshot = getRecordedSnapshot();
    if (!snapshot || snapshot.length < ctx.sampleRate * 0.5) { activeAlarmNodes = SOUND_PRESETS.police(ctx, bus, t0, 2.1); return 2.1; }
    const buffer = ctx.createBuffer(1, snapshot.length, ctx.sampleRate);
    buffer.copyToChannel(snapshot, 0);
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const gain = ctx.createGain(); gain.gain.value = 1;
    source.connect(gain).connect(bus); source.start(t0);
    activeAlarmNodes = [source];
    return buffer.duration;
  }
  function base64ToArrayBuffer(base64) {
    const binary = atob(base64); const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }
  function arrayBufferToBase64(buffer) {
    let binary = ''; const bytes = new Uint8Array(buffer); const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    return btoa(binary);
  }
  async function getCustomSoundBuffer(ctx) {
    if (customSoundBuffer) return customSoundBuffer;
    if (!customSoundBase64) return null;
    try { customSoundBuffer = await ctx.decodeAudioData(base64ToArrayBuffer(customSoundBase64)); return customSoundBuffer; }
    catch (error) { console.warn('Impossible de lire le son personnalisé :', error); return null; }
  }
  async function playCustomSound(ctx, bus, t0) {
    const buffer = await getCustomSoundBuffer(ctx);
    if (!buffer) { activeAlarmNodes = SOUND_PRESETS.police(ctx, bus, t0, 2.1); return 2.1; }
    const source = ctx.createBufferSource(); source.buffer = buffer;
    const gain = ctx.createGain(); gain.gain.value = 1;
    source.connect(gain).connect(bus); source.start(t0);
    activeAlarmNodes = [source];
    return buffer.duration;
  }
  async function playAlarm() {
    if (!audioContext) return 2.1;
    stopAlarmSound();
    const ctx = audioContext; const bus = getAlarmBus(ctx);
    const t0 = ctx.currentTime + 0.02;
    if (settings.sound === 'appel') return playCallReplay(ctx, bus, t0);
    if (settings.sound === 'custom') return await playCustomSound(ctx, bus, t0);
    const dur = 2.1;
    const generator = SOUND_PRESETS[settings.sound] || SOUND_PRESETS.police;
    activeAlarmNodes = generator(ctx, bus, t0, dur);
    return dur;
  }
  function stopAlarmSound() { activeAlarmNodes.forEach(node => { try { node.stop(); } catch {} }); activeAlarmNodes = []; }
  async function playAlarmCycle() { const dur = await playAlarm(); const gap = (settings.sound === 'appel' || settings.sound === 'custom') ? 400 : 100; alarmSoundInterval = setTimeout(playAlarmCycle, dur * 1000 + gap); }
  function startAlarmSoundLoop() { playAlarmCycle(); }
  function stopAlarmSoundLoop() { if (alarmSoundInterval) { clearTimeout(alarmSoundInterval); alarmSoundInterval = null; } stopAlarmSound(); }
  function startVibrateLoop() {
    try { navigator.vibrate?.([250, 120, 250, 120, 500]); } catch {}
    vibrateInterval = setInterval(() => { try { navigator.vibrate?.([250, 120, 250, 120, 500]); } catch {} }, 1300);
  }
  function stopVibrateLoop() { if (vibrateInterval) { clearInterval(vibrateInterval); vibrateInterval = null; } try { navigator.vibrate?.(0); } catch {} }
  async function startTorch() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      const torchStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const track = torchStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.();
      if (capabilities && capabilities.torch) {
        torchTrack = track; torchState = false;
        const toggle = async () => { torchState = !torchState; try { await torchTrack.applyConstraints({ advanced: [{ torch: torchState }] }); } catch {} };
        await toggle();
        torchFlashInterval = setInterval(toggle, 300);
      } else { track.stop(); }
    } catch (error) { console.warn('Lampe torche non disponible :', error); }
  }
  async function stopTorch() {
    if (torchFlashInterval) { clearInterval(torchFlashInterval); torchFlashInterval = null; }
    try { if (torchTrack) { await torchTrack.applyConstraints({ advanced: [{ torch: false }] }); torchTrack.stop(); } } catch {}
    torchTrack = null; torchState = false;
  }

  function setupRecordingBuffer(ctx, sourceNode) {
    const capacity = Math.ceil(RECORD_SECONDS * ctx.sampleRate);
    recordBuffer = new Float32Array(capacity); recordWritePos = 0; recordedSamples = 0;
    recordScriptNode = ctx.createScriptProcessor(4096, 1, 1);
    recordScriptNode.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0);
      for (let i = 0; i < input.length; i++) {
        recordBuffer[recordWritePos] = input[i];
        recordWritePos = (recordWritePos + 1) % capacity;
        if (recordedSamples < capacity) recordedSamples++;
      }
    };
    const silentGain = ctx.createGain(); silentGain.gain.value = 0;
    sourceNode.connect(recordScriptNode); recordScriptNode.connect(silentGain).connect(ctx.destination);
  }
  function teardownRecordingBuffer() {
    try { recordScriptNode?.disconnect(); } catch {}
    recordScriptNode = null; recordBuffer = null; recordWritePos = 0; recordedSamples = 0;
  }
  async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
  async function releaseWakeLock() { try { await wakeLock?.release(); } catch {} wakeLock = null; }
  function updateMeter() {
    if (!analyser || !listening) return;
    analyser.getByteTimeDomainData(audioData);
    let total = 0; for (const value of audioData) { const n = (value - 128) / 128; total += n * n; }
    const rms = Math.sqrt(total / audioData.length); const level = Math.min(100, Math.max(0, rms * 650));
    ui.meterFill.style.width = `${level}%`;
    const active = level > 5; ui.signalDot.classList.toggle('active', active); ui.signalText.textContent = active ? 'Son détecté' : 'Silence';
    animationId = requestAnimationFrame(updateMeter);
  }
  function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) throw new Error('La reconnaissance vocale n’est pas disponible dans ce navigateur. Essaie Safari à jour ou Chrome.');
    recognition = new SpeechRecognition(); recognition.lang = settings.language; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) { const text = event.results[i][0].transcript.trim(); if (event.results[i].isFinal) processFinalText(text); else interim += `${text} `; }
      if (interim) appendTranscript(interim.trim(), false);
    };
    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { ui.statusText.textContent = 'Permission ou service de reconnaissance refusé. Vérifie les permissions du micro.'; stopListening(); }
      else if (event.error !== 'aborted') ui.statusText.textContent = `Reconnaissance : ${event.error}. Nouvelle tentative…`;
    };
    recognition.onend = () => { if (listening && !intentionalStop) { try { recognition.start(); } catch {} } };
  }
  async function startListening() {
    snoozeAlarm(); intentionalStop = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Le microphone n’est pas accessible dans ce navigateur. Ouvre l’app avec Safari ou Chrome via HTTPS.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      audioContext = new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume();
      analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; audioData = new Uint8Array(analyser.fftSize);
      const sourceNode = audioContext.createMediaStreamSource(stream); sourceNode.connect(analyser);
      setupRecordingBuffer(audioContext, sourceNode);
      setupRecognition(); listening = true; setStatus(true, 'Microphone et reconnaissance vocale actifs.'); await requestWakeLock(); updateMeter(); recognition.start();
    } catch (error) { console.error(error); ui.statusText.textContent = error.message || 'Impossible de démarrer l’écoute.'; stopListening(); }
  }
  async function stopListening() {
    intentionalStop = true; listening = false; try { recognition?.stop(); } catch {} recognition = null;
    cancelAnimationFrame(animationId); stream?.getTracks().forEach(track => track.stop()); stream = null;
    teardownRecordingBuffer();
    try { await audioContext?.close(); } catch {} audioContext = null; analyser = null;
    await releaseWakeLock(); ui.meterFill.style.width = '0%'; ui.signalDot.classList.remove('active'); ui.signalText.textContent = 'Silence'; setStatus(false, 'Écoute arrêtée.');
  }

  ui.keywordForm.addEventListener('submit', event => { event.preventDefault(); const phrase = ui.phraseInput.value.trim(); if (!phrase) return; const normalized = normalize(phrase); if (keywords.some(item => normalize(item.phrase) === normalized)) { alert('Ce mot ou cette expression est déjà dans la liste.'); return; } const variants = ui.variantsInput.value.split(',').map(value => value.trim()).filter(Boolean); keywords.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, phrase, variants, mode: ui.modeInput.value }); save(STORAGE_KEY, keywords); renderKeywords(); ui.keywordForm.reset(); ui.modeInput.value = 'immediate'; });
  ui.start.addEventListener('click', startListening); ui.stop.addEventListener('click', stopListening);
  ui.test.addEventListener('click', async () => { ensureAudioContext(); try { await audioContext.resume(); } catch {} triggerAlarm('TEST D’ALARME', 'Test manuel effectué.'); });
  ui.silence.addEventListener('click', snoozeAlarm);
  ui.clearTranscript.addEventListener('click', () => { transcriptRows = []; ui.transcriptHistory.innerHTML = ''; ui.live.textContent = listening ? 'Écoute en cours…' : 'L’écoute n’est pas démarrée.'; });
  ui.clearHistory.addEventListener('click', () => { events = []; save(HISTORY_KEY, events); renderEvents(); });
  ui.language.value = settings.language; ui.soundSelect.value = settings.sound; ui.cooldown.value = settings.cooldown; ui.cooldownValue.textContent = `${settings.cooldown} s`;
  ui.vibrateToggle.checked = settings.vibrate !== false;
  ui.language.addEventListener('change', () => { settings.language = ui.language.value; save(SETTINGS_KEY, settings); });
  ui.soundSelect.addEventListener('change', () => { settings.sound = ui.soundSelect.value; save(SETTINGS_KEY, settings); });
  ui.vibrateToggle.addEventListener('change', () => { settings.vibrate = ui.vibrateToggle.checked; save(SETTINGS_KEY, settings); });
  ui.soundFileInput.addEventListener('change', async () => {
    const file = ui.soundFileInput.files[0]; if (!file) return;
    try {
      const arrayBuffer = await file.arrayBuffer();
      customSoundBase64 = arrayBufferToBase64(arrayBuffer);
      customSoundBuffer = null;
      try { save(CUSTOM_SOUND_KEY, customSoundBase64); } catch { console.warn('Fichier trop volumineux pour être sauvegardé : actif pour cette session seulement.'); }
      settings.sound = 'custom'; ui.soundSelect.value = 'custom'; save(SETTINGS_KEY, settings);
    } catch (error) { console.error(error); alert('Impossible de lire ce fichier audio.'); }
  });
  ui.cooldown.addEventListener('input', () => { settings.cooldown = Number(ui.cooldown.value); ui.cooldownValue.textContent = `${settings.cooldown} s`; save(SETTINGS_KEY, settings); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && listening) requestWakeLock(); });
  window.addEventListener('beforeunload', () => { if (listening) stopListening(); });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  renderKeywords(); renderEvents(); setStatus(false, 'Prêt à écouter le haut-parleur CB.');
})();
