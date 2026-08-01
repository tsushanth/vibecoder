/* ===== GAME BOOSTER PRO - Galaxy S25 Ultra ===== */
(function () {
  'use strict';

  // ===== STATE =====
  const state = {
    panelOpen: true,
    boostLevel: 60,
    perfHudVisible: false,
    activeTab: 'performance',
    activeFilter: 'none',
    micActive: false,
    voicePreset: 'normal',
    dndMode: false,
    recording: false,
    recSeconds: 0,
    recInterval: null,
    crosshairOn: false,
    macroOn: false,
    chatFloatOn: false,
    audioContext: null,
    micStream: null,
    analyser: null,
    voiceNodes: {},
    vizAnimId: null,
    perfInterval: null,
    profiles: [],
    selectedProfileIcon: '🎮',
    settings: {
      cpu: true,
      ram: false,
      gpu: true,
      net: false,
      battery: false,
      cooling: false,
      navlock: false,
      touchRate: 240,
      targetFps: 60,
      brightness: 100,
      saturation: 100,
      contrast: 100,
      temperature: 50,
      sharpness: 50,
      aaMode: 'fxaa',
      resScale: 100,
      voicePitch: 0,
      voiceGain: 100,
      voiceReverb: 0,
      voiceDistortion: 0
    }
  };

  // ===== DOM REFS =====
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    panel: $('#overlay-panel'),
    fab: $('#fab-toggle'),
    closeBtn: $('#close-panel'),
    perfHud: $('#perf-hud'),
    boostCircle: $('#boost-circle'),
    boostPct: $('#boost-pct'),
    turboBtn: $('#turbo-btn'),
    clock: $('#clock'),
    batteryPct: $('#battery-pct'),
    optimizeBtn: $('#optimize-btn'),
    fpsVal: $('#fps-value'),
    cpuVal: $('#cpu-value'),
    gpuVal: $('#gpu-value'),
    ramVal: $('#ram-value'),
    tempVal: $('#temp-value'),
    micIcon: $('#mic-icon'),
    micStatus: $('#mic-status-text'),
    voiceVisualizer: $('#voice-visualizer'),
    crosshairOverlay: $('#crosshair-overlay'),
    recIndicator: $('#rec-indicator'),
    recTimer: $('#rec-timer'),
    screenshotFlash: $('#screenshot-flash'),
    toastContainer: $('#toast-container'),
    macroModal: $('#macro-modal'),
    profileModal: $('#profile-modal'),
    profilesList: $('#profiles-list'),
    profileNameInput: $('#profile-name-input'),
    iconPicker: $('#icon-picker')
  };

  // ===== INIT =====
  function init() {
    loadState();
    updateClock();
    setInterval(updateClock, 1000);
    bindTabs();
    bindPanel();
    bindPerformance();
    bindGraphics();
    bindVoice();
    bindTools();
    bindModals();
    bindProfiles();
    applyState();
    togglePanel();
    startPerfMonitor();
  }

  // ===== LOCALSTORAGE =====
  function loadState() {
    try {
      const saved = localStorage.getItem('gb_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        Object.assign(state.settings, parsed);
      }
      const profiles = localStorage.getItem('gb_profiles');
      if (profiles) {
        state.profiles = JSON.parse(profiles);
      }
      const macros = localStorage.getItem('gb_macros');
      if (macros) {
        state.macros = JSON.parse(macros);
      }
    } catch (e) { /* ignore */ }
  }

  function saveState() {
    try {
      localStorage.setItem('gb_settings', JSON.stringify(state.settings));
      localStorage.setItem('gb_profiles', JSON.stringify(state.profiles));
    } catch (e) { /* ignore */ }
  }

  function applyState() {
    // Toggles
    $('#toggle-cpu').checked = state.settings.cpu;
    $('#toggle-ram').checked = state.settings.ram;
    $('#toggle-gpu').checked = state.settings.gpu;
    $('#toggle-net').checked = state.settings.net;
    $('#toggle-battery').checked = state.settings.battery;
    $('#toggle-cooling').checked = state.settings.cooling;
    $('#toggle-navlock').checked = state.settings.navlock;

    // Sliders
    $('#touch-rate').value = state.settings.touchRate;
    $('#touch-rate-val').textContent = state.settings.touchRate + 'Hz';
    $('#target-fps').value = state.settings.targetFps;
    $('#target-fps-val').textContent = state.settings.targetFps + ' FPS';
    $('#brightness').value = state.settings.brightness;
    $('#brightness-val').textContent = state.settings.brightness + '%';
    $('#saturation').value = state.settings.saturation;
    $('#saturation-val').textContent = state.settings.saturation + '%';
    $('#contrast').value = state.settings.contrast;
    $('#contrast-val').textContent = state.settings.contrast + '%';
    $('#temperature').value = state.settings.temperature;
    updateTempLabel(state.settings.temperature);
    $('#sharpness').value = state.settings.sharpness;
    $('#sharpness-val').textContent = state.settings.sharpness + '%';
    $('#aa-mode').value = state.settings.aaMode;
    $('#res-scale').value = state.settings.resScale;
    $('#res-scale-val').textContent = state.settings.resScale + '%';
    $('#voice-pitch').value = state.settings.voicePitch;
    $('#voice-pitch-val').textContent = state.settings.voicePitch;
    $('#voice-gain').value = state.settings.voiceGain;
    $('#voice-gain-val').textContent = state.settings.voiceGain + '%';
    $('#voice-reverb').value = state.settings.voiceReverb;
    $('#voice-reverb-val').textContent = state.settings.voiceReverb + '%';
    $('#voice-distortion').value = state.settings.voiceDistortion;
    $('#voice-distortion-val').textContent = state.settings.voiceDistortion + '%';

    updateBoostLevel();
    renderProfiles();
    loadMacros();
  }

  // ===== CLOCK =====
  function updateClock() {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    dom.clock.textContent = h + ':' + m;
  }

  // ===== PANEL TOGGLE =====
  function bindPanel() {
    dom.fab.addEventListener('click', function () {
      state.panelOpen = !state.panelOpen;
      togglePanel();
    });
    dom.closeBtn.addEventListener('click', function () {
      state.panelOpen = false;
      togglePanel();
    });
  }

  function togglePanel() {
    if (state.panelOpen) {
      dom.panel.classList.remove('hidden');
      dom.fab.classList.add('panel-open');
    } else {
      dom.panel.classList.add('hidden');
      dom.fab.classList.remove('panel-open');
    }
  }

  // ===== TABS =====
  function bindTabs() {
    $$('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const tab = this.dataset.tab;
        if (tab === state.activeTab) return;
        state.activeTab = tab;
        $$('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        $$('.tab-pane').forEach(function (p) { p.classList.remove('active'); });
        $('#tab-' + tab).classList.add('active');
      });
    });
  }

  // ===== BOOST LEVEL =====
  function updateBoostLevel() {
    let level = 20;
    if (state.settings.cpu) level += 15;
    if (state.settings.gpu) level += 15;
    if (state.settings.ram) level += 12;
    if (state.settings.net) level += 10;
    if (state.settings.touchRate >= 240) level += 8;
    if (state.settings.targetFps >= 90) level += 10;
    if (state.settings.cooling) level -= 5;
    if (state.settings.battery) level -= 10;
    level = Math.max(0, Math.min(100, level));
    state.boostLevel = level;

    dom.boostPct.textContent = level;
    const circumference = 2 * Math.PI * 70;
    const offset = circumference * (1 - level / 100);
    dom.boostCircle.setAttribute('stroke-dashoffset', offset);
  }

  // ===== PERFORMANCE TAB =====
  function bindPerformance() {
    // Toggles
    const toggleMap = {
      'toggle-cpu': 'cpu',
      'toggle-ram': 'ram',
      'toggle-gpu': 'gpu',
      'toggle-net': 'net',
      'toggle-battery': 'battery',
      'toggle-cooling': 'cooling',
      'toggle-navlock': 'navlock'
    };

    Object.keys(toggleMap).forEach(function (id) {
      $('#' + id).addEventListener('change', function () {
        state.settings[toggleMap[id]] = this.checked;
        updateBoostLevel();
        saveState();
        const label = id.replace('toggle-', '').toUpperCase();
        showToast(label + (this.checked ? ' Enabled' : ' Disabled'), this.checked ? 'success' : 'info');
      });
    });

    // Touch Rate slider
    $('#touch-rate').addEventListener('input', function () {
      state.settings.touchRate = parseInt(this.value);
      $('#touch-rate-val').textContent = this.value + 'Hz';
      updateBoostLevel();
      saveState();
    });

    // Target FPS slider
    $('#target-fps').addEventListener('input', function () {
      state.settings.targetFps = parseInt(this.value);
      $('#target-fps-val').textContent = this.value + ' FPS';
      updateBoostLevel();
      saveState();
    });

    // Turbo Boost button
    dom.turboBtn.addEventListener('click', function () {
      dom.turboBtn.classList.add('boosting');
      setTimeout(function () { dom.turboBtn.classList.remove('boosting'); }, 700);

      // Enable all performance options
      state.settings.cpu = true;
      state.settings.gpu = true;
      state.settings.ram = true;
      state.settings.net = true;
      state.settings.touchRate = 480;
      state.settings.targetFps = 120;
      state.settings.battery = false;
      state.settings.cooling = false;

      applyState();
      saveState();
      showToast('TURBO BOOST ACTIVATED!', 'success');

      // Show perf HUD
      state.perfHudVisible = true;
      dom.perfHud.classList.remove('hidden');
    });

    // Optimize button
    dom.optimizeBtn.addEventListener('click', function () {
      this.textContent = 'OPTIMIZING...';
      this.style.pointerEvents = 'none';

      // Simulate optimization
      let progress = 0;
      const steps = ['Clearing RAM...', 'Boosting CPU...', 'Optimizing GPU...', 'Tuning Network...', 'DONE!'];
      const intv = setInterval(function () {
        if (progress < steps.length) {
          showToast(steps[progress], 'info');
          progress++;
        } else {
          clearInterval(intv);
          state.settings.ram = true;
          applyState();
          saveState();
          dom.optimizeBtn.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M13 2L3 14h9l-1 10 10-12h-9l1-10z" fill="currentColor"/></svg> ONE-TAP OPTIMIZE';
          dom.optimizeBtn.style.pointerEvents = '';
          state.perfHudVisible = true;
          dom.perfHud.classList.remove('hidden');
        }
      }, 600);
    });
  }

  // ===== PERFORMANCE MONITOR =====
  function startPerfMonitor() {
    state.perfInterval = setInterval(function () {
      if (!state.perfHudVisible) return;

      const targetFps = state.settings.targetFps;
      const fpsBase = state.settings.gpu ? targetFps : targetFps * 0.7;
      const fps = Math.round(fpsBase + (Math.random() * 6 - 3));
      dom.fpsVal.textContent = fps;
      dom.fpsVal.style.color = fps >= targetFps - 5 ? '#00ff88' : fps >= 30 ? '#ff8800' : '#ff3366';

      const cpuBase = state.settings.cpu ? 25 : 55;
      dom.cpuVal.textContent = Math.round(cpuBase + Math.random() * 15) + '%';

      const gpuBase = state.settings.gpu ? 40 : 65;
      dom.gpuVal.textContent = Math.round(gpuBase + Math.random() * 15) + '%';

      const ramBase = state.settings.ram ? 3.2 : 5.8;
      dom.ramVal.textContent = (ramBase + Math.random() * 0.8).toFixed(1) + 'GB';

      const tempBase = state.settings.cooling ? 34 : 38;
      const temp = Math.round(tempBase + Math.random() * 6);
      dom.tempVal.textContent = temp + '°C';
      dom.tempVal.style.color = temp < 40 ? '#00f0ff' : temp < 45 ? '#ff8800' : '#ff3366';
    }, 1000);
  }

  // ===== GRAPHICS TAB =====
  function bindGraphics() {
    // Filter buttons
    $$('.filter-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.filter-btn').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        const filter = this.dataset.filter;

        // Remove old filter
        document.body.className = document.body.className.replace(/filter-\S+/g, '');
        state.activeFilter = filter;
        if (filter !== 'none') {
          document.body.classList.add('filter-' + filter);
          showToast(filter.toUpperCase() + ' filter applied', 'success');
        } else {
          showToast('Filter removed', 'info');
        }
      });
    });

    // Display sliders
    $('#brightness').addEventListener('input', function () {
      state.settings.brightness = parseInt(this.value);
      $('#brightness-val').textContent = this.value + '%';
      saveState();
    });

    $('#saturation').addEventListener('input', function () {
      state.settings.saturation = parseInt(this.value);
      $('#saturation-val').textContent = this.value + '%';
      saveState();
    });

    $('#contrast').addEventListener('input', function () {
      state.settings.contrast = parseInt(this.value);
      $('#contrast-val').textContent = this.value + '%';
      saveState();
    });

    $('#temperature').addEventListener('input', function () {
      state.settings.temperature = parseInt(this.value);
      updateTempLabel(parseInt(this.value));
      saveState();
    });

    $('#sharpness').addEventListener('input', function () {
      state.settings.sharpness = parseInt(this.value);
      $('#sharpness-val').textContent = this.value + '%';
      saveState();
    });

    $('#aa-mode').addEventListener('change', function () {
      state.settings.aaMode = this.value;
      saveState();
      showToast('Anti-Aliasing: ' + this.value.toUpperCase(), 'info');
    });

    $('#res-scale').addEventListener('input', function () {
      state.settings.resScale = parseInt(this.value);
      $('#res-scale-val').textContent = this.value + '%';
      saveState();
    });
  }

  function updateTempLabel(val) {
    let label = 'Neutral';
    if (val < 30) label = 'Cool';
    else if (val < 45) label = 'Slight Cool';
    else if (val > 70) label = 'Warm';
    else if (val > 55) label = 'Slight Warm';
    $('#temperature-val').textContent = label;
  }

  // ===== VOICE CHANGER =====
  function bindVoice() {
    // Mic toggle
    dom.micIcon.addEventListener('click', function () {
      if (state.micActive) {
        stopMic();
      } else {
        startMic();
      }
    });

    // Voice presets
    $$('.voice-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.voice-btn').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        state.voicePreset = this.dataset.voice;
        applyVoicePreset(this.dataset.voice);
        showToast('Voice: ' + this.textContent.trim(), 'info');
      });
    });

    // Voice sliders
    $('#voice-pitch').addEventListener('input', function () {
      state.settings.voicePitch = parseInt(this.value);
      $('#voice-pitch-val').textContent = this.value;
      updateVoiceEffect();
      saveState();
    });

    $('#voice-gain').addEventListener('input', function () {
      state.settings.voiceGain = parseInt(this.value);
      $('#voice-gain-val').textContent = this.value + '%';
      updateVoiceEffect();
      saveState();
    });

    $('#voice-reverb').addEventListener('input', function () {
      state.settings.voiceReverb = parseInt(this.value);
      $('#voice-reverb-val').textContent = this.value + '%';
      updateVoiceEffect();
      saveState();
    });

    $('#voice-distortion').addEventListener('input', function () {
      state.settings.voiceDistortion = parseInt(this.value);
      $('#voice-distortion-val').textContent = this.value + '%';
      updateVoiceEffect();
      saveState();
    });
  }

  function applyVoicePreset(preset) {
    const presets = {
      normal:  { pitch: 0,   gain: 100, reverb: 0,   distortion: 0   },
      deep:    { pitch: -8,  gain: 120, reverb: 15,  distortion: 0   },
      high:    { pitch: 10,  gain: 110, reverb: 0,   distortion: 0   },
      robot:   { pitch: -3,  gain: 100, reverb: 20,  distortion: 50  },
      echo:    { pitch: 0,   gain: 100, reverb: 80,  distortion: 0   },
      alien:   { pitch: 6,   gain: 90,  reverb: 40,  distortion: 30  },
      demon:   { pitch: -12, gain: 140, reverb: 30,  distortion: 40  },
      radio:   { pitch: 0,   gain: 80,  reverb: 5,   distortion: 20  }
    };

    const p = presets[preset] || presets.normal;
    state.settings.voicePitch = p.pitch;
    state.settings.voiceGain = p.gain;
    state.settings.voiceReverb = p.reverb;
    state.settings.voiceDistortion = p.distortion;

    $('#voice-pitch').value = p.pitch;
    $('#voice-pitch-val').textContent = p.pitch;
    $('#voice-gain').value = p.gain;
    $('#voice-gain-val').textContent = p.gain + '%';
    $('#voice-reverb').value = p.reverb;
    $('#voice-reverb-val').textContent = p.reverb + '%';
    $('#voice-distortion').value = p.distortion;
    $('#voice-distortion-val').textContent = p.distortion + '%';

    updateVoiceEffect();
    saveState();
  }

  async function startMic() {
    try {
      state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      state.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const source = state.audioContext.createMediaStreamSource(state.micStream);

      // Gain node
      const gainNode = state.audioContext.createGain();
      gainNode.gain.value = state.settings.voiceGain / 100;

      // Analyser
      state.analyser = state.audioContext.createAnalyser();
      state.analyser.fftSize = 64;

      // Pitch shift via playback rate on buffer (simplified: using oscillator modulation)
      // For real pitch shifting we use a delay-based approach
      const delayNode = state.audioContext.createDelay();
      delayNode.delayTime.value = 0.01;

      // WaveShaper for distortion
      const distortion = state.audioContext.createWaveShaper();
      distortion.curve = makeDistortionCurve(state.settings.voiceDistortion * 4);

      // Convolver for reverb
      const convolver = state.audioContext.createConvolver();
      convolver.buffer = createReverbImpulse(state.audioContext, state.settings.voiceReverb / 100 * 3);

      // Biquad filter for pitch simulation
      const biquadFilter = state.audioContext.createBiquadFilter();
      biquadFilter.type = 'allpass';
      const pitchVal = state.settings.voicePitch;
      biquadFilter.frequency.value = 1000 + pitchVal * 200;

      // Connect chain
      source.connect(gainNode);
      gainNode.connect(biquadFilter);
      biquadFilter.connect(distortion);

      if (state.settings.voiceReverb > 0) {
        const dryGain = state.audioContext.createGain();
        const wetGain = state.audioContext.createGain();
        dryGain.gain.value = 1 - state.settings.voiceReverb / 200;
        wetGain.gain.value = state.settings.voiceReverb / 100;

        distortion.connect(dryGain);
        distortion.connect(convolver);
        convolver.connect(wetGain);
        dryGain.connect(state.analyser);
        wetGain.connect(state.analyser);
      } else {
        distortion.connect(state.analyser);
      }

      state.analyser.connect(state.audioContext.destination);

      state.voiceNodes = { source, gainNode, biquadFilter, distortion, convolver, delayNode };

      state.micActive = true;
      dom.micIcon.classList.add('active');
      dom.micStatus.textContent = 'Mic Active — Voice Changing';
      dom.voiceVisualizer.classList.add('active');
      startVisualizer();
      showToast('Microphone activated', 'success');
    } catch (e) {
      showToast('Mic access denied or unavailable', 'error');
      // Simulate visualizer anyway for demo
      state.micActive = true;
      dom.micIcon.classList.add('active');
      dom.micStatus.textContent = 'Demo Mode (no mic access)';
      dom.voiceVisualizer.classList.add('active');
      startDemoVisualizer();
    }
  }

  function stopMic() {
    state.micActive = false;
    dom.micIcon.classList.remove('active');
    dom.micStatus.textContent = 'Tap to activate mic';
    dom.voiceVisualizer.classList.remove('active');

    if (state.vizAnimId) {
      cancelAnimationFrame(state.vizAnimId);
      state.vizAnimId = null;
    }

    if (state.micStream) {
      state.micStream.getTracks().forEach(function (t) { t.stop(); });
      state.micStream = null;
    }

    if (state.audioContext) {
      state.audioContext.close();
      state.audioContext = null;
    }

    showToast('Microphone deactivated', 'info');
  }

  function updateVoiceEffect() {
    if (!state.voiceNodes.gainNode) return;
    state.voiceNodes.gainNode.gain.value = state.settings.voiceGain / 100;
    if (state.voiceNodes.biquadFilter) {
      state.voiceNodes.biquadFilter.frequency.value = 1000 + state.settings.voicePitch * 200;
    }
    if (state.voiceNodes.distortion) {
      state.voiceNodes.distortion.curve = makeDistortionCurve(state.settings.voiceDistortion * 4);
    }
  }

  function makeDistortionCurve(amount) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      if (amount === 0) {
        curve[i] = x;
      } else {
        curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
      }
    }
    return curve;
  }

  function createReverbImpulse(ctx, duration) {
    const rate = ctx.sampleRate;
    const length = rate * Math.max(0.1, duration);
    const impulse = ctx.createBuffer(2, length, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2);
      }
    }
    return impulse;
  }

  function startVisualizer() {
    if (!state.analyser) return;
    const bars = dom.voiceVisualizer.querySelectorAll('.viz-bar');
    const bufferLength = state.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
      if (!state.micActive) return;
      state.vizAnimId = requestAnimationFrame(draw);
      state.analyser.getByteFrequencyData(dataArray);
      bars.forEach(function (bar, i) {
        const idx = Math.floor((i / bars.length) * bufferLength);
        const val = dataArray[idx] || 0;
        const height = Math.max(4, (val / 255) * 32);
        bar.style.height = height + 'px';
        const hue = 180 + (val / 255) * 60;
        bar.style.background = 'hsl(' + hue + ', 100%, 60%)';
      });
    }
    draw();
  }

  function startDemoVisualizer() {
    const bars = dom.voiceVisualizer.querySelectorAll('.viz-bar');
    function draw() {
      if (!state.micActive) return;
      state.vizAnimId = requestAnimationFrame(draw);
      bars.forEach(function (bar) {
        const height = 4 + Math.random() * 24;
        bar.style.height = height + 'px';
        const hue = 180 + Math.random() * 60;
        bar.style.background = 'hsl(' + hue + ', 100%, 60%)';
      });
    }
    draw();
  }

  // ===== TOOLS TAB =====
  function bindTools() {
    // DND
    $('#tool-dnd').addEventListener('click', function () {
      state.dndMode = !state.dndMode;
      this.classList.toggle('active', state.dndMode);
      $('#dnd-status').textContent = state.dndMode ? 'ON' : 'OFF';
      showToast('Do Not Disturb ' + (state.dndMode ? 'enabled' : 'disabled'), state.dndMode ? 'success' : 'info');
    });

    // Screenshot
    $('#tool-screenshot').addEventListener('click', function () {
      takeScreenshot();
    });

    // Screen Record
    $('#tool-record').addEventListener('click', function () {
      state.recording = !state.recording;
      this.classList.toggle('active', state.recording);
      $('#rec-status').textContent = state.recording ? 'REC' : 'OFF';
      if (state.recording) {
        startRecording();
      } else {
        stopRecording();
      }
    });

    // Crosshair
    $('#tool-crosshair').addEventListener('click', function () {
      state.crosshairOn = !state.crosshairOn;
      this.classList.toggle('active', state.crosshairOn);
      $('#crosshair-status').textContent = state.crosshairOn ? 'ON' : 'OFF';
      dom.crosshairOverlay.classList.toggle('hidden', !state.crosshairOn);
      showToast('Crosshair ' + (state.crosshairOn ? 'enabled' : 'disabled'), state.crosshairOn ? 'success' : 'info');
    });

    // Macro
    $('#tool-macro').addEventListener('click', function () {
      state.macroOn = !state.macroOn;
      if (state.macroOn) {
        dom.macroModal.classList.remove('hidden');
      }
      this.classList.toggle('active', state.macroOn);
      $('#macro-status').textContent = state.macroOn ? 'ON' : 'OFF';
      if (!state.macroOn) {
        showToast('Macros disabled', 'info');
      }
    });

    // Chat Float
    $('#tool-floating').addEventListener('click', function () {
      state.chatFloatOn = !state.chatFloatOn;
      this.classList.toggle('active', state.chatFloatOn);
      $('#float-status').textContent = state.chatFloatOn ? 'ON' : 'OFF';
      showToast('Chat Float ' + (state.chatFloatOn ? 'enabled' : 'disabled'), state.chatFloatOn ? 'success' : 'info');
    });
  }

  function takeScreenshot() {
    dom.screenshotFlash.classList.add('flash');
    // Play camera shutter sound
    playSound('shutter');
    setTimeout(function () {
      dom.screenshotFlash.classList.remove('flash');
      showToast('Screenshot captured!', 'success');
    }, 200);
  }

  function startRecording() {
    state.recSeconds = 0;
    dom.recIndicator.classList.remove('hidden');
    dom.recTimer.textContent = '00:00';
    state.recInterval = setInterval(function () {
      state.recSeconds++;
      const mins = Math.floor(state.recSeconds / 60).toString().padStart(2, '0');
      const secs = (state.recSeconds % 60).toString().padStart(2, '0');
      dom.recTimer.textContent = mins + ':' + secs;
    }, 1000);
    showToast('Recording started', 'success');
    playSound('beep');
  }

  function stopRecording() {
    clearInterval(state.recInterval);
    dom.recIndicator.classList.add('hidden');
    showToast('Recording saved (' + dom.recTimer.textContent + ')', 'success');
    playSound('beep');
  }

  // ===== SOUND EFFECTS =====
  function playSound(type) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'shutter') {
        osc.type = 'square';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
      } else if (type === 'beep') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
      } else if (type === 'boost') {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(200, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.4);
      }

      setTimeout(function () { ctx.close(); }, 500);
    } catch (e) { /* no sound support */ }
  }

  // ===== MODALS =====
  function bindModals() {
    // Macro modal
    $('#macro-modal-close').addEventListener('click', function () {
      dom.macroModal.classList.add('hidden');
    });

    dom.macroModal.addEventListener('click', function (e) {
      if (e.target === dom.macroModal) dom.macroModal.classList.add('hidden');
    });

    $('#save-macros-btn').addEventListener('click', function () {
      saveMacros();
      dom.macroModal.classList.add('hidden');
      showToast('Macros saved!', 'success');
    });

    // Profile modal
    $('#profile-modal-close').addEventListener('click', function () {
      dom.profileModal.classList.add('hidden');
    });

    dom.profileModal.addEventListener('click', function (e) {
      if (e.target === dom.profileModal) dom.profileModal.classList.add('hidden');
    });

    // Icon picker
    $$('.icon-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        $$('.icon-opt').forEach(function (b) { b.classList.remove('active'); });
        this.classList.add('active');
        state.selectedProfileIcon = this.dataset.icon;
      });
    });
  }

  // ===== MACROS =====
  function saveMacros() {
    const macros = [];
    $$('.macro-slot').forEach(function (slot) {
      macros.push({
        slot: slot.dataset.slot,
        name: slot.querySelector('.macro-input').value,
        action: slot.querySelector('.macro-action').value
      });
    });
    state.macros = macros;
    try {
      localStorage.setItem('gb_macros', JSON.stringify(macros));
    } catch (e) { /* ignore */ }
  }

  function loadMacros() {
    if (!state.macros) return;
    state.macros.forEach(function (m) {
      const slot = document.querySelector('.macro-slot[data-slot="' + m.slot + '"]');
      if (slot) {
        slot.querySelector('.macro-input').value = m.name || '';
        slot.querySelector('.macro-action').value = m.action || 'none';
      }
    });
  }

  // ===== PROFILES =====
  function bindProfiles() {
    $('#save-profile-btn').addEventListener('click', function () {
      dom.profileModal.classList.remove('hidden');
      dom.profileNameInput.value = '';
      dom.profileNameInput.focus();
    });

    $('#confirm-save-profile').addEventListener('click', function () {
      const name = dom.profileNameInput.value.trim();
      if (!name) {
        showToast('Please enter a profile name', 'error');
        return;
      }

      const profile = {
        id: Date.now(),
        name: name,
        icon: state.selectedProfileIcon,
        settings: JSON.parse(JSON.stringify(state.settings)),
        filter: state.activeFilter,
        voicePreset: state.voicePreset,
        date: new Date().toLocaleDateString()
      };

      state.profiles.push(profile);
      saveState();
      renderProfiles();
      dom.profileModal.classList.add('hidden');
      showToast('Profile "' + name + '" saved!', 'success');
    });
  }

  function renderProfiles() {
    if (state.profiles.length === 0) {
      dom.profilesList.innerHTML = '<div class="empty-profiles">No saved profiles. Customize settings and save a profile!</div>';
      return;
    }

    dom.profilesList.innerHTML = '';
    state.profiles.forEach(function (profile) {
      const item = document.createElement('div');
      item.className = 'profile-item';
      item.innerHTML =
        '<span class="profile-icon">' + profile.icon + '</span>' +
        '<div class="profile-info">' +
          '<span class="profile-name">' + escapeHtml(profile.name) + '</span>' +
          '<span class="profile-meta">Saved ' + profile.date + '</span>' +
        '</div>' +
        '<button class="profile-delete" data-id="' + profile.id + '">✕</button>';

      // Load profile on tap
      item.addEventListener('click', function (e) {
        if (e.target.classList.contains('profile-delete')) return;
        loadProfile(profile);
      });

      // Delete button
      item.querySelector('.profile-delete').addEventListener('click', function (e) {
        e.stopPropagation();
        deleteProfile(profile.id);
      });

      dom.profilesList.appendChild(item);
    });
  }

  function loadProfile(profile) {
    Object.assign(state.settings, profile.settings);
    state.voicePreset = profile.voicePreset || 'normal';

    // Apply filter
    document.body.className = document.body.className.replace(/filter-\S+/g, '');
    state.activeFilter = profile.filter || 'none';
    if (state.activeFilter !== 'none') {
      document.body.classList.add('filter-' + state.activeFilter);
    }
    $$('.filter-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.filter === state.activeFilter);
    });

    // Apply voice preset
    $$('.voice-btn').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.voice === state.voicePreset);
    });

    applyState();
    saveState();
    showToast('Profile "' + profile.name + '" loaded!', 'success');
    playSound('boost');
  }

  function deleteProfile(id) {
    state.profiles = state.profiles.filter(function (p) { return p.id !== id; });
    saveState();
    renderProfiles();
    showToast('Profile deleted', 'info');
  }

  // ===== TOAST NOTIFICATIONS =====
  function showToast(msg, type) {
    const toast = document.createElement('div');
    toast.className = 'toast ' + (type || '');
    toast.textContent = msg;
    dom.toastContainer.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }

  // ===== UTILITY =====
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ===== START =====
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
