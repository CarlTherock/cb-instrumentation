(() => {
  const STORAGE_KEY = 'cbAlerteKeywordsV1';
  const SETTINGS_KEY = 'cbAlerteSettingsV1';
  const HISTORY_KEY = 'cbAlerteHistoryV1';
  const DAILY_STATS_KEY = 'cbAlerteDailyStatsV1';
  const CONTEXT_WINDOW = 8000;
  const RECORD_SECONDS = 20;
  const MAX_RECORDINGS = 5;
  const DEFAULT_KEYWORDS = [
    { phrase: 'Carl Desrochers', variants: ['Karl Desrochers', 'Carl des Rochers', 'Karl des Rochers'], mode: 'immediate' },
    { phrase: 'Desrochers', variants: ['des Rochers', 'des rochets', 'dérocher'], mode: 'immediate' },
    { phrase: 'TEI', variants: ['té i', 't i', 'ti', 'T.E.I.'], mode: 'immediate' },
    { phrase: 'Instrumentiste', variants: ['instrumentistes'], mode: 'immediate' },
    { phrase: 'Instrumentation', variants: ['instrumentations'], mode: 'immediate' },
    { phrase: 'Technicien', variants: ['techniciens'], mode: 'context' },
    { phrase: 'Instrument', variants: ['instruments'], mode: 'immediate' }
  ];

  const $ = id => document.getElementById(id);
  const ui = {
    statusPill: $('statusPill'), statusText: $('statusText'), signalDot: $('signalDot'), signalText: $('signalText'),
    meterFill: $('meterFill'), start: $('startButton'), stop: $('stopButton'), test: $('testButton'),
    ambientButton: $('ambientButton'), ambientResult: $('ambientResult'), ambientChartsToggle: $('ambientChartsToggle'), ambientCharts: $('ambientCharts'),
    levelChart: $('levelChart'), freqChart: $('freqChart'), baselineChart: $('baselineChart'),
    levelChartBlock: $('levelChartBlock'), freqChartBlock: $('freqChartBlock'), baselineChartBlock: $('baselineChartBlock'),
    levelChartStat: $('levelChartStat'), freqChartStat: $('freqChartStat'), baselineChartStat: $('baselineChartStat'),
    chartModal: $('chartModal'), chartModalTitle: $('chartModalTitle'), chartModalAxis: $('chartModalAxis'), chartModalCanvas: $('chartModalCanvas'),
    chartModalReadout: $('chartModalReadout'), chartModalStats: $('chartModalStats'), chartModalClose: $('chartModalClose'),
    splashScreen: $('splashScreen'), appShell: $('appShell'),
    language: $('languageSelect'), sensitiveToggle: $('sensitiveToggle'), meterSensitivity: $('meterSensitivityRange'), meterSensitivityValue: $('meterSensitivityValue'),
    soundSelect: $('soundSelect'), vibrateToggle: $('vibrateToggle'), cooldown: $('cooldownRange'), cooldownValue: $('cooldownValue'),
    live: $('transcriptLive'), transcriptHistory: $('transcriptHistory'), clearTranscript: $('clearTranscriptButton'),
    keywordForm: $('keywordForm'), phraseInput: $('phraseInput'), variantsInput: $('variantsInput'), modeInput: $('modeInput'), keywordList: $('keywordList'),
    alarmPanel: $('alarmPanel'), alarmWord: $('alarmWord'), alarmDetail: $('alarmDetail'), silence: $('silenceButton'),
    snoozePanel: $('snoozeConfirmPanel'), snoozeText: $('snoozeConfirmText'), snoozeListen: $('snoozeListenButton'), snoozeAck: $('snoozeAckButton'),
    player: $('recordingPlayer'), playerToggle: $('playerToggle'), playerSeek: $('playerSeek'), playerTime: $('playerTime'), playerClose: $('playerClose'), playerSpeaker: $('playerSpeakerToggle'),
    eventList: $('eventList'), clearHistory: $('clearHistoryButton'),
    navSettings: $('navSettingsButton'), navCharts: $('navChartsButton'), navWords: $('navWordsButton'), navHistory: $('navHistoryButton'),
    settingsModal: $('settingsModal'), settingsClose: $('settingsCloseButton'),
    chartsModal: $('chartsModal'), chartsClose: $('chartsCloseButton'),
    wordsModal: $('wordsModal'), wordsClose: $('wordsCloseButton'),
    historyModal: $('historyModal'), historyClose: $('historyCloseButton'),
    alertsTodayCount: $('alertsTodayCount'), transmissionsTodayCount: $('transmissionsTodayCount'), alertsPerHourChart: $('alertsPerHourChart')
  };

  let keywords = load(STORAGE_KEY, DEFAULT_KEYWORDS).map((item, index) => ({ id: item.id || `${Date.now()}-${index}`, ...item }));
  {
    let migrated = false;
    keywords = keywords.map(item => {
      if (normalize(item.phrase).trim() === 'instrument' && item.mode === 'context') { migrated = true; return { ...item, mode: 'immediate' }; }
      return item;
    });
    if (migrated) save(STORAGE_KEY, keywords);
  }
  let settings = load(SETTINGS_KEY, { language: 'fr-CA', cooldown: 0, sound: 'police', vibrate: true, sensitive: false, meterSensitivity: 5 });
  let events = load(HISTORY_KEY, []);
  let recognition, stream, audioContext, analyser, audioData, animationId, wakeLock, alarmBus;
  let listening = false, intentionalStop = false, lastAlarmAt = 0, contextHits = [], transcriptRows = [];
  let alarmSoundInterval, vibrateInterval, activeAlarmNodes = [];
  let torchStream, torchTrack, torchFlashInterval, torchState = false;
  let recordScriptNode, recordBuffer, recordWritePos = 0, recordedSamples = 0;
  let callRecordings = [];
  let lastTriggerId = null, lastTriggerRecentText = '';
  let playerBuffer = null, playerSource = null, playerOffset = 0, playerStartedAt = 0, playerIsPlaying = false, playerRAF = null;
  let loudspeakerOn = true, quietBus = null;
  let ambientSamples = [], ambientBaseline = 6, ambientSampleInterval = null;
  let baselineHistory = [], lastLevelSamples = [], lastFreqSnapshot = [], lastFreqSampleRate = 44100, chartsVisible = false;
  let chartModalData = null, chartModalDragging = false;

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
    ui.eventList.innerHTML = events.slice(0, 40).map(event => {
      const hasRecording = callRecordings.some(rec => rec.id === event.id);
      return `<div class="event-item"><div><div class="event-word"><svg class="icon icon-sm" aria-hidden="true"><use href="#icon-warning"></use></svg>${escapeHtml(event.word)}</div><div class="event-text">${escapeHtml(event.text)}</div></div><div class="event-time">${escapeHtml(event.time)}${hasRecording ? `<button class="text-button replay-button" type="button" data-id="${event.id}">▶ RÉÉCOUTER</button>` : ''}</div></div>`;
    }).join('');
    ui.eventList.querySelectorAll('.replay-button').forEach(button => button.addEventListener('click', () => playStoredRecording(button.dataset.id)));
  }
  function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
  function setStatus(on, text) { ui.statusPill.textContent = on ? 'ÉCOUTE ACTIVE' : 'ARRÊTÉ'; ui.statusPill.className = `status-pill ${on ? 'status-on' : 'status-off'}`; ui.statusText.textContent = text; ui.start.disabled = on; ui.stop.disabled = !on; ui.start.hidden = on; ui.stop.hidden = !on; }

  function matchKeyword(keyword, normalizedText) {
    const candidates = [keyword.phrase, ...(keyword.variants || [])].map(normalize);
    return candidates.some(candidate => normalizedText.includes(candidate));
  }
  function getMatches(text) {
    const clean = normalize(text);
    return keywords.filter(keyword => matchKeyword(keyword, clean));
  }
  let lastInterimTriggerId = null;
  function processInterimText(text) {
    if (!text.trim()) return;
    const matches = getMatches(text);
    const immediate = matches.find(item => item.mode === 'immediate');
    if (immediate && immediate.id !== lastInterimTriggerId) { lastInterimTriggerId = immediate.id; triggerAlarm(immediate.phrase, text); }
  }
  function processFinalText(text) {
    if (!text.trim()) return;
    lastInterimTriggerId = null;
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
    transcriptRows.unshift({ text, time: nowLabel(), ts: Date.now() }); transcriptRows = transcriptRows.slice(0, 12);
    ui.transcriptHistory.innerHTML = transcriptRows.map(row => `<div class="transcript-row"><span class="transcript-time">${row.time}</span>${escapeHtml(row.text)}</div>`).join('');
    bumpDailyStat('transmissions');
  }

  function triggerAlarm(word, text) {
    const time = Date.now();
    if (time - lastAlarmAt < Number(settings.cooldown) * 1000) return;
    lastAlarmAt = time;
    ui.alarmWord.textContent = word;
    ui.alarmDetail.textContent = `Entendu : « ${text} »`;
    ui.alarmPanel.hidden = false; document.body.classList.add('alarming');
    const eventId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    events.unshift({ id: eventId, word, text, time: nowLabel(), ts: Date.now() }); events = events.slice(0, 80); save(HISTORY_KEY, events);
    const snapshot = getRecordedSnapshot();
    if (snapshot && audioContext) { callRecordings.unshift({ id: eventId, data: snapshot, sampleRate: audioContext.sampleRate }); callRecordings = callRecordings.slice(0, MAX_RECORDINGS); }
    const cutoff = Date.now() - RECORD_SECONDS * 1000;
    lastTriggerId = eventId;
    lastTriggerRecentText = transcriptRows.filter(row => row.ts >= cutoff).map(row => row.text).reverse().join(' ') || text;
    renderEvents();
    if (settings.vibrate !== false) startVibrateLoop();
    startAlarmSoundLoop();
    startTorchFlash();
    bumpDailyStat('alerts');
    renderGraphStats();
  }
  function snoozeAlarm() {
    ui.alarmPanel.hidden = true; document.body.classList.remove('alarming');
    stopAlarmSoundLoop();
    stopVibrateLoop();
    stopTorchFlash();
    const hasRecording = callRecordings.some(rec => rec.id === lastTriggerId);
    if (hasRecording || lastTriggerRecentText) {
      ui.snoozeText.textContent = lastTriggerRecentText || 'Aucun texte capté durant cette période.';
      ui.snoozeListen.disabled = !hasRecording;
      ui.snoozePanel.hidden = false;
      return;
    }
    finalizeSnooze();
  }
  function finalizeSnooze() {
    ui.snoozePanel.hidden = true;
    if (!listening && audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
  }
  function formatTime(seconds) {
    seconds = Math.max(0, Math.floor(seconds || 0));
    const m = Math.floor(seconds / 60); const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function bufferFromSnapshot(ctx, snapshot, sampleRate) {
    const buffer = ctx.createBuffer(1, snapshot.length, sampleRate);
    buffer.copyToChannel(snapshot, 0);
    return buffer;
  }
  function stopPlayerSource() { if (playerSource) { try { playerSource.onended = null; playerSource.stop(); } catch {} playerSource = null; } }
  async function openPlayer(buffer) {
    await ensureRunningAudioContext();
    playerBuffer = buffer; playerOffset = 0; playerIsPlaying = false;
    ui.player.hidden = false;
    ui.playerSeek.max = buffer.duration;
    ui.playerSeek.value = 0;
    updatePlayerTimeLabel();
    await playerPlay();
  }
  function getPlaybackBus(ctx) {
    if (loudspeakerOn) return getAlarmBus(ctx);
    if (!quietBus || quietBus.ctx !== ctx) { const gain = ctx.createGain(); gain.gain.value = 0.5; gain.connect(ctx.destination); quietBus = { ctx, node: gain }; }
    return quietBus.node;
  }
  async function stopListeningForPlayback() {
    if (listening) { ui.statusText.textContent = 'Écoute arrêtée automatiquement pour éviter que la réécoute redéclenche une alarme.'; await stopListening(); return true; }
    return false;
  }
  async function playerPlay() {
    if (!playerBuffer) return;
    await ensureRunningAudioContext();
    stopPlayerSource();
    const ctx = audioContext; const bus = getPlaybackBus(ctx);
    const source = ctx.createBufferSource(); source.buffer = playerBuffer;
    source.connect(bus);
    source.start(ctx.currentTime, Math.min(playerOffset, playerBuffer.duration - 0.01));
    playerStartedAt = ctx.currentTime; playerSource = source; playerIsPlaying = true;
    ui.playerToggle.textContent = '⏸';
    source.onended = () => { if (playerIsPlaying) { playerIsPlaying = false; playerOffset = 0; ui.playerToggle.textContent = '▶'; ui.playerSeek.value = 0; updatePlayerTimeLabel(); } };
    tickPlayer();
  }
  function playerPause() {
    if (!playerIsPlaying) return;
    playerOffset += audioContext.currentTime - playerStartedAt;
    stopPlayerSource(); playerIsPlaying = false; ui.playerToggle.textContent = '▶';
    cancelAnimationFrame(playerRAF);
  }
  function tickPlayer() {
    if (!playerIsPlaying) return;
    const current = playerOffset + (audioContext.currentTime - playerStartedAt);
    ui.playerSeek.value = Math.min(current, playerBuffer.duration);
    updatePlayerTimeLabel();
    playerRAF = requestAnimationFrame(tickPlayer);
  }
  function updatePlayerTimeLabel() {
    const current = playerIsPlaying ? playerOffset + (audioContext.currentTime - playerStartedAt) : playerOffset;
    ui.playerTime.textContent = `${formatTime(current)} / ${formatTime(playerBuffer ? playerBuffer.duration : 0)}`;
  }
  function closePlayer() {
    stopPlayerSource(); cancelAnimationFrame(playerRAF); playerIsPlaying = false; playerBuffer = null;
    ui.player.hidden = true;
    if (!listening && audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
  }
  async function playStoredRecording(id) {
    const rec = callRecordings.find(item => item.id === id);
    if (!rec) return;
    await stopListeningForPlayback();
    await ensureRunningAudioContext();
    await openPlayer(bufferFromSnapshot(audioContext, rec.data, rec.sampleRate));
  }
  function ensureAudioContext() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    return audioContext;
  }
  async function ensureRunningAudioContext() {
    ensureAudioContext();
    if (audioContext.state !== 'running') { try { await audioContext.resume(); } catch {} }
    return audioContext;
  }
  function getAlarmBus(ctx) {
    if (!alarmBus || alarmBus.ctx !== ctx) {
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -26; compressor.knee.value = 8; compressor.ratio.value = 18; compressor.attack.value = 0.002; compressor.release.value = 0.12;
      const boost = ctx.createGain(); boost.gain.value = 3.4;
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
  async function playAlarm() {
    if (!audioContext) return 2.1;
    stopAlarmSound();
    const ctx = audioContext; const bus = getAlarmBus(ctx);
    const t0 = ctx.currentTime + 0.02;
    if (settings.sound === 'appel') return playCallReplay(ctx, bus, t0);
    const dur = 2.1;
    const generator = SOUND_PRESETS[settings.sound] || SOUND_PRESETS.police;
    activeAlarmNodes = generator(ctx, bus, t0, dur);
    return dur;
  }
  function stopAlarmSound() { activeAlarmNodes.forEach(node => { try { node.stop(); } catch {} }); activeAlarmNodes = []; }
  async function playAlarmCycle() { const dur = await playAlarm(); const gap = settings.sound === 'appel' ? 400 : 100; alarmSoundInterval = setTimeout(playAlarmCycle, dur * 1000 + gap); }
  function startAlarmSoundLoop() { stopAlarmSoundLoop(); playAlarmCycle(); }
  function stopAlarmSoundLoop() { if (alarmSoundInterval) { clearTimeout(alarmSoundInterval); alarmSoundInterval = null; } stopAlarmSound(); }
  function startVibrateLoop() {
    stopVibrateLoop();
    try { navigator.vibrate?.([250, 120, 250, 120, 500]); } catch {}
    vibrateInterval = setInterval(() => { try { navigator.vibrate?.([250, 120, 250, 120, 500]); } catch {} }, 1300);
  }
  function stopVibrateLoop() { if (vibrateInterval) { clearInterval(vibrateInterval); vibrateInterval = null; } try { navigator.vibrate?.(0); } catch {} }
  async function acquireTorchTrack() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) return;
      torchStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const track = torchStream.getVideoTracks()[0];
      const capabilities = track.getCapabilities?.();
      if (capabilities && capabilities.torch) { torchTrack = track; }
      else { track.stop(); torchStream = null; }
    } catch (error) { console.warn('Lampe torche non disponible :', error); torchTrack = null; torchStream = null; }
  }
  function startTorchFlash() {
    stopTorchFlash();
    if (!torchTrack) return;
    torchState = false;
    const toggle = async () => { torchState = !torchState; try { await torchTrack.applyConstraints({ advanced: [{ torch: torchState }] }); } catch {} };
    toggle();
    torchFlashInterval = setInterval(toggle, 300);
  }
  function stopTorchFlash() {
    if (torchFlashInterval) { clearInterval(torchFlashInterval); torchFlashInterval = null; }
    if (torchTrack) { try { torchTrack.applyConstraints({ advanced: [{ torch: false }] }); } catch {} }
    torchState = false;
  }
  function releaseTorchTrack() {
    stopTorchFlash();
    try { torchTrack?.stop(); } catch {}
    torchTrack = null; torchStream = null;
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
  function drawLineChart(canvas, values, color) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!values.length) { ctx.fillStyle = '#5b7086'; ctx.font = '11px sans-serif'; ctx.fillText('Pas encore de données', 8, h / 2); return; }
    const max = Math.max(...values, 1); const min = 0;
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    values.forEach((v, i) => {
      const x = (i / (values.length - 1 || 1)) * w;
      const y = h - ((v - min) / (max - min || 1)) * (h - 6) - 3;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  function drawBarChart(canvas, values, color) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (!values.length) { ctx.fillStyle = '#5b7086'; ctx.font = '11px sans-serif'; ctx.fillText('Pas encore de données', 8, h / 2); return; }
    const max = Math.max(...values, 1); const barWidth = w / values.length;
    ctx.fillStyle = color;
    values.forEach((v, i) => { const barHeight = (v / max) * (h - 3); ctx.fillRect(i * barWidth, h - barHeight, Math.max(1, barWidth - 1), barHeight); });
  }
  function computeStdDev(values) {
    if (!values.length) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }
  function stabilityHint(std, kind) {
    if (kind === 'baseline') return std < 1 ? 'très stable' : std < 3 ? 'stable' : 'encore en ajustement';
    return std < 3 ? 'stable' : std < 8 ? 'modérément variable' : 'très variable';
  }
  function getTodayDateKey(date = new Date()) { return date.toLocaleDateString('en-CA'); }
  function bumpDailyStat(kind) {
    const today = getTodayDateKey();
    const stats = load(DAILY_STATS_KEY, { date: today, alerts: 0, transmissions: 0 });
    if (stats.date !== today) { stats.date = today; stats.alerts = 0; stats.transmissions = 0; }
    stats[kind] = (stats[kind] || 0) + 1;
    save(DAILY_STATS_KEY, stats);
  }
  function renderGraphStats() {
    const today = getTodayDateKey();
    const stats = load(DAILY_STATS_KEY, { date: today, alerts: 0, transmissions: 0 });
    const todaysAlerts = stats.date === today ? (stats.alerts || 0) : 0;
    const todaysTransmissions = stats.date === today ? (stats.transmissions || 0) : 0;
    if (ui.alertsTodayCount) ui.alertsTodayCount.textContent = todaysAlerts;
    if (ui.transmissionsTodayCount) ui.transmissionsTodayCount.textContent = todaysTransmissions;
    if (ui.alertsPerHourChart) {
      const now = new Date();
      const hourly = new Array(24).fill(0);
      events.forEach(event => {
        if (!event.ts) return;
        const eventDate = new Date(event.ts);
        if (getTodayDateKey(eventDate) !== getTodayDateKey(now)) return;
        hourly[eventDate.getHours()] += 1;
      });
      drawBarChart(ui.alertsPerHourChart, hourly, '#36a9ff');
    }
  }
  function redrawCharts() {
    if (!chartsVisible) return;
    drawLineChart(ui.levelChart, lastLevelSamples, '#36a9ff');
    drawBarChart(ui.freqChart, lastFreqSnapshot, '#35d07f');
    drawLineChart(ui.baselineChart, baselineHistory.map(item => item.value), '#ffb020');
    const levelStd = computeStdDev(lastLevelSamples);
    const freqStd = computeStdDev(lastFreqSnapshot);
    const baselineStd = computeStdDev(baselineHistory.map(item => item.value));
    ui.levelChartStat.textContent = lastLevelSamples.length ? `σ = ${levelStd.toFixed(1)}% (${stabilityHint(levelStd, 'level')})` : 'σ = —';
    ui.freqChartStat.textContent = lastFreqSnapshot.length ? `σ = ${freqStd.toFixed(1)}` : 'σ = —';
    ui.baselineChartStat.textContent = baselineHistory.length >= 3 ? `σ = ${baselineStd.toFixed(1)}% (${stabilityHint(baselineStd, 'baseline')})` : 'σ = — (pas encore assez de mesures)';
  }
  function openChartModal(config) {
    chartModalData = config;
    ui.chartModalTitle.textContent = config.title;
    ui.chartModalAxis.textContent = config.axisLabel;
    const std = computeStdDev(config.values);
    ui.chartModalStats.textContent = config.values.length ? `Écart-type (σ) : ${std.toFixed(1)}${config.unit || ''} — ${stabilityHint(std, config.kind)}` : 'Pas encore assez de données.';
    ui.chartModalReadout.textContent = 'Touche ou glisse sur le graphique pour voir une valeur précise.';
    ui.chartModal.hidden = false;
    drawModalChart();
  }
  function closeChartModal() { ui.chartModal.hidden = true; chartModalData = null; }
  function drawModalChart(cursorIndex) {
    if (!chartModalData) return;
    const canvas = ui.chartModalCanvas; const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const values = chartModalData.values;
    if (!values.length) { ctx.fillStyle = '#5b7086'; ctx.font = '13px sans-serif'; ctx.fillText('Pas encore de données', 12, h / 2); return; }
    const max = Math.max(...values, 1); const min = 0; const pad = 12;
    if (chartModalData.style === 'bar') {
      const barWidth = w / values.length;
      ctx.fillStyle = chartModalData.color;
      values.forEach((v, i) => { const bh = ((v - min) / (max - min || 1)) * (h - pad * 2); ctx.fillRect(i * barWidth, h - pad - bh, Math.max(1, barWidth - 1), bh); });
    } else {
      ctx.strokeStyle = chartModalData.color; ctx.lineWidth = 2; ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / (values.length - 1 || 1)) * w;
        const y = h - pad - ((v - min) / (max - min || 1)) * (h - pad * 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
    if (cursorIndex != null) {
      const x = (cursorIndex / (values.length - 1 || 1)) * w;
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  function handleChartPointer(evt) {
    if (!chartModalData || !chartModalData.values.length) return;
    const canvas = ui.chartModalCanvas; const rect = canvas.getBoundingClientRect();
    const relX = (evt.clientX - rect.left) / rect.width;
    const index = Math.max(0, Math.min(chartModalData.values.length - 1, Math.round(relX * (chartModalData.values.length - 1))));
    const value = chartModalData.values[index];
    const label = chartModalData.labelFn ? chartModalData.labelFn(index) : `#${index}`;
    ui.chartModalReadout.textContent = `${label} → ${value.toFixed(1)}${chartModalData.unit || ''}`;
    drawModalChart(index);
  }
  function getMeterThreshold() {
    const margin = 12 - Number(settings.meterSensitivity || 5);
    return Math.min(90, Math.max(1, ambientBaseline + margin));
  }
  function sampleAmbientBaseline() {
    if (!analyser || !listening) return;
    analyser.getByteTimeDomainData(audioData);
    let total = 0; for (const value of audioData) { const n = (value - 128) / 128; total += n * n; }
    const rms = Math.sqrt(total / audioData.length); const level = Math.min(100, Math.max(0, rms * 650));
    ambientSamples.push(level);
    if (ambientSamples.length > 240) ambientSamples.shift();
    if (ambientSamples.length >= 20 && ambientSamples.length % 20 === 0) {
      const sorted = [...ambientSamples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      ambientBaseline = ambientBaseline * 0.6 + median * 0.4;
      baselineHistory.push({ t: Date.now(), value: ambientBaseline }); baselineHistory = baselineHistory.slice(-60);
      redrawCharts();
    }
  }
  function updateMeter() {
    if (!analyser || !listening) return;
    analyser.getByteTimeDomainData(audioData);
    let total = 0; for (const value of audioData) { const n = (value - 128) / 128; total += n * n; }
    const rms = Math.sqrt(total / audioData.length); const level = Math.min(100, Math.max(0, rms * 650));
    ui.meterFill.style.width = `${level}%`;
    const threshold = getMeterThreshold();
    const active = level > threshold; ui.signalDot.classList.toggle('active', active); ui.signalText.textContent = active ? 'Son détecté' : 'Silence';
    animationId = requestAnimationFrame(updateMeter);
  }
  let ambientMeasuring = false;
  function measureAmbientNoise() {
    if (!analyser || !listening) { alert('Démarre l’écoute avant de mesurer le bruit ambiant.'); return; }
    if (ambientMeasuring) return;
    ambientMeasuring = true;
    ui.ambientButton.disabled = true; ui.ambientButton.textContent = 'MESURE EN COURS…';
    const samples = []; const duration = 3000; const start = performance.now();
    const sample = () => {
      analyser.getByteTimeDomainData(audioData);
      let total = 0; for (const value of audioData) { const n = (value - 128) / 128; total += n * n; }
      const rms = Math.sqrt(total / audioData.length);
      samples.push(Math.min(100, Math.max(0, rms * 650)));
      if (performance.now() - start < duration) { requestAnimationFrame(sample); return; }
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const max = Math.max(...samples);
      const verdict = avg < 8 ? 'calme' : avg < 20 ? 'modéré' : 'bruyant';
      ui.ambientResult.textContent = `Bruit ambiant (instantané) : ${avg.toFixed(0)}% en moyenne (pic ${max.toFixed(0)}%) — ${verdict}. Référence auto-calibrée : ${ambientBaseline.toFixed(0)}%. Seuil actuel du détecteur : ${getMeterThreshold().toFixed(0)}%.`;
      ui.ambientResult.hidden = false;
      lastLevelSamples = samples.filter((_, i) => i % 3 === 0);
      const freqData = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(freqData);
      lastFreqSnapshot = Array.from(freqData.slice(0, 100));
      lastFreqSampleRate = audioContext.sampleRate;
      redrawCharts();
      ambientMeasuring = false; ui.ambientButton.disabled = false; ui.ambientButton.textContent = 'MESURER LE BRUIT AMBIANT';
    };
    sample();
  }
  function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) throw new Error('La reconnaissance vocale n’est pas disponible dans ce navigateur. Essaie Safari à jour ou Chrome.');
    recognition = new SpeechRecognition(); recognition.lang = settings.language; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    recognition.onresult = event => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript.trim();
        if (event.results[i].isFinal) processFinalText(text);
        else { interim += `${text} `; if (settings.sensitive) processInterimText(text); }
      }
      if (interim) appendTranscript(interim.trim(), false);
    };
    recognition.onerror = event => {
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { ui.statusText.textContent = 'Permission ou service de reconnaissance refusé. Vérifie les permissions du micro.'; stopListening(); }
      else if (event.error !== 'aborted') ui.statusText.textContent = `Reconnaissance : ${event.error}. Nouvelle tentative…`;
    };
    recognition.onend = () => { if (listening && !intentionalStop) { try { recognition.start(); } catch {} } };
  }
  async function startListening() {
    if (listening) return;
    snoozeAlarm(); intentionalStop = false;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Le microphone n’est pas accessible dans ce navigateur. Ouvre l’app avec Safari ou Chrome via HTTPS.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
      audioContext = new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume();
      analyser = audioContext.createAnalyser(); analyser.fftSize = 1024; audioData = new Uint8Array(analyser.fftSize);
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const voiceHighpass = audioContext.createBiquadFilter(); voiceHighpass.type = 'highpass'; voiceHighpass.frequency.value = 300; voiceHighpass.Q.value = 0.7;
      const voiceLowpass = audioContext.createBiquadFilter(); voiceLowpass.type = 'lowpass'; voiceLowpass.frequency.value = 3400; voiceLowpass.Q.value = 0.7;
      sourceNode.connect(voiceHighpass).connect(voiceLowpass).connect(analyser);
      setupRecordingBuffer(audioContext, sourceNode);
      setupRecognition(); listening = true; setStatus(true, 'Microphone et reconnaissance vocale actifs.'); await requestWakeLock(); updateMeter(); recognition.start();
      acquireTorchTrack();
      ambientSamples = []; ambientBaseline = 6;
      ambientSampleInterval = setInterval(sampleAmbientBaseline, 1000);
    } catch (error) { console.error(error); ui.statusText.textContent = error.message || 'Impossible de démarrer l’écoute.'; stopListening(); }
  }
  async function stopListening() {
    intentionalStop = true; listening = false; try { recognition?.stop(); } catch {} recognition = null;
    stopAlarmSoundLoop(); stopVibrateLoop(); stopTorchFlash();
    cancelAnimationFrame(animationId); stream?.getTracks().forEach(track => track.stop()); stream = null;
    teardownRecordingBuffer();
    releaseTorchTrack();
    if (ambientSampleInterval) { clearInterval(ambientSampleInterval); ambientSampleInterval = null; }
    try { await audioContext?.close(); } catch {} audioContext = null; analyser = null;
    await releaseWakeLock(); ui.meterFill.style.width = '0%'; ui.signalDot.classList.remove('active'); ui.signalText.textContent = 'Silence'; setStatus(false, 'Écoute arrêtée.');
  }

  ui.keywordForm.addEventListener('submit', event => { event.preventDefault(); const phrase = ui.phraseInput.value.trim(); if (!phrase) return; const normalized = normalize(phrase); if (keywords.some(item => normalize(item.phrase) === normalized)) { alert('Ce mot ou cette expression est déjà dans la liste.'); return; } const variants = ui.variantsInput.value.split(',').map(value => value.trim()).filter(Boolean); keywords.push({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, phrase, variants, mode: ui.modeInput.value }); save(STORAGE_KEY, keywords); renderKeywords(); ui.keywordForm.reset(); ui.modeInput.value = 'immediate'; });
  ui.start.addEventListener('click', startListening); ui.stop.addEventListener('click', stopListening);
  ui.test.addEventListener('click', async () => { await ensureRunningAudioContext(); triggerAlarm('TEST D’ALARME', 'Test manuel effectué.'); });
  ui.diagnosticButton = $('diagnosticButton'); ui.diagnosticPanel = $('diagnosticPanel'); ui.diagnosticOutput = $('diagnosticOutput'); ui.diagnosticClose = $('diagnosticClose');
  function isInsideScrollableOrHidden(el) {
    let node = el.parentElement;
    while (node) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) || node.hasAttribute('hidden') || style.display === 'none') return true;
      node = node.parentElement;
    }
    return false;
  }
  function runViewportDiagnostic() {
    const lines = [];
    lines.push(`window.innerHeight : ${window.innerHeight}`);
    lines.push(`window.innerWidth  : ${window.innerWidth}`);
    lines.push(`screen.height (physique) : ${window.screen.height}`);
    lines.push(`screen.availHeight       : ${window.screen.availHeight}`);
    lines.push(`devicePixelRatio         : ${window.devicePixelRatio}`);
    lines.push(`visualViewport.h   : ${window.visualViewport ? Math.round(window.visualViewport.height) : 'n/a'}`);
    lines.push(`documentElement.clientHeight : ${document.documentElement.clientHeight}`);
    lines.push(`body.scrollHeight  : ${document.body.scrollHeight}`);
    lines.push(`display-mode standalone : ${window.matchMedia('(display-mode: standalone)').matches}`);
    lines.push(`navigator.standalone    : ${window.navigator.standalone}`);
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;height:0;padding-bottom:env(safe-area-inset-bottom);visibility:hidden;';
    document.body.appendChild(probe);
    const probeHeight = probe.getBoundingClientRect().height;
    probe.remove();
    lines.push(`env(safe-area-inset-bottom) mesuré : ${Math.round(probeHeight)}px`);
    const anyModalOpen = ['settingsModal', 'chartsModal', 'wordsModal', 'historyModal'].some(id => { const el = document.getElementById(id); return el && !el.hidden; });
    lines.push(`panneau ouvert pendant la mesure : ${anyModalOpen ? 'OUI (peut fausser les résultats ci-dessous)' : 'non — écran principal seul'}`);
    const nav = document.querySelector('.bottom-nav');
    if (nav) {
      const rect = nav.getBoundingClientRect();
      lines.push('');
      lines.push('--- .bottom-nav ---');
      lines.push(`top=${Math.round(rect.top)} bottom=${Math.round(rect.bottom)} height=${Math.round(rect.height)}`);
      lines.push(`écart entre bas du nav et bas de l'écran (innerHeight) : ${Math.round(window.innerHeight - rect.bottom)}px`);
    }
    lines.push('');
    lines.push('--- Éléments qui débordent réellement (hors zones qui défilent/cachées) ---');
    const overflowing = [];
    document.querySelectorAll('body *').forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > window.innerHeight + 2 && !isInsideScrollableOrHidden(el)) {
        const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '';
        overflowing.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls} → bottom=${Math.round(rect.bottom)} height=${Math.round(rect.height)}`);
      }
    });
    if (!overflowing.length) lines.push('(aucun élément ne déborde réellement — le HTML/CSS ne cause pas de débordement mesurable)');
    else lines.push(...overflowing.slice(0, 20));
    return lines.join('\n');
  }
  ui.diagnosticButton.addEventListener('click', () => {
    const live = runViewportDiagnostic();
    ui.diagnosticOutput.textContent = `=== AU DÉMARRAGE (écran principal, sans panneau) ===\n${startupDiagnostic || '(pas encore capturé)'}\n\n=== MAINTENANT (ce panneau est ouvert) ===\n${live}`;
    ui.diagnosticPanel.hidden = false;
  });
  ui.diagnosticClose.addEventListener('click', () => { ui.diagnosticPanel.hidden = true; });
  ui.silence.addEventListener('click', snoozeAlarm);
  ui.snoozeListen.addEventListener('click', async () => {
    const rec = callRecordings.find(item => item.id === lastTriggerId);
    ui.snoozePanel.hidden = true;
    if (rec) { await stopListeningForPlayback(); await ensureRunningAudioContext(); await openPlayer(bufferFromSnapshot(audioContext, rec.data, rec.sampleRate)); }
    else if (!listening && audioContext) { try { audioContext.close(); } catch {} audioContext = null; }
  });
  ui.snoozeAck.addEventListener('click', finalizeSnooze);
  ui.playerToggle.addEventListener('click', () => { if (playerIsPlaying) playerPause(); else playerPlay(); });
  ui.playerSeek.addEventListener('input', () => { playerOffset = Number(ui.playerSeek.value); updatePlayerTimeLabel(); if (playerIsPlaying) playerPlay(); });
  ui.playerClose.addEventListener('click', closePlayer);
  ui.playerSpeaker.addEventListener('click', () => {
    loudspeakerOn = !loudspeakerOn;
    ui.playerSpeaker.classList.toggle('active', loudspeakerOn);
    if (playerIsPlaying) playerPlay();
  });
  ui.clearTranscript.addEventListener('click', () => { transcriptRows = []; ui.transcriptHistory.innerHTML = ''; ui.live.textContent = listening ? 'Écoute en cours…' : 'En attente d’une transmission radio…'; });
  ui.clearHistory.addEventListener('click', () => { if (!confirm('Effacer tout l’historique des alertes ?')) return; events = []; save(HISTORY_KEY, events); renderEvents(); renderGraphStats(); });
  ui.ambientButton.addEventListener('click', measureAmbientNoise);
  ui.ambientChartsToggle.addEventListener('click', () => {
    chartsVisible = !chartsVisible;
    ui.ambientCharts.hidden = !chartsVisible;
    ui.ambientChartsToggle.textContent = chartsVisible ? 'MASQUER LES GRAPHIQUES' : 'AFFICHER LES GRAPHIQUES';
    if (chartsVisible) redrawCharts();
  });
  ui.levelChartBlock.addEventListener('click', () => {
    const duration = 3;
    openChartModal({
      title: 'Niveau relatif — dernière mesure', kind: 'level', style: 'line', color: '#36a9ff', unit: '%',
      values: lastLevelSamples, axisLabel: 'Axe X : temps écoulé pendant la mesure (0 à 3 s) — Axe Y : niveau relatif (0 à 100 %)',
      labelFn: i => `t ≈ ${((i / (lastLevelSamples.length - 1 || 1)) * duration).toFixed(1)} s`
    });
  });
  ui.freqChartBlock.addEventListener('click', () => {
    openChartModal({
      title: 'Spectre de fréquences — dernière mesure', kind: 'freq', style: 'bar', color: '#35d07f', unit: '',
      values: lastFreqSnapshot, axisLabel: 'Axe X : fréquence (0 à ~4300 Hz) — Axe Y : amplitude relative (0 à 255, non calibrée)',
      labelFn: i => `${Math.round(i * lastFreqSampleRate / 1024)} Hz`
    });
  });
  ui.baselineChartBlock.addEventListener('click', () => {
    const values = baselineHistory.map(item => item.value);
    openChartModal({
      title: 'Stabilisation de la calibration automatique', kind: 'baseline', style: 'line', color: '#ffb020', unit: '%',
      values, axisLabel: 'Axe X : temps (un point toutes les ~20 s) — Axe Y : référence de bruit ambiant (%)',
      labelFn: i => { const item = baselineHistory[i]; const secondsAgo = item ? Math.round((Date.now() - item.t) / 1000) : 0; return `il y a ${secondsAgo} s`; }
    });
  });
  ui.chartModalClose.addEventListener('click', closeChartModal);
  ui.chartModalCanvas.addEventListener('pointerdown', event => { chartModalDragging = true; handleChartPointer(event); });
  ui.chartModalCanvas.addEventListener('pointermove', event => { if (chartModalDragging) handleChartPointer(event); });
  window.addEventListener('pointerup', () => { chartModalDragging = false; });
  ui.language.value = settings.language; ui.soundSelect.value = settings.sound; ui.cooldown.value = settings.cooldown; ui.cooldownValue.textContent = `${settings.cooldown} s`;
  ui.vibrateToggle.checked = settings.vibrate !== false;
  ui.sensitiveToggle.checked = !!settings.sensitive;
  ui.meterSensitivity.value = settings.meterSensitivity || 5;
  const sensitivityLabels = { 1: 'Très basse', 2: 'Basse', 3: 'Basse', 4: 'Normale-', 5: 'Normale', 6: 'Normale+', 7: 'Haute', 8: 'Haute', 9: 'Très haute', 10: 'Maximale' };
  ui.meterSensitivityValue.textContent = sensitivityLabels[settings.meterSensitivity || 5];
  ui.language.addEventListener('change', () => { settings.language = ui.language.value; save(SETTINGS_KEY, settings); });
  ui.soundSelect.addEventListener('change', () => { settings.sound = ui.soundSelect.value; save(SETTINGS_KEY, settings); });
  ui.vibrateToggle.addEventListener('change', () => { settings.vibrate = ui.vibrateToggle.checked; save(SETTINGS_KEY, settings); });
  ui.sensitiveToggle.addEventListener('change', () => { settings.sensitive = ui.sensitiveToggle.checked; save(SETTINGS_KEY, settings); });
  ui.meterSensitivity.addEventListener('input', () => { settings.meterSensitivity = Number(ui.meterSensitivity.value); ui.meterSensitivityValue.textContent = sensitivityLabels[settings.meterSensitivity]; save(SETTINGS_KEY, settings); });
  ui.cooldown.addEventListener('input', () => { settings.cooldown = Number(ui.cooldown.value); ui.cooldownValue.textContent = `${settings.cooldown} s`; save(SETTINGS_KEY, settings); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && listening) requestWakeLock(); });
  window.addEventListener('beforeunload', () => { if (listening) stopListening(); });
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(console.warn));
  function openSheet(modalEl) { if (modalEl) modalEl.hidden = false; }
  function closeSheet(modalEl) { if (modalEl) modalEl.hidden = true; }
  ui.navSettings.addEventListener('click', () => openSheet(ui.settingsModal));
  ui.navCharts.addEventListener('click', () => { openSheet(ui.chartsModal); renderGraphStats(); });
  ui.navWords.addEventListener('click', () => openSheet(ui.wordsModal));
  ui.navHistory.addEventListener('click', () => openSheet(ui.historyModal));
  ui.settingsClose.addEventListener('click', () => closeSheet(ui.settingsModal));
  ui.chartsClose.addEventListener('click', () => closeSheet(ui.chartsModal));
  ui.wordsClose.addEventListener('click', () => closeSheet(ui.wordsModal));
  ui.historyClose.addEventListener('click', () => closeSheet(ui.historyModal));
  [ui.settingsModal, ui.chartsModal, ui.wordsModal, ui.historyModal].forEach(modalEl => {
    modalEl.addEventListener('click', event => { if (event.target === modalEl) closeSheet(modalEl); });
  });

  // Correctif : sur iOS, une PWA ajoutée à l'écran d'accueil peut voir sa zone visible
  // rétrécir de façon permanente la première fois que le clavier s'ouvre sur un champ
  // texte (ex. dans le panneau Mots), laissant une bande noire en bas jusqu'à fermeture
  // complète de l'app. On force un recalcul de la mise en page après chaque perte de focus.
  let maxViewportHeight = window.innerHeight;
  window.addEventListener('resize', () => { maxViewportHeight = Math.max(maxViewportHeight, window.innerHeight); });
  const viewportVeil = document.createElement('div');
  viewportVeil.style.cssText = 'position:fixed;inset:0;z-index:100000;opacity:0;pointer-events:none;background:rgba(21,17,19,.3);backdrop-filter:blur(26px);-webkit-backdrop-filter:blur(26px);transition:opacity .2s ease-out;';
  document.body.appendChild(viewportVeil);
  function healViewport() {
    if (maxViewportHeight - window.innerHeight <= 4) return;
    const el = ui.appShell;
    if (!el) return;
    el.style.display = 'none';
    void el.offsetHeight;
    el.style.display = '';
  }
  document.addEventListener('blur', event => {
    const tag = event.target && event.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
      setTimeout(() => {
        if (maxViewportHeight - window.innerHeight <= 4) return;
        viewportVeil.style.opacity = '1';
        setTimeout(healViewport, 230);
        setTimeout(() => { viewportVeil.style.transition = 'opacity .55s cubic-bezier(.32,.72,0,1)'; viewportVeil.style.opacity = '0'; }, 380);
      }, 140);
    }
  }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) setTimeout(healViewport, 200); });

  renderGraphStats();
  renderKeywords(); renderEvents(); setStatus(false, 'Prêt à écouter le haut-parleur CB.');
  let startupDiagnostic = '';
  setTimeout(() => {
    ui.appShell.hidden = false;
    ui.splashScreen.classList.add('splash-hide');
    setTimeout(() => { ui.splashScreen.remove(); }, 550);
    setTimeout(() => { startupDiagnostic = runViewportDiagnostic(); }, 300);
  }, 5000);
})();
