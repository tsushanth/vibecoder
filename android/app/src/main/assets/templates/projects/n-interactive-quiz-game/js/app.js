/* ============================================================
   QuizMaster — Fully self-contained quiz game
   ============================================================ */

(function () {
  'use strict';

  // ─── Question Bank ───────────────────────────────────────────
  const QUESTIONS = {
    general: [
      { q: "What is the largest organ in the human body?", o: ["Skin", "Liver", "Heart", "Brain"], a: 0 },
      { q: "How many planets are in our solar system?", o: ["7", "8", "9", "10"], a: 1 },
      { q: "What gas do plants absorb from the atmosphere?", o: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Hydrogen"], a: 2 },
      { q: "In which year did the Titanic sink?", o: ["1905", "1912", "1918", "1923"], a: 1 },
      { q: "What is the hardest natural substance on Earth?", o: ["Gold", "Iron", "Diamond", "Platinum"], a: 2 },
      { q: "How many bones are in the adult human body?", o: ["186", "206", "226", "256"], a: 1 },
      { q: "Which planet is known as the Red Planet?", o: ["Venus", "Jupiter", "Mars", "Saturn"], a: 2 },
      { q: "What is the chemical symbol for water?", o: ["H2O", "CO2", "NaCl", "O2"], a: 0 },
      { q: "Which ocean is the largest?", o: ["Atlantic", "Indian", "Arctic", "Pacific"], a: 3 },
      { q: "What is the smallest prime number?", o: ["0", "1", "2", "3"], a: 2 },
      { q: "How many continents are there?", o: ["5", "6", "7", "8"], a: 2 },
      { q: "What is the boiling point of water in Celsius?", o: ["90°C", "100°C", "110°C", "120°C"], a: 1 },
      { q: "Which animal is known as the King of the Jungle?", o: ["Tiger", "Lion", "Elephant", "Bear"], a: 1 },
      { q: "What color are emeralds?", o: ["Blue", "Red", "Green", "Purple"], a: 2 },
      { q: "How many days are in a leap year?", o: ["364", "365", "366", "367"], a: 2 },
    ],
    science: [
      { q: "What is the chemical symbol for gold?", o: ["Go", "Gd", "Au", "Ag"], a: 2 },
      { q: "What planet has the most moons?", o: ["Jupiter", "Saturn", "Uranus", "Neptune"], a: 1 },
      { q: "What is the speed of light approximately?", o: ["300,000 km/s", "150,000 km/s", "500,000 km/s", "1,000,000 km/s"], a: 0 },
      { q: "What is the powerhouse of the cell?", o: ["Nucleus", "Ribosome", "Mitochondria", "Golgi body"], a: 2 },
      { q: "What element has the atomic number 1?", o: ["Helium", "Hydrogen", "Lithium", "Carbon"], a: 1 },
      { q: "How many elements are in the periodic table?", o: ["108", "112", "118", "124"], a: 2 },
      { q: "What is the most abundant gas in Earth's atmosphere?", o: ["Oxygen", "Carbon Dioxide", "Nitrogen", "Argon"], a: 2 },
      { q: "What force keeps us on the ground?", o: ["Magnetism", "Friction", "Gravity", "Inertia"], a: 2 },
      { q: "What is the freezing point of water in Fahrenheit?", o: ["0°F", "32°F", "100°F", "212°F"], a: 1 },
      { q: "What type of animal is a dolphin?", o: ["Fish", "Reptile", "Mammal", "Amphibian"], a: 2 },
      { q: "Which vitamin is produced when skin is exposed to sunlight?", o: ["Vitamin A", "Vitamin B", "Vitamin C", "Vitamin D"], a: 3 },
      { q: "What is the closest star to Earth?", o: ["Sirius", "Alpha Centauri", "The Sun", "Betelgeuse"], a: 2 },
      { q: "What part of the atom has a negative charge?", o: ["Proton", "Neutron", "Electron", "Nucleus"], a: 2 },
      { q: "What gas do humans exhale?", o: ["Oxygen", "Nitrogen", "Carbon Dioxide", "Helium"], a: 2 },
      { q: "DNA stands for deoxyribonucleic ___?", o: ["Acid", "Alkaline", "Atom", "Agent"], a: 0 },
    ],
    history: [
      { q: "Who painted the Mona Lisa?", o: ["Michelangelo", "Da Vinci", "Raphael", "Rembrandt"], a: 1 },
      { q: "In which year did World War II end?", o: ["1943", "1944", "1945", "1946"], a: 2 },
      { q: "Who was the first person to walk on the Moon?", o: ["Buzz Aldrin", "Neil Armstrong", "Yuri Gagarin", "John Glenn"], a: 1 },
      { q: "What ancient civilization built the pyramids of Giza?", o: ["Romans", "Greeks", "Egyptians", "Persians"], a: 2 },
      { q: "Which country gifted the Statue of Liberty to the USA?", o: ["England", "Spain", "France", "Italy"], a: 2 },
      { q: "What was the name of the ship the Pilgrims sailed to America?", o: ["Santa Maria", "Mayflower", "Endeavour", "Victoria"], a: 1 },
      { q: "Who discovered penicillin?", o: ["Pasteur", "Fleming", "Curie", "Darwin"], a: 1 },
      { q: "The Great Wall of China was primarily built to protect against whom?", o: ["Japanese", "Mongols", "Russians", "Koreans"], a: 1 },
      { q: "Who was the first President of the United States?", o: ["Adams", "Jefferson", "Washington", "Lincoln"], a: 2 },
      { q: "In what year did the Berlin Wall fall?", o: ["1987", "1988", "1989", "1990"], a: 2 },
      { q: "What empire was ruled by Julius Caesar?", o: ["Greek", "Persian", "Roman", "Ottoman"], a: 2 },
      { q: "Who wrote 'Romeo and Juliet'?", o: ["Dickens", "Shakespeare", "Austen", "Twain"], a: 1 },
      { q: "Which war was fought between the North and South in the US?", o: ["WWI", "WWII", "Civil War", "Revolutionary War"], a: 2 },
      { q: "What year did the French Revolution begin?", o: ["1776", "1789", "1799", "1812"], a: 1 },
      { q: "Which explorer is credited with discovering America?", o: ["Magellan", "Columbus", "Cortez", "Drake"], a: 1 },
    ],
    tech: [
      { q: "What does HTML stand for?", o: ["Hyper Text Markup Language", "High Tech Modern Language", "Hyper Transfer Markup Language", "Home Tool Markup Language"], a: 0 },
      { q: "Who is the co-founder of Apple?", o: ["Bill Gates", "Steve Jobs", "Elon Musk", "Jeff Bezos"], a: 1 },
      { q: "What does CPU stand for?", o: ["Central Processing Unit", "Computer Personal Unit", "Central Program Utility", "Core Processing Unit"], a: 0 },
      { q: "In what year was the first iPhone released?", o: ["2005", "2006", "2007", "2008"], a: 2 },
      { q: "What programming language is known as the 'language of the web'?", o: ["Python", "Java", "JavaScript", "C++"], a: 2 },
      { q: "What does URL stand for?", o: ["Universal Resource Locator", "Uniform Resource Locator", "Universal Reference Link", "Unified Resource Locator"], a: 1 },
      { q: "Which company developed the Android operating system?", o: ["Apple", "Microsoft", "Google", "Samsung"], a: 2 },
      { q: "What does RAM stand for?", o: ["Random Access Memory", "Read Access Memory", "Rapid Access Module", "Run Access Memory"], a: 0 },
      { q: "Who founded Microsoft?", o: ["Steve Jobs", "Bill Gates", "Mark Zuckerberg", "Larry Page"], a: 1 },
      { q: "What is the binary system based on?", o: ["0 and 1", "1 and 2", "0 and 9", "A and Z"], a: 0 },
      { q: "What does Wi-Fi stand for?", o: ["Wireless Fidelity", "Wide Frequency", "Wired Filter", "None — it's a brand name"], a: 3 },
      { q: "Which company created the first computer mouse?", o: ["IBM", "Apple", "Xerox", "Microsoft"], a: 2 },
      { q: "What year was Google founded?", o: ["1996", "1998", "2000", "2002"], a: 1 },
      { q: "What does GPS stand for?", o: ["Global Positioning System", "General Positioning Service", "Geographic Placement System", "Global Programming System"], a: 0 },
      { q: "What is the main function of a firewall in computing?", o: ["Cool hardware", "Block unauthorized access", "Speed up internet", "Store data"], a: 1 },
    ],
    geography: [
      { q: "What is the capital of Japan?", o: ["Seoul", "Beijing", "Tokyo", "Bangkok"], a: 2 },
      { q: "Which is the longest river in the world?", o: ["Amazon", "Nile", "Mississippi", "Yangtze"], a: 1 },
      { q: "What is the largest desert in the world?", o: ["Sahara", "Gobi", "Antarctic", "Arabian"], a: 2 },
      { q: "Which country has the most population?", o: ["USA", "India", "China", "Indonesia"], a: 1 },
      { q: "What is the smallest country in the world?", o: ["Monaco", "Vatican City", "San Marino", "Liechtenstein"], a: 1 },
      { q: "On which continent is Brazil?", o: ["Africa", "Europe", "North America", "South America"], a: 3 },
      { q: "What mountain is the tallest in the world?", o: ["K2", "Kangchenjunga", "Everest", "Lhotse"], a: 2 },
      { q: "Which country is known as the Land of the Rising Sun?", o: ["China", "Japan", "Korea", "Thailand"], a: 1 },
      { q: "What is the capital of Australia?", o: ["Sydney", "Melbourne", "Canberra", "Brisbane"], a: 2 },
      { q: "Which sea is the saltiest in the world?", o: ["Red Sea", "Dead Sea", "Caspian Sea", "Mediterranean"], a: 1 },
      { q: "How many time zones does Russia have?", o: ["5", "8", "11", "14"], a: 2 },
      { q: "What is the largest island in the world?", o: ["Borneo", "Madagascar", "Greenland", "New Guinea"], a: 2 },
      { q: "Which African country was formerly known as Abyssinia?", o: ["Kenya", "Ethiopia", "Somalia", "Sudan"], a: 1 },
      { q: "The Amazon Rainforest is in which continent?", o: ["Africa", "Asia", "South America", "Australia"], a: 2 },
      { q: "What is the capital of Canada?", o: ["Toronto", "Vancouver", "Montreal", "Ottawa"], a: 3 },
    ],
  };

  const CATEGORY_NAMES = {
    general: "General Knowledge",
    science: "Science & Nature",
    history: "History",
    tech: "Technology",
    geography: "Geography",
  };

  const TIMER_SECONDS = { easy: 20, medium: 15, hard: 10 };
  const QUESTIONS_PER_QUIZ = 10;

  // ─── State ───────────────────────────────────────────────────
  let state = {
    category: 'general',
    difficulty: 'easy',
    questions: [],
    current: 0,
    score: 0,
    answers: [],       // { selected, correct, timedOut, timeUsed }
    streak: 0,
    bestStreak: 0,
    timerInterval: null,
    timeLeft: 0,
    totalTime: 0,
    answering: false,
  };

  // ─── DOM References ──────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const screens = {
    start: $('#screen-start'),
    quiz: $('#screen-quiz'),
    results: $('#screen-results'),
  };

  // ─── Utility ─────────────────────────────────────────────────
  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
  }

  function playSound(type) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.value = 0.12;

      if (type === 'correct') {
        osc.frequency.value = 523.25;
        osc.type = 'sine';
        osc.start();
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.2);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.25);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.stop(ctx.currentTime + 0.4);
      } else if (type === 'wrong') {
        osc.frequency.value = 330;
        osc.type = 'sawtooth';
        gain.gain.value = 0.08;
        osc.start();
        osc.frequency.setValueAtTime(220, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.08, ctx.currentTime + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
        osc.stop(ctx.currentTime + 0.35);
      } else if (type === 'tick') {
        osc.frequency.value = 880;
        osc.type = 'sine';
        gain.gain.value = 0.04;
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
        osc.stop(ctx.currentTime + 0.06);
      } else if (type === 'complete') {
        osc.frequency.value = 523.25;
        osc.type = 'sine';
        osc.start();
        osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.15);
        osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.3);
        osc.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.45);
        gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.55);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.stop(ctx.currentTime + 0.8);
      }
    } catch (_) { /* audio not supported — silent fallback */ }
  }

  // ─── Confetti ────────────────────────────────────────────────
  function spawnConfetti(containerId, count) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#6c5ce7', '#fd79a8', '#00b894', '#fdcb6e', '#e17055', '#0984e3', '#a29bfe', '#55efc4'];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.left = Math.random() * 100 + '%';
      piece.style.background = colors[Math.floor(Math.random() * colors.length)];
      piece.style.width = (Math.random() * 8 + 6) + 'px';
      piece.style.height = (Math.random() * 8 + 6) + 'px';
      piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
      piece.style.animationDuration = (Math.random() * 2 + 2) + 's';
      piece.style.animationDelay = (Math.random() * 1.5) + 's';
      container.appendChild(piece);
    }
    setTimeout(() => { container.innerHTML = ''; }, 5000);
  }

  // ─── localStorage helpers ────────────────────────────────────
  function loadStats() {
    try {
      return JSON.parse(localStorage.getItem('quizmaster_stats')) || { played: 0, bestScore: 0, totalCorrect: 0, totalQuestions: 0 };
    } catch (_) {
      return { played: 0, bestScore: 0, totalCorrect: 0, totalQuestions: 0 };
    }
  }

  function saveStats(correct, total) {
    const stats = loadStats();
    stats.played++;
    stats.totalCorrect += correct;
    stats.totalQuestions += total;
    const pct = Math.round((correct / total) * 100);
    if (pct > stats.bestScore) stats.bestScore = pct;
    try { localStorage.setItem('quizmaster_stats', JSON.stringify(stats)); } catch (_) {}
  }

  function showStatsPreview() {
    const stats = loadStats();
    const el = $('#stats-preview');
    if (stats.played === 0) {
      el.textContent = '';
      return;
    }
    const avg = stats.totalQuestions > 0 ? Math.round((stats.totalCorrect / stats.totalQuestions) * 100) : 0;
    el.textContent = `Games played: ${stats.played}  |  Best: ${stats.bestScore}%  |  Avg: ${avg}%`;
  }

  // ─── Start Screen Logic ─────────────────────────────────────
  function initStartScreen() {
    showStatsPreview();

    // Category select
    $('#category').addEventListener('change', (e) => {
      state.category = e.target.value;
    });

    // Difficulty buttons
    $$('.diff-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('.diff-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.difficulty = btn.dataset.diff;
      });
    });

    // Start button
    $('#btn-start').addEventListener('click', startQuiz);
  }

  // ─── Start Quiz ──────────────────────────────────────────────
  function startQuiz() {
    const pool = QUESTIONS[state.category];
    state.questions = shuffle(pool).slice(0, QUESTIONS_PER_QUIZ);
    state.current = 0;
    state.score = 0;
    state.answers = [];
    state.streak = 0;
    state.bestStreak = 0;
    state.totalTime = 0;
    state.answering = false;

    showScreen('quiz');
    loadQuestion();
  }

  // ─── Load Question ───────────────────────────────────────────
  function loadQuestion() {
    const q = state.questions[state.current];
    const total = state.questions.length;

    $('#question-counter').textContent = `${state.current + 1} / ${total}`;
    $('#score-display').textContent = `Score: ${state.score}`;
    $('#progress-fill').style.width = `${(state.current / total) * 100}%`;
    $('#category-badge').textContent = CATEGORY_NAMES[state.category];
    $('#question-text').textContent = q.q;

    // Set options
    const optBtns = $$('.option-btn');
    optBtns.forEach((btn, i) => {
      btn.className = 'option-btn';
      btn.querySelector('.option-text').textContent = q.o[i];
      btn.style.animation = 'none';
      btn.offsetHeight; // force reflow
      btn.style.animation = '';
    });

    // Reset feedback
    $('#feedback-overlay').classList.remove('show');

    // Start timer
    state.answering = true;
    startTimer();
  }

  // ─── Timer ───────────────────────────────────────────────────
  function startTimer() {
    clearInterval(state.timerInterval);
    const maxTime = TIMER_SECONDS[state.difficulty];
    state.timeLeft = maxTime;
    const timerFill = $('#timer-fill');
    const timerText = $('#timer-text');

    timerFill.style.width = '100%';
    timerText.textContent = maxTime + 's';
    timerText.classList.remove('urgent');

    state.timerInterval = setInterval(() => {
      state.timeLeft -= 0.1;
      if (state.timeLeft <= 0) {
        state.timeLeft = 0;
        clearInterval(state.timerInterval);
        handleTimeout();
      }
      const pct = (state.timeLeft / maxTime) * 100;
      timerFill.style.width = pct + '%';
      timerText.textContent = Math.ceil(state.timeLeft) + 's';

      if (state.timeLeft <= 5) {
        timerText.classList.add('urgent');
        if (Math.ceil(state.timeLeft) !== Math.ceil(state.timeLeft + 0.1)) {
          playSound('tick');
        }
      }
    }, 100);
  }

  function handleTimeout() {
    if (!state.answering) return;
    state.answering = false;

    const q = state.questions[state.current];
    const maxTime = TIMER_SECONDS[state.difficulty];

    state.answers.push({ selected: -1, correct: q.a, timedOut: true, timeUsed: maxTime });
    state.totalTime += maxTime;
    state.streak = 0;

    // Highlight correct answer
    const optBtns = $$('.option-btn');
    optBtns.forEach((btn, i) => {
      btn.classList.add('disabled');
      if (i === q.a) btn.classList.add('correct');
    });

    showFeedback(false, true);
    playSound('wrong');

    setTimeout(nextQuestion, 1800);
  }

  // ─── Answer Handling ─────────────────────────────────────────
  function handleAnswer(index) {
    if (!state.answering) return;
    state.answering = false;
    clearInterval(state.timerInterval);

    const q = state.questions[state.current];
    const maxTime = TIMER_SECONDS[state.difficulty];
    const timeUsed = parseFloat((maxTime - state.timeLeft).toFixed(1));
    const isCorrect = index === q.a;

    state.answers.push({ selected: index, correct: q.a, timedOut: false, timeUsed });
    state.totalTime += timeUsed;

    if (isCorrect) {
      state.score++;
      state.streak++;
      if (state.streak > state.bestStreak) state.bestStreak = state.streak;
      playSound('correct');
    } else {
      state.streak = 0;
      playSound('wrong');
    }

    // Highlight buttons
    const optBtns = $$('.option-btn');
    optBtns.forEach((btn, i) => {
      btn.classList.add('disabled');
      if (i === q.a) btn.classList.add('correct');
      if (i === index && !isCorrect) btn.classList.add('wrong');
    });

    showFeedback(isCorrect, false);

    setTimeout(nextQuestion, 1500);
  }

  function showFeedback(isCorrect, timedOut) {
    const overlay = $('#feedback-overlay');
    const icon = $('#feedback-icon');
    const text = $('#feedback-text');

    if (timedOut) {
      icon.textContent = '⏰';
      text.textContent = "Time's up!";
      text.style.color = '#fdcb6e';
    } else if (isCorrect) {
      icon.textContent = '✅';
      const msgs = ['Correct!', 'Nice one!', 'You got it!', 'Brilliant!', 'Perfect!'];
      text.textContent = msgs[Math.floor(Math.random() * msgs.length)];
      text.style.color = '#00b894';
      if (state.streak >= 3) {
        text.textContent += ` 🔥 ${state.streak} streak!`;
      }
    } else {
      icon.textContent = '❌';
      text.textContent = 'Not quite!';
      text.style.color = '#e17055';
    }

    overlay.classList.add('show');
  }

  function nextQuestion() {
    $('#feedback-overlay').classList.remove('show');
    state.current++;
    if (state.current >= state.questions.length) {
      showResults();
    } else {
      loadQuestion();
    }
  }

  // ─── Results ─────────────────────────────────────────────────
  function showResults() {
    clearInterval(state.timerInterval);
    const total = state.questions.length;
    const correct = state.score;
    const wrong = total - correct;
    const pct = Math.round((correct / total) * 100);
    const avgTime = state.answers.length > 0 ? (state.totalTime / state.answers.length).toFixed(1) : 0;

    showScreen('results');
    playSound('complete');

    // Trophy & title
    const trophy = $('#trophy-icon');
    const title = $('#results-title');
    const subtitle = $('#results-subtitle');

    if (pct >= 90) {
      trophy.textContent = '🏆';
      title.textContent = 'Outstanding!';
      subtitle.textContent = 'You\'re a true QuizMaster!';
      spawnConfetti('results-confetti', 60);
    } else if (pct >= 70) {
      trophy.textContent = '🌟';
      title.textContent = 'Great Job!';
      subtitle.textContent = 'Impressive knowledge!';
      spawnConfetti('results-confetti', 30);
    } else if (pct >= 50) {
      trophy.textContent = '👏';
      title.textContent = 'Good Effort!';
      subtitle.textContent = 'Keep learning and try again!';
    } else {
      trophy.textContent = '💪';
      title.textContent = 'Keep Trying!';
      subtitle.textContent = 'Practice makes perfect!';
    }

    // Score circle animation
    const ring = $('#score-ring');
    const circumference = 389.56;
    const offset = circumference - (pct / 100) * circumference;
    ring.style.strokeDashoffset = circumference;
    setTimeout(() => {
      ring.style.strokeDashoffset = offset;
    }, 200);

    // Animated counter
    const scoreVal = $('#score-value');
    let counter = 0;
    const step = Math.max(1, Math.floor(pct / 30));
    const counterInterval = setInterval(() => {
      counter += step;
      if (counter >= pct) {
        counter = pct;
        clearInterval(counterInterval);
      }
      scoreVal.textContent = counter + '%';
    }, 40);

    // Stats
    $('#stat-correct').textContent = correct;
    $('#stat-wrong').textContent = wrong;
    $('#stat-time').textContent = avgTime + 's';
    $('#stat-streak').textContent = state.bestStreak;

    // Breakdown
    const breakdownEl = $('#results-breakdown');
    breakdownEl.innerHTML = '';
    state.questions.forEach((q, i) => {
      const ans = state.answers[i];
      let cls = 'correct-item';
      let icon = '✅';
      let ansText = q.o[ans.correct];

      if (ans.timedOut) {
        cls = 'timeout-item';
        icon = '⏰';
        ansText = 'Timed out — Answer: ' + q.o[ans.correct];
      } else if (ans.selected !== ans.correct) {
        cls = 'wrong-item';
        icon = '❌';
        ansText = q.o[ans.selected] + ' → ' + q.o[ans.correct];
      }

      breakdownEl.innerHTML += `
        <div class="breakdown-item ${cls}">
          <span class="breakdown-icon">${icon}</span>
          <div class="breakdown-text">
            <div class="breakdown-question">${q.q}</div>
            <div class="breakdown-answer">${ansText}</div>
          </div>
        </div>`;
    });

    // Save to localStorage
    saveStats(correct, total);
  }

  // ─── Share ───────────────────────────────────────────────────
  function shareResults() {
    const total = state.questions.length;
    const correct = state.score;
    const pct = Math.round((correct / total) * 100);
    const catName = CATEGORY_NAMES[state.category];

    const emojis = state.answers.map(a => {
      if (a.timedOut) return '⏰';
      return a.selected === a.correct ? '🟢' : '🔴';
    }).join('');

    const text = `🧠 QuizMaster — ${catName} (${state.difficulty})\n` +
      `Score: ${correct}/${total} (${pct}%)\n` +
      `${emojis}\n` +
      `🔥 Best streak: ${state.bestStreak}`;

    if (navigator.share) {
      navigator.share({ title: 'QuizMaster Results', text }).catch(() => {
        copyToClipboard(text);
      });
    } else {
      copyToClipboard(text);
    }
  }

  function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => showToast()).catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast(); } catch (_) {}
    document.body.removeChild(ta);
  }

  function showToast() {
    const toast = $('#share-toast');
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // ─── Review Modal ────────────────────────────────────────────
  function showReview() {
    const body = $('#review-body');
    body.innerHTML = '';

    state.questions.forEach((q, i) => {
      const ans = state.answers[i];
      const wasCorrect = !ans.timedOut && ans.selected === ans.correct;
      let html = `<div class="review-item">
        <div class="review-q-num">Question ${i + 1}</div>
        <div class="review-question">${q.q}</div>`;

      if (ans.timedOut) {
        html += `<div class="review-answer your-answer">⏰ Timed out</div>`;
        html += `<div class="review-answer correct-answer">✅ ${q.o[ans.correct]}</div>`;
      } else if (wasCorrect) {
        html += `<div class="review-answer your-answer was-correct">✅ ${q.o[ans.selected]}</div>`;
      } else {
        html += `<div class="review-answer your-answer">❌ Your answer: ${q.o[ans.selected]}</div>`;
        html += `<div class="review-answer correct-answer">✅ Correct: ${q.o[ans.correct]}</div>`;
      }

      html += `</div>`;
      body.innerHTML += html;
    });

    $('#modal-review').classList.add('show');
  }

  // ─── Event Wiring ───────────────────────────────────────────
  function init() {
    initStartScreen();

    // Option buttons
    $$('.option-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        handleAnswer(parseInt(btn.dataset.index));
      });
    });

    // Results screen buttons
    $('#btn-share').addEventListener('click', shareResults);
    $('#btn-review').addEventListener('click', showReview);
    $('#btn-restart').addEventListener('click', () => {
      // Reset score ring
      $('#score-ring').style.strokeDashoffset = '389.56';
      showScreen('start');
      showStatsPreview();
    });

    // Review modal close
    $('#btn-close-review').addEventListener('click', () => {
      $('#modal-review').classList.remove('show');
    });

    // Close modal on backdrop click
    $('#modal-review').addEventListener('click', (e) => {
      if (e.target === $('#modal-review')) {
        $('#modal-review').classList.remove('show');
      }
    });
  }

  // ─── Boot ────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
