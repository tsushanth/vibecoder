/* ========================================
   TabarakViral - Complete Application JS
   ======================================== */

(function () {
  'use strict';

  // ===== State =====
  const state = {
    currentUser: null,
    currentPage: 'home',
    videos: [],
    stories: [],
    liveStreams: [],
    notifications: [],
    currentVideoIndex: 0,
    commentSheetOpen: false,
    shareSheetOpen: false,
    liveViewerOpen: false,
    storyViewerOpen: false,
    currentLiveStream: null,
    storyTimer: null,
    currentStoryIndex: 0,
    currentStorySetIndex: 0,
  };

  // ===== Mock Data =====
  const MOCK_USERS = [
    { id: 'u1', name: 'Ahmed Khan', handle: '@ahmed_viral', avatar: 'A', followers: 12400, following: 342, likes: 89000, bio: 'Content creator | Spreading positivity ✨' },
    { id: 'u2', name: 'Sara Ali', handle: '@sara.creates', avatar: 'S', followers: 45200, following: 128, likes: 234000, bio: 'Comedian & Singer 🎤' },
    { id: 'u3', name: 'Bilal Ahmed', handle: '@bilal_comedy', avatar: 'B', followers: 8700, following: 567, likes: 45600, bio: 'Making you laugh daily 😂' },
    { id: 'u4', name: 'Fatima Noor', handle: '@fatima.acts', avatar: 'F', followers: 23100, following: 89, likes: 156000, bio: 'Actress | Model | Dreamer' },
    { id: 'u5', name: 'Omar Farooq', handle: '@omar.sings', avatar: 'O', followers: 67800, following: 234, likes: 567000, bio: 'Singer & Musician 🎵' },
    { id: 'u6', name: 'Zainab Malik', handle: '@zainab_fun', avatar: 'Z', followers: 19300, following: 445, likes: 98700, bio: 'Fun & Fashion 💃' },
    { id: 'u7', name: 'Hassan Raza', handle: '@hassan.edits', avatar: 'H', followers: 34500, following: 156, likes: 189000, bio: 'Video Editor | Storyteller' },
    { id: 'u8', name: 'Ayesha Tariq', handle: '@ayesha_talent', avatar: 'Y', followers: 56700, following: 78, likes: 345000, bio: 'Multi-talented artist 🎨' },
  ];

  const VIDEO_THEMES = [
    { gradient: 'linear-gradient(135deg, #667eea, #764ba2)', emoji: '🎭', category: 'comedy' },
    { gradient: 'linear-gradient(135deg, #f093fb, #f5576c)', emoji: '🎤', category: 'singing' },
    { gradient: 'linear-gradient(135deg, #4facfe, #00f2fe)', emoji: '💃', category: 'dance' },
    { gradient: 'linear-gradient(135deg, #43e97b, #38f9d7)', emoji: '🎬', category: 'acting' },
    { gradient: 'linear-gradient(135deg, #fa709a, #fee140)', emoji: '🍳', category: 'cooking' },
    { gradient: 'linear-gradient(135deg, #a18cd1, #fbc2eb)', emoji: '✨', category: 'beauty' },
    { gradient: 'linear-gradient(135deg, #fccb90, #d57eeb)', emoji: '🎮', category: 'gaming' },
    { gradient: 'linear-gradient(135deg, #ff9a9e, #fecfef)', emoji: '❤️', category: 'love' },
  ];

  const CAPTIONS = [
    'Watch till the end! 😱🔥 #viral #trending',
    'POV: When your mom calls your full name 😂 #comedy #relatable',
    'Cover of my favorite song 🎵❤️ #singing #music',
    'New dance challenge! Try it 💃 #dance #challenge',
    'This acting hit different 🎬 #acting #talent',
    'Best recipe ever! 🍕 #cooking #food',
    'Transformation check ✨ #beauty #glow',
    'This game is insane! 🎮 #gaming #fun',
    'Tabarak moment of the day 🙌 #blessed',
    'Can you do this? 🤔 #challenge #viral',
    'My story, my voice 🎤 #original #music',
    'Wait for it... 😂😂 #funny #comedy',
  ];

  const COMMENTS_DATA = [
    'This is amazing! 🔥', 'Love this content ❤️', 'You are so talented!',
    'Best video today 👏', 'I cant stop watching 😂', 'Share more please!',
    'This made my day 🙌', 'Wow incredible!', 'Following you now! ✨',
    'Tabarak! So good 🎉', 'Your voice is beautiful 🎵', 'Keep going! 💪',
    'Hahaha this is gold 😂', 'So relatable!', 'Pure talent right here 🌟',
  ];

  const STORY_TEXTS = [
    'Feeling grateful for all the love and support. You all are amazing! 💖',
    'Life update: Started something new today. Excited to share the journey with you all! 🚀',
    'Reminder: You are stronger than you think. Keep pushing forward! 💪✨',
    'Had the best day ever! Sometimes the simple things matter most. ☀️',
    'Missing home today. Sending love to my family and friends. 🏡❤️',
    'New music coming soon... stay tuned! 🎵🔥',
    'Blessed beyond measure. Alhamdulillah for everything. 🙏',
    'Dreams dont work unless you do. Grind mode ON! 💯',
  ];

  const STORY_BGS = [
    'linear-gradient(135deg, #667eea, #764ba2)',
    'linear-gradient(135deg, #f093fb, #f5576c)',
    'linear-gradient(135deg, #ff6b35, #e63946)',
    'linear-gradient(135deg, #43e97b, #38f9d7)',
    'linear-gradient(135deg, #4facfe, #00f2fe)',
  ];

  // ===== Generate Mock Data =====
  function generateVideos() {
    const videos = [];
    for (let i = 0; i < 20; i++) {
      const user = MOCK_USERS[i % MOCK_USERS.length];
      const theme = VIDEO_THEMES[i % VIDEO_THEMES.length];
      videos.push({
        id: 'v' + i,
        user: user,
        theme: theme,
        caption: CAPTIONS[i % CAPTIONS.length],
        likes: Math.floor(Math.random() * 50000) + 1000,
        comments: Math.floor(Math.random() * 3000) + 100,
        shares: Math.floor(Math.random() * 5000) + 200,
        views: Math.floor(Math.random() * 500000) + 10000,
        liked: false,
        music: '♫ Original Sound - ' + user.name,
        timestamp: Date.now() - Math.random() * 86400000 * 7,
      });
    }
    return videos;
  }

  function generateStories() {
    const stories = [];
    for (let i = 0; i < 8; i++) {
      const user = MOCK_USERS[i];
      stories.push({
        id: 's' + i,
        user: user,
        items: [
          { text: STORY_TEXTS[i % STORY_TEXTS.length], bg: STORY_BGS[i % STORY_BGS.length], time: '2h ago' },
          { text: STORY_TEXTS[(i + 3) % STORY_TEXTS.length], bg: STORY_BGS[(i + 2) % STORY_BGS.length], time: '5h ago' },
        ],
        viewed: i > 4,
      });
    }
    return stories;
  }

  function generateLiveStreams() {
    return [
      { id: 'l1', user: MOCK_USERS[1], title: 'Singing Live! 🎤', viewers: 1234, theme: VIDEO_THEMES[1] },
      { id: 'l2', user: MOCK_USERS[2], title: 'Comedy Night 😂', viewers: 856, theme: VIDEO_THEMES[0] },
      { id: 'l3', user: MOCK_USERS[4], title: 'Music Session 🎵', viewers: 2341, theme: VIDEO_THEMES[1] },
      { id: 'l4', user: MOCK_USERS[5], title: 'Fun Chat 💬', viewers: 432, theme: VIDEO_THEMES[5] },
      { id: 'l5', user: MOCK_USERS[7], title: 'Art & Talent Show', viewers: 678, theme: VIDEO_THEMES[3] },
      { id: 'l6', user: MOCK_USERS[3], title: 'Drama Time 🎬', viewers: 1567, theme: VIDEO_THEMES[3] },
    ];
  }

  function generateNotifications() {
    return [
      { icon: '❤️', text: '<span class="bold">Sara Ali</span> liked your video', time: '2m ago' },
      { icon: '💬', text: '<span class="bold">Bilal Ahmed</span> commented: "Amazing! 🔥"', time: '15m ago' },
      { icon: '👤', text: '<span class="bold">Omar Farooq</span> started following you', time: '1h ago' },
      { icon: '🔴', text: '<span class="bold">Fatima Noor</span> is live now!', time: '2h ago' },
      { icon: '🔥', text: 'Your video is trending! 12.5K views', time: '3h ago' },
      { icon: '💬', text: '<span class="bold">Zainab Malik</span> replied to your comment', time: '5h ago' },
    ];
  }

  // ===== Utility =====
  function formatCount(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return n.toString();
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return document.querySelectorAll(sel); }

  function showToast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2200);
  }

  function saveState() {
    const data = {
      currentUser: state.currentUser,
      videos: state.videos.map(v => ({ id: v.id, liked: v.liked, likes: v.likes })),
      userVideos: JSON.parse(localStorage.getItem('tv_user_videos') || '[]'),
      userStories: JSON.parse(localStorage.getItem('tv_user_stories') || '[]'),
    };
    localStorage.setItem('tv_state', JSON.stringify(data));
  }

  function loadState() {
    const raw = localStorage.getItem('tv_state');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  // ===== Draw video placeholder on canvas =====
  function drawVideoCanvas(canvas, theme, emoji, username) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width = canvas.offsetWidth * 2 || 400;
    const h = canvas.height = canvas.offsetHeight * 2 || 700;
    ctx.scale(1, 1);

    // gradient bg
    const grd = ctx.createLinearGradient(0, 0, w, h);
    const colors = theme.gradient.match(/#[a-f0-9]{6}/gi) || ['#667eea', '#764ba2'];
    grd.addColorStop(0, colors[0]);
    grd.addColorStop(1, colors[1] || colors[0]);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);

    // floating particles
    for (let i = 0; i < 15; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 30 + 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,' + (Math.random() * 0.1 + 0.03) + ')';
      ctx.fill();
    }

    // emoji
    ctx.font = (w * 0.2) + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, w / 2, h / 2 - 20);

    // play icon
    ctx.font = (w * 0.08) + 'px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText('▶', w / 2, h / 2 + w * 0.15);
  }

  // ===== Splash & Login =====
  function initSplash() {
    const saved = loadState();
    if (saved && saved.currentUser) {
      state.currentUser = saved.currentUser;
      setTimeout(() => {
        $('#splash-screen').classList.add('fade-out');
        setTimeout(() => {
          $('#splash-screen').classList.add('hidden');
          $('#login-screen').classList.add('hidden');
          initApp();
        }, 600);
      }, 1500);
    } else {
      setTimeout(() => {
        $('#splash-screen').classList.add('fade-out');
        setTimeout(() => {
          $('#splash-screen').classList.add('hidden');
          $('#login-screen').style.display = 'flex';
        }, 600);
      }, 2000);
    }
  }

  function initLogin() {
    const phoneStep = $('#step-phone');
    const otpStep = $('#step-otp');
    const sendOtpBtn = $('#btn-send-otp');
    const verifyOtpBtn = $('#btn-verify-otp');
    const phoneInput = $('#phone-input');
    const otpInputs = $$('.otp-input');
    const resendBtn = $('#btn-resend');
    const resendTimer = $('#resend-timer');

    sendOtpBtn.addEventListener('click', () => {
      const phone = phoneInput.value.trim();
      if (phone.length < 7) {
        showToast('Enter a valid phone number');
        return;
      }
      phoneStep.classList.remove('active');
      otpStep.classList.add('active');
      otpInputs[0].focus();
      startResendTimer(resendTimer, resendBtn);
    });

    // OTP auto-advance
    otpInputs.forEach((inp, i) => {
      inp.addEventListener('input', () => {
        if (inp.value && i < otpInputs.length - 1) otpInputs[i + 1].focus();
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !inp.value && i > 0) otpInputs[i - 1].focus();
      });
    });

    verifyOtpBtn.addEventListener('click', () => {
      let otp = '';
      otpInputs.forEach(i => otp += i.value);
      if (otp.length < 4) {
        showToast('Enter 4-digit OTP');
        return;
      }
      // Create user
      const phone = phoneInput.value.trim();
      state.currentUser = {
        id: 'self',
        name: 'User ' + phone.slice(-4),
        handle: '@user_' + phone.slice(-4),
        phone: phone,
        avatar: phone.slice(-1).toUpperCase() || 'U',
        followers: 0,
        following: 0,
        likes: 0,
        bio: 'Welcome to TabarakViral! 🎉',
      };
      saveState();
      $('#login-screen').style.display = 'none';
      initApp();
      showToast('Welcome to TabarakViral! 🎉');
    });

    $('#btn-back-phone').addEventListener('click', () => {
      otpStep.classList.remove('active');
      phoneStep.classList.add('active');
    });

    resendBtn.addEventListener('click', () => {
      showToast('OTP resent!');
      startResendTimer(resendTimer, resendBtn);
    });
  }

  function startResendTimer(timerEl, resendBtn) {
    let sec = 30;
    resendBtn.classList.add('hidden');
    timerEl.classList.remove('hidden');
    timerEl.textContent = 'Resend in ' + sec + 's';
    const iv = setInterval(() => {
      sec--;
      timerEl.textContent = 'Resend in ' + sec + 's';
      if (sec <= 0) {
        clearInterval(iv);
        timerEl.classList.add('hidden');
        resendBtn.classList.remove('hidden');
      }
    }, 1000);
  }

  // ===== App Init =====
  function initApp() {
    state.videos = generateVideos();
    state.stories = generateStories();
    state.liveStreams = generateLiveStreams();
    state.notifications = generateNotifications();

    // Restore liked states
    const saved = loadState();
    if (saved && saved.videos) {
      saved.videos.forEach(sv => {
        const v = state.videos.find(x => x.id === sv.id);
        if (v) { v.liked = sv.liked; v.likes = sv.likes; }
      });
    }

    $('#app').classList.remove('hidden');
    renderHome();
    renderTrending();
    renderLive();
    renderProfile();
    initBottomNav();
    initTopBar();
    initCommentSheet();
    initShareSheet();
    initStoryViewer();
    initEditProfile();
    initStoryCreate();
    navigateTo('home');
  }

  // ===== Bottom Navigation =====
  function initBottomNav() {
    $$('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const page = item.dataset.page;
        if (page) navigateTo(page);
      });
    });
  }

  function navigateTo(page) {
    state.currentPage = page;
    $$('.page').forEach(p => p.classList.remove('active'));
    $$('.nav-item').forEach(n => n.classList.remove('active'));

    const pageEl = $('#page-' + page);
    if (pageEl) pageEl.classList.add('active');

    const navEl = $(`.nav-item[data-page="${page}"]`);
    if (navEl) navEl.classList.add('active');

    // Update top bar
    const topTitle = $('#top-title');
    const titles = { home: 'Tabarak Viral', trending: 'Trending 🔥', upload: 'Upload', live: 'Live', profile: 'Profile' };
    topTitle.innerHTML = page === 'home' ? '<span class="accent-text">Tabarak</span> Viral' : (titles[page] || '');

    // Re-render canvases when switching to home
    if (page === 'home') {
      setTimeout(renderVideoCanvases, 100);
    }
    if (page === 'profile') {
      renderProfile();
    }
  }

  // ===== Top Bar =====
  function initTopBar() {
    $('#btn-notif').addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = $('#notif-panel');
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        renderNotifications();
      }
    });

    $('#btn-search-top').addEventListener('click', () => {
      navigateTo('trending');
      setTimeout(() => {
        const si = $('#trending-search');
        if (si) si.focus();
      }, 200);
    });

    document.addEventListener('click', () => {
      $('#notif-panel').classList.remove('open');
    });
    $('#notif-panel').addEventListener('click', e => e.stopPropagation());
  }

  function renderNotifications() {
    const list = $('#notif-list');
    list.innerHTML = state.notifications.map(n => `
      <div class="notif-item">
        <div class="notif-icon">${n.icon}</div>
        <div>
          <div class="notif-text">${n.text}</div>
          <div class="notif-time">${n.time}</div>
        </div>
      </div>
    `).join('');
  }

  // ===== Home / Video Feed =====
  function renderHome() {
    const storiesBar = $('#stories-bar');
    const feed = $('#video-feed');

    // Stories
    let storiesHTML = `
      <div class="story-item" id="add-story-btn">
        <div class="story-avatar add-story"><div class="inner">+</div></div>
        <span class="name">Your Story</span>
      </div>
    `;
    state.stories.forEach((s, i) => {
      storiesHTML += `
        <div class="story-item" data-story-idx="${i}">
          <div class="story-avatar ${s.viewed ? 'viewed' : ''}"><div class="inner">${s.user.avatar}</div></div>
          <span class="name">${s.user.name.split(' ')[0]}</span>
        </div>
      `;
    });
    storiesBar.innerHTML = storiesHTML;

    // Story click handlers
    $('#add-story-btn').addEventListener('click', openStoryCreate);
    $$('.story-item[data-story-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.storyIdx);
        openStoryViewer(idx);
      });
    });

    // Videos
    let feedHTML = '';
    state.videos.forEach((v, i) => {
      feedHTML += `
        <div class="video-card" data-video-idx="${i}">
          <canvas class="video-canvas" data-idx="${i}"></canvas>
          <div class="play-indicator" id="play-ind-${i}">▶</div>
          <div class="video-overlay">
            <div class="video-info">
              <div class="author">${v.user.name} <span>Follow</span></div>
              <div class="caption">${v.caption}</div>
              <div class="music-tag">♫ ${v.music}</div>
            </div>
          </div>
          <div class="video-actions">
            <div class="video-avatar" data-user="${v.user.id}">${v.user.avatar}</div>
            <div class="action-btn like-btn ${v.liked ? 'liked' : ''}" data-idx="${i}">
              <div class="icon">${v.liked ? '❤️' : '🤍'}</div>
              <span class="count">${formatCount(v.likes)}</span>
            </div>
            <div class="action-btn comment-btn" data-idx="${i}">
              <div class="icon">💬</div>
              <span class="count">${formatCount(v.comments)}</span>
            </div>
            <div class="action-btn share-btn" data-idx="${i}">
              <div class="icon">↗️</div>
              <span class="count">${formatCount(v.shares)}</span>
            </div>
          </div>
        </div>
      `;
    });
    feed.innerHTML = feedHTML;

    // Event delegation for video actions
    feed.addEventListener('click', handleVideoAction);

    // Canvas rendering
    setTimeout(renderVideoCanvases, 200);

    // Follow buttons
    feed.querySelectorAll('.author span').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.textContent === 'Follow') {
          btn.textContent = 'Following';
          btn.style.color = '#fff';
          showToast('Following!');
        } else {
          btn.textContent = 'Follow';
          btn.style.color = '';
          showToast('Unfollowed');
        }
      });
    });

    // Tap to play/pause
    feed.querySelectorAll('.video-card').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('.video-actions') || e.target.closest('.author span')) return;
        const idx = card.dataset.videoIdx;
        const ind = $(`#play-ind-${idx}`);
        ind.classList.add('show');
        setTimeout(() => ind.classList.remove('show'), 600);
      });
    });
  }

  function renderVideoCanvases() {
    $$('.video-canvas').forEach(canvas => {
      const idx = parseInt(canvas.dataset.idx);
      const v = state.videos[idx];
      if (v && canvas.offsetWidth > 0) {
        drawVideoCanvas(canvas, v.theme, v.theme.emoji, v.user.name);
      }
    });
  }

  function handleVideoAction(e) {
    const likeBtn = e.target.closest('.like-btn');
    const commentBtn = e.target.closest('.comment-btn');
    const shareBtn = e.target.closest('.share-btn');
    const avatarBtn = e.target.closest('.video-avatar');

    if (likeBtn) {
      const idx = parseInt(likeBtn.dataset.idx);
      const v = state.videos[idx];
      v.liked = !v.liked;
      v.likes += v.liked ? 1 : -1;
      likeBtn.classList.toggle('liked');
      likeBtn.querySelector('.icon').textContent = v.liked ? '❤️' : '🤍';
      likeBtn.querySelector('.count').textContent = formatCount(v.likes);
      if (v.liked) {
        likeBtn.querySelector('.icon').style.transform = 'scale(1.3)';
        setTimeout(() => likeBtn.querySelector('.icon').style.transform = '', 200);
      }
      saveState();
    }

    if (commentBtn) {
      const idx = parseInt(commentBtn.dataset.idx);
      openCommentSheet(idx);
    }

    if (shareBtn) {
      const idx = parseInt(shareBtn.dataset.idx);
      openShareSheet(idx);
    }

    if (avatarBtn) {
      showToast('Viewing ' + (MOCK_USERS.find(u => u.id === avatarBtn.dataset.user) || {}).name + "'s profile");
    }
  }

  // ===== Comment Sheet =====
  function initCommentSheet() {
    const sheet = $('#comment-sheet');
    const backdrop = $('#overlay-backdrop');

    $('#close-comments').addEventListener('click', closeCommentSheet);
    backdrop.addEventListener('click', () => {
      closeCommentSheet();
      closeShareSheet();
    });

    $('#post-comment-btn').addEventListener('click', postComment);
    $('#comment-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') postComment();
    });
  }

  function openCommentSheet(videoIdx) {
    state.currentVideoIndex = videoIdx;
    const sheet = $('#comment-sheet');
    const backdrop = $('#overlay-backdrop');
    const v = state.videos[videoIdx];

    // Render comments
    const list = $('#comments-list');
    let html = '';
    const numComments = Math.min(v.comments, 15);
    for (let i = 0; i < numComments; i++) {
      const user = MOCK_USERS[i % MOCK_USERS.length];
      const comment = COMMENTS_DATA[i % COMMENTS_DATA.length];
      const mins = Math.floor(Math.random() * 120) + 1;
      html += `
        <div class="comment-item">
          <div class="comment-avatar">${user.avatar}</div>
          <div class="comment-body">
            <div class="comment-user">${user.name}</div>
            <div class="comment-text">${comment}</div>
            <div class="comment-meta">
              <span>${mins}m ago</span>
              <span>Reply</span>
            </div>
          </div>
          <button class="comment-like" data-liked="false">🤍</button>
        </div>
      `;
    }
    list.innerHTML = html;
    $('#comment-count-display').textContent = formatCount(v.comments) + ' comments';

    // Comment like buttons
    list.querySelectorAll('.comment-like').forEach(btn => {
      btn.addEventListener('click', () => {
        const liked = btn.dataset.liked === 'true';
        btn.dataset.liked = (!liked).toString();
        btn.textContent = liked ? '🤍' : '❤️';
      });
    });

    sheet.classList.add('open');
    backdrop.classList.add('active');
    state.commentSheetOpen = true;
  }

  function closeCommentSheet() {
    $('#comment-sheet').classList.remove('open');
    $('#overlay-backdrop').classList.remove('active');
    state.commentSheetOpen = false;
  }

  function postComment() {
    const input = $('#comment-input');
    const text = input.value.trim();
    if (!text) return;

    const user = state.currentUser;
    const list = $('#comments-list');
    const item = document.createElement('div');
    item.className = 'comment-item fade-in-up';
    item.innerHTML = `
      <div class="comment-avatar">${user.avatar}</div>
      <div class="comment-body">
        <div class="comment-user">${user.name}</div>
        <div class="comment-text">${text}</div>
        <div class="comment-meta"><span>Just now</span><span>Reply</span></div>
      </div>
      <button class="comment-like" data-liked="false">🤍</button>
    `;
    list.insertBefore(item, list.firstChild);
    item.querySelector('.comment-like').addEventListener('click', function() {
      const liked = this.dataset.liked === 'true';
      this.dataset.liked = (!liked).toString();
      this.textContent = liked ? '🤍' : '❤️';
    });

    input.value = '';
    state.videos[state.currentVideoIndex].comments++;
    showToast('Comment posted!');
  }

  // ===== Share Sheet =====
  function initShareSheet() {
    $('#close-share').addEventListener('click', closeShareSheet);
  }

  function openShareSheet(videoIdx) {
    closeCommentSheet();
    const sheet = $('#share-sheet');
    const backdrop = $('#overlay-backdrop');
    sheet.classList.add('open');
    backdrop.classList.add('active');
    state.shareSheetOpen = true;
    state.currentVideoIndex = videoIdx;

    // Wire share options
    sheet.querySelectorAll('.share-option').forEach(opt => {
      opt.onclick = () => {
        const label = opt.querySelector('.share-label').textContent;
        state.videos[videoIdx].shares++;
        closeShareSheet();
        showToast('Shared via ' + label + '!');
      };
    });
  }

  function closeShareSheet() {
    $('#share-sheet').classList.remove('open');
    if (!state.commentSheetOpen) $('#overlay-backdrop').classList.remove('active');
    state.shareSheetOpen = false;
  }

  // ===== Trending Page =====
  function renderTrending() {
    const container = $('#trending-content');
    const sorted = [...state.videos].sort((a, b) => b.views - a.views);

    // Talent zone
    const categories = ['singing', 'comedy', 'acting'];
    let talentHTML = '';
    categories.forEach(cat => {
      const catVideos = state.videos.filter(v => v.theme.category === cat).slice(0, 6);
      if (catVideos.length === 0) {
        // Add some for display
        for (let i = 0; i < 4; i++) {
          catVideos.push(state.videos[i % state.videos.length]);
        }
      }
      const catName = cat.charAt(0).toUpperCase() + cat.slice(1);
      const catEmoji = cat === 'singing' ? '🎤' : cat === 'comedy' ? '😂' : '🎬';
      talentHTML += `
        <div class="talent-section">
          <h3>${catEmoji} ${catName} Talent</h3>
          <div class="talent-cards">
            ${catVideos.map(v => `
              <div class="talent-card" data-video-id="${v.id}">
                <div class="thumb" style="background:${v.theme.gradient}">${v.theme.emoji}</div>
                <div class="category-badge">${catName}</div>
                <div class="label">${v.user.name}<br><small>♥ ${formatCount(v.likes)}</small></div>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    });

    // Trending grid
    let gridHTML = '<div class="trending-grid">';
    sorted.slice(0, 12).forEach((v, i) => {
      gridHTML += `
        <div class="trending-card" data-video-id="${v.id}">
          <div class="thumb" style="background:${v.theme.gradient}">${v.theme.emoji}</div>
          <div class="rank-badge">${i + 1}</div>
          <div class="overlay">
            <div>${v.user.name}</div>
            <div class="views">▶ ${formatCount(v.views)}</div>
          </div>
        </div>
      `;
    });
    gridHTML += '</div>';

    container.innerHTML = talentHTML + '<div class="talent-section"><h3>🔥 Top Trending</h3></div>' + gridHTML;

    // Click to go to home video
    container.querySelectorAll('.trending-card, .talent-card').forEach(card => {
      card.addEventListener('click', () => {
        navigateTo('home');
        showToast('Playing video...');
      });
    });

    // Search
    $('#trending-search').addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      container.querySelectorAll('.trending-card').forEach(card => {
        const vid = state.videos.find(v => v.id === card.dataset.videoId);
        if (vid) {
          const match = vid.user.name.toLowerCase().includes(q) || vid.caption.toLowerCase().includes(q) || q === '';
          card.style.display = match ? '' : 'none';
        }
      });
    });

    // Tabs
    $$('#page-trending .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('#page-trending .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        const filter = tab.dataset.filter;
        if (filter === 'all') {
          container.querySelectorAll('.talent-section, .trending-grid').forEach(el => el.style.display = '');
        } else {
          container.querySelectorAll('.talent-section').forEach(el => {
            const title = el.querySelector('h3')?.textContent.toLowerCase() || '';
            el.style.display = title.includes(filter) || title.includes('trending') ? '' : 'none';
          });
        }
      });
    });
  }

  // ===== Upload Page =====
  function initUpload() {
    const uploadArea = $('#upload-area');
    const uploadPreview = $('#upload-preview');
    const uploadForm = $('#upload-form');
    const titleInput = $('#upload-title');
    const captionInput = $('#upload-caption');
    const categorySelect = $('#upload-category');
    const publishBtn = $('#btn-publish');
    let selectedFile = null;

    uploadArea.addEventListener('click', () => {
      // Simulate file selection with a generated preview
      selectedFile = {
        name: 'video_' + Date.now() + '.mp4',
        theme: VIDEO_THEMES[Math.floor(Math.random() * VIDEO_THEMES.length)],
      };
      uploadArea.classList.add('hidden');
      uploadPreview.classList.remove('hidden');
      uploadForm.classList.remove('hidden');

      const canvas = uploadPreview.querySelector('canvas');
      setTimeout(() => {
        drawVideoCanvas(canvas, selectedFile.theme, selectedFile.theme.emoji, state.currentUser.name);
      }, 100);
    });

    $('#remove-preview').addEventListener('click', () => {
      selectedFile = null;
      uploadArea.classList.remove('hidden');
      uploadPreview.classList.add('hidden');
      uploadForm.classList.add('hidden');
      titleInput.value = '';
      captionInput.value = '';
    });

    publishBtn.addEventListener('click', () => {
      const title = titleInput.value.trim();
      const caption = captionInput.value.trim();
      const category = categorySelect.value;

      if (!selectedFile) { showToast('Select a video first'); return; }
      if (!title) { showToast('Add a title'); return; }

      // Add to user videos
      const newVideo = {
        id: 'uv_' + Date.now(),
        user: state.currentUser,
        theme: selectedFile.theme,
        caption: caption || title + ' #tabarak',
        likes: 0, comments: 0, shares: 0,
        views: 0, liked: false,
        music: '♫ Original Sound - ' + state.currentUser.name,
        timestamp: Date.now(),
        category: category,
      };
      state.videos.unshift(newVideo);

      const userVids = JSON.parse(localStorage.getItem('tv_user_videos') || '[]');
      userVids.unshift(newVideo);
      localStorage.setItem('tv_user_videos', JSON.stringify(userVids));

      // Reset form
      selectedFile = null;
      uploadArea.classList.remove('hidden');
      uploadPreview.classList.add('hidden');
      uploadForm.classList.add('hidden');
      titleInput.value = '';
      captionInput.value = '';

      showToast('Video published! 🎉');
      renderHome();
      renderProfile();
      navigateTo('home');
    });
  }

  // ===== Live Page =====
  function renderLive() {
    const grid = $('#live-grid');
    let html = '';
    state.liveStreams.forEach((ls, i) => {
      html += `
        <div class="live-stream-card" data-live-idx="${i}">
          <div class="thumb" style="background:${ls.theme.gradient}">${ls.theme.emoji}</div>
          <div class="live-badge-mini"><span class="live-badge">LIVE</span></div>
          <div class="stream-info">
            <div class="streamer">${ls.user.name}</div>
            <div class="viewers">👁 ${formatCount(ls.viewers)} watching</div>
          </div>
        </div>
      `;
    });
    grid.innerHTML = html;

    grid.querySelectorAll('.live-stream-card').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.liveIdx);
        openLiveViewer(idx);
      });
    });

    $('#go-live-btn').addEventListener('click', () => {
      openLiveViewer(-1); // -1 = own stream
    });
  }

  function openLiveViewer(idx) {
    const viewer = $('#live-viewer');
    const ls = idx >= 0 ? state.liveStreams[idx] : {
      user: state.currentUser,
      title: 'Your Live Stream',
      viewers: 0,
      theme: VIDEO_THEMES[0],
    };
    state.currentLiveStream = ls;

    // Set up UI
    $('#live-streamer-avatar').textContent = ls.user.avatar;
    $('#live-streamer-name').textContent = ls.user.name;
    $('#live-viewer-count').textContent = formatCount(ls.viewers) + ' viewers';

    // Draw canvas
    viewer.classList.add('active');
    const canvas = $('#live-canvas');
    setTimeout(() => {
      drawVideoCanvas(canvas, ls.theme, '🔴', ls.user.name);
    }, 100);

    // Clear chat
    const chatBox = $('#live-chat-messages');
    chatBox.innerHTML = '';

    // Simulate chat messages
    startLiveChat(chatBox, idx >= 0);

    // Close button
    $('#close-live-btn').onclick = () => {
      viewer.classList.remove('active');
      clearInterval(state.liveChatInterval);
    };

    // Send chat
    const chatInput = $('#live-chat-input');
    const sendBtn = $('#send-live-chat');
    const sendChat = () => {
      const text = chatInput.value.trim();
      if (!text) return;
      addLiveChatMsg(chatBox, state.currentUser.avatar, state.currentUser.name, text);
      chatInput.value = '';
    };
    sendBtn.onclick = sendChat;
    chatInput.onkeydown = (e) => { if (e.key === 'Enter') sendChat(); };
  }

  function startLiveChat(chatBox, simulate) {
    if (state.liveChatInterval) clearInterval(state.liveChatInterval);
    if (!simulate) return;

    const msgs = [
      'Hello everyone! 👋', 'Amazing stream! 🔥', 'Love this! ❤️',
      'Tabarak! 🙌', 'Keep going!', 'Best stream ever!',
      'Hi from Pakistan! 🇵🇰', 'Wow so talented! ✨', 'First time here!',
      'Can you sing my favorite song?', 'Hahaha 😂', 'Mashallah! 🌟',
      'Send hearts! ❤️❤️', 'You are amazing!', 'Much love! 💕',
    ];

    let count = 0;
    // Initial messages
    for (let i = 0; i < 3; i++) {
      const user = MOCK_USERS[Math.floor(Math.random() * MOCK_USERS.length)];
      addLiveChatMsg(chatBox, user.avatar, user.name.split(' ')[0], msgs[Math.floor(Math.random() * msgs.length)]);
    }

    state.liveChatInterval = setInterval(() => {
      if (count > 50) { clearInterval(state.liveChatInterval); return; }
      const user = MOCK_USERS[Math.floor(Math.random() * MOCK_USERS.length)];
      addLiveChatMsg(chatBox, user.avatar, user.name.split(' ')[0], msgs[Math.floor(Math.random() * msgs.length)]);
      count++;

      // Update viewer count
      const ls = state.currentLiveStream;
      if (ls) {
        ls.viewers += Math.floor(Math.random() * 5) - 1;
        if (ls.viewers < 0) ls.viewers = 0;
        $('#live-viewer-count').textContent = formatCount(ls.viewers) + ' viewers';
      }
    }, 2000 + Math.random() * 2000);
  }

  function addLiveChatMsg(chatBox, avatar, name, text) {
    const msg = document.createElement('div');
    msg.className = 'chat-msg';
    msg.innerHTML = `
      <div class="chat-avatar">${avatar}</div>
      <div><span class="chat-name">${name}</span><span class="chat-text">${text}</span></div>
    `;
    chatBox.appendChild(msg);
    chatBox.scrollTop = chatBox.scrollHeight;

    // Keep max 30 messages
    while (chatBox.children.length > 30) chatBox.removeChild(chatBox.firstChild);
  }

  // ===== Story Viewer =====
  function initStoryViewer() {
    const viewer = $('#story-viewer');

    $('#close-story-btn').addEventListener('click', closeStoryViewer);

    // Tap left/right to navigate
    viewer.querySelector('.story-content').addEventListener('click', (e) => {
      const rect = viewer.getBoundingClientRect();
      if (e.clientX < rect.width / 3) {
        prevStoryItem();
      } else {
        nextStoryItem();
      }
    });
  }

  function openStoryViewer(setIdx) {
    state.currentStorySetIndex = setIdx;
    state.currentStoryIndex = 0;
    const viewer = $('#story-viewer');
    viewer.classList.add('active');

    const story = state.stories[setIdx];
    story.viewed = true;

    renderCurrentStory();
  }

  function renderCurrentStory() {
    const story = state.stories[state.currentStorySetIndex];
    if (!story) { closeStoryViewer(); return; }
    const item = story.items[state.currentStoryIndex];
    if (!item) { nextStorySet(); return; }

    // Progress bars
    const progressContainer = $('#story-progress');
    progressContainer.innerHTML = story.items.map((_, i) => `
      <div class="bar"><div class="fill" id="story-fill-${i}" style="width:${i < state.currentStoryIndex ? '100' : '0'}%"></div></div>
    `).join('');

    // User info
    $('#story-user-avatar').textContent = story.user.avatar;
    $('#story-user-name').textContent = story.user.name;
    $('#story-time-display').textContent = item.time;

    // Content
    const content = $('#story-text-content');
    content.textContent = item.text;
    content.parentElement.style.background = item.bg;

    // Animate progress
    if (state.storyTimer) clearInterval(state.storyTimer);
    const fill = $(`#story-fill-${state.currentStoryIndex}`);
    let progress = 0;
    state.storyTimer = setInterval(() => {
      progress += 2;
      if (fill) fill.style.width = progress + '%';
      if (progress >= 100) {
        clearInterval(state.storyTimer);
        nextStoryItem();
      }
    }, 100); // 5 seconds per story
  }

  function nextStoryItem() {
    const story = state.stories[state.currentStorySetIndex];
    if (state.currentStoryIndex < story.items.length - 1) {
      state.currentStoryIndex++;
      if (state.storyTimer) clearInterval(state.storyTimer);
      renderCurrentStory();
    } else {
      nextStorySet();
    }
  }

  function prevStoryItem() {
    if (state.currentStoryIndex > 0) {
      state.currentStoryIndex--;
      if (state.storyTimer) clearInterval(state.storyTimer);
      renderCurrentStory();
    } else if (state.currentStorySetIndex > 0) {
      state.currentStorySetIndex--;
      state.currentStoryIndex = state.stories[state.currentStorySetIndex].items.length - 1;
      if (state.storyTimer) clearInterval(state.storyTimer);
      renderCurrentStory();
    }
  }

  function nextStorySet() {
    if (state.currentStorySetIndex < state.stories.length - 1) {
      state.currentStorySetIndex++;
      state.currentStoryIndex = 0;
      renderCurrentStory();
    } else {
      closeStoryViewer();
    }
  }

  function closeStoryViewer() {
    if (state.storyTimer) clearInterval(state.storyTimer);
    $('#story-viewer').classList.remove('active');
    // Update viewed status in stories bar
    renderHome();
  }

  // ===== Create Story =====
  function initStoryCreate() {
    const modal = $('#story-create');
    const textarea = $('#story-textarea');
    const bgOptions = modal.querySelectorAll('.bg-option');
    let selectedBg = STORY_BGS[0];

    bgOptions.forEach(opt => {
      opt.addEventListener('click', () => {
        bgOptions.forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        selectedBg = opt.dataset.bg;
        textarea.style.background = selectedBg;
        textarea.style.color = '#fff';
      });
    });

    // First bg selected by default
    if (bgOptions[0]) bgOptions[0].classList.add('selected');

    $('#close-story-create').addEventListener('click', () => {
      modal.classList.remove('active');
    });

    $('#btn-post-story').addEventListener('click', () => {
      const text = textarea.value.trim();
      if (!text) { showToast('Write something first!'); return; }

      // Add to stories
      const myStory = state.stories.find(s => s.user.id === 'self');
      const newItem = { text: text, bg: selectedBg, time: 'Just now' };
      if (myStory) {
        myStory.items.unshift(newItem);
      } else {
        state.stories.unshift({
          id: 's_self',
          user: state.currentUser,
          items: [newItem],
          viewed: false,
        });
      }

      const userStories = JSON.parse(localStorage.getItem('tv_user_stories') || '[]');
      userStories.unshift({ text, bg: selectedBg, timestamp: Date.now() });
      localStorage.setItem('tv_user_stories', JSON.stringify(userStories));

      textarea.value = '';
      modal.classList.remove('active');
      renderHome();
      showToast('Story posted! 🎉');
    });
  }

  function openStoryCreate() {
    $('#story-create').classList.add('active');
    setTimeout(() => $('#story-textarea').focus(), 200);
  }

  // ===== Profile Page =====
  function renderProfile() {
    if (!state.currentUser) return;
    const u = state.currentUser;

    // Count user videos
    const userVids = JSON.parse(localStorage.getItem('tv_user_videos') || '[]');
    const videoCount = userVids.length;

    $('#profile-avatar').textContent = u.avatar;
    $('#profile-username').textContent = u.name;
    $('#profile-handle').textContent = u.handle;
    $('#profile-bio').textContent = u.bio;
    $('#profile-followers').textContent = formatCount(u.followers);
    $('#profile-following').textContent = formatCount(u.following);
    $('#profile-likes').textContent = formatCount(u.likes);

    // User videos grid
    const grid = $('#profile-videos-grid');
    let html = '';
    if (userVids.length > 0) {
      userVids.forEach(v => {
        const theme = v.theme || VIDEO_THEMES[0];
        html += `
          <div class="profile-video-thumb" style="background:${theme.gradient}">
            ${theme.emoji}
            <div class="views-mini">▶ ${formatCount(v.views || 0)}</div>
          </div>
        `;
      });
    } else {
      html += `
        <div class="profile-empty-state">
          <div class="empty-icon">📹</div>
          <div class="empty-title">No videos yet</div>
          <div class="empty-subtitle">Upload your first video and start going viral!</div>
          <button class="btn-primary" id="profile-upload-btn" style="width:auto;padding:10px 24px;margin-top:12px;font-size:13px;">Upload Now</button>
        </div>
      `;
    }
    grid.innerHTML = html;

    // Profile tabs
    $$('#page-profile .tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('#page-profile .tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        showToast(tab.textContent.trim() + ' selected');
      });
    });

    // Share profile
    $('#btn-share-profile').onclick = () => showToast('Profile link copied!');

    // Logout
    $('#btn-logout').onclick = () => {
      localStorage.removeItem('tv_state');
      localStorage.removeItem('tv_user_videos');
      localStorage.removeItem('tv_user_stories');
      location.reload();
    };
  }

  // ===== Edit Profile =====
  function initEditProfile() {
    const modal = $('#edit-profile-modal');

    $('#btn-edit-profile').addEventListener('click', () => {
      $('#edit-name').value = state.currentUser.name;
      $('#edit-handle').value = state.currentUser.handle;
      $('#edit-bio').value = state.currentUser.bio;
      modal.classList.add('active');
    });

    $('#cancel-edit').addEventListener('click', () => {
      modal.classList.remove('active');
    });

    $('#save-edit').addEventListener('click', () => {
      const name = $('#edit-name').value.trim();
      const handle = $('#edit-handle').value.trim();
      const bio = $('#edit-bio').value.trim();

      if (!name) { showToast('Name is required'); return; }
      if (!handle) { showToast('Handle is required'); return; }

      state.currentUser.name = name;
      state.currentUser.handle = handle.startsWith('@') ? handle : '@' + handle;
      state.currentUser.bio = bio;
      state.currentUser.avatar = name.charAt(0).toUpperCase();

      saveState();
      renderProfile();
      modal.classList.remove('active');
      showToast('Profile updated!');
    });

    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  // ===== Boot =====
  document.addEventListener('DOMContentLoaded', () => {
    initLogin();
    initUpload();
    initSplash();
  });

})();
