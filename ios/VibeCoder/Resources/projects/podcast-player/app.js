const PODCASTS = [
    {
        id: 1,
        podcast: 'Tech Talks Daily',
        title: 'The Future of AI Development',
        duration: 2847,
        date: '2026-04-10',
        description: 'Exploring the latest advances in artificial intelligence and machine learning.',
        chapters: [
            { time: 0, title: 'Introduction' },
            { time: 180, title: 'Current State of AI' },
            { time: 720, title: 'Large Language Models' },
            { time: 1440, title: 'Ethical Considerations' },
            { time: 2100, title: 'Future Predictions' },
            { time: 2640, title: 'Q&A Session' }
        ]
    },
    {
        id: 2,
        podcast: 'Tech Talks Daily',
        title: 'Building Scalable Web Applications',
        duration: 3156,
        date: '2026-04-08',
        description: 'Best practices for creating web apps that can handle millions of users.',
        chapters: [
            { time: 0, title: 'Welcome' },
            { time: 120, title: 'Architecture Patterns' },
            { time: 900, title: 'Database Optimization' },
            { time: 1620, title: 'Caching Strategies' },
            { time: 2340, title: 'Load Balancing' },
            { time: 2880, title: 'Closing Thoughts' }
        ]
    },
    {
        id: 3,
        podcast: 'Design Matters',
        title: 'Minimalist UI/UX Design Principles',
        duration: 2163,
        date: '2026-04-07',
        description: 'How less can be more when designing user interfaces.',
        chapters: [
            { time: 0, title: 'Introduction' },
            { time: 240, title: 'What is Minimalism?' },
            { time: 780, title: 'Color and Typography' },
            { time: 1320, title: 'Whitespace Usage' },
            { time: 1860, title: 'Case Studies' }
        ]
    },
    {
        id: 4,
        podcast: 'Code Review',
        title: 'JavaScript Performance Optimization',
        duration: 2556,
        date: '2026-04-05',
        description: 'Tips and tricks to make your JavaScript code run faster.',
        chapters: [
            { time: 0, title: 'Opening' },
            { time: 180, title: 'Memory Management' },
            { time: 840, title: 'Event Loop Optimization' },
            { time: 1500, title: 'Bundle Size Reduction' },
            { time: 2100, title: 'Real-world Examples' }
        ]
    },
    {
        id: 5,
        podcast: 'Design Matters',
        title: 'The Psychology of Color in Design',
        duration: 1980,
        date: '2026-04-03',
        description: 'Understanding how colors affect user behavior and emotions.',
        chapters: [
            { time: 0, title: 'Introduction' },
            { time: 300, title: 'Color Theory Basics' },
            { time: 900, title: 'Emotional Responses' },
            { time: 1440, title: 'Cultural Differences' },
            { time: 1740, title: 'Practical Applications' }
        ]
    },
    {
        id: 6,
        podcast: 'Code Review',
        title: 'Modern CSS Techniques',
        duration: 2424,
        date: '2026-04-01',
        description: 'Exploring CSS Grid, Flexbox, and modern layout methods.',
        chapters: [
            { time: 0, title: 'Welcome Back' },
            { time: 120, title: 'CSS Grid Deep Dive' },
            { time: 840, title: 'Flexbox Mastery' },
            { time: 1560, title: 'Container Queries' },
            { time: 2040, title: 'Tips and Tricks' }
        ]
    }
];

class PodcastPlayer {
    constructor() {
        this.audio = document.getElementById('audioPlayer');
        this.currentEpisode = null;
        this.queue = [];
        this.playbackSpeed = 1.0;
        this.isPlaying = false;
        this.currentChapter = null;

        this.initializeElements();
        this.loadState();
        this.attachEventListeners();
        this.renderEpisodes();
        this.updateUI();
    }

    initializeElements() {
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.playIcon = document.getElementById('playIcon');
        this.pauseIcon = document.getElementById('pauseIcon');
        this.progressBar = document.getElementById('progressBar');
        this.currentTimeEl = document.getElementById('currentTime');
        this.durationEl = document.getElementById('duration');
        this.podcastTitle = document.getElementById('podcastTitle');
        this.episodeTitle = document.getElementById('episodeTitle');
        this.speedBtn = document.getElementById('speedBtn');
        this.speedModal = document.getElementById('speedModal');
        this.episodeList = document.getElementById('episodeList');
        this.chaptersList = document.getElementById('chaptersList');
        this.queueList = document.getElementById('queueList');
        this.emptyQueue = document.getElementById('emptyQueue');
    }

    attachEventListeners() {
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        document.getElementById('prevBtn').addEventListener('click', () => this.playPrevious());
        document.getElementById('nextBtn').addEventListener('click', () => this.playNext());
        document.getElementById('rewindBtn').addEventListener('click', () => this.skip(-15));
        document.getElementById('forwardBtn').addEventListener('click', () => this.skip(30));

        this.progressBar.addEventListener('input', (e) => this.seekTo(e.target.value));
        this.speedBtn.addEventListener('click', () => this.openSpeedModal());

        document.getElementById('closeSpeedModal').addEventListener('click', () => this.closeSpeedModal());
        this.speedModal.addEventListener('click', (e) => {
            if (e.target === this.speedModal) this.closeSpeedModal();
        });

        document.querySelectorAll('.speed-option').forEach(btn => {
            btn.addEventListener('click', (e) => this.setSpeed(parseFloat(e.target.dataset.speed)));
        });

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });

        document.getElementById('clearQueueBtn').addEventListener('click', () => this.clearQueue());

        this.audio.addEventListener('timeupdate', () => this.onTimeUpdate());
        this.audio.addEventListener('loadedmetadata', () => this.onMetadataLoaded());
        this.audio.addEventListener('ended', () => this.onEnded());
        this.audio.addEventListener('play', () => this.onPlay());
        this.audio.addEventListener('pause', () => this.onPause());
    }

    renderEpisodes() {
        this.episodeList.innerHTML = PODCASTS.map(episode => `
            <div class="episode-item" data-id="${episode.id}">
                <div class="episode-header">
                    <div class="episode-info">
                        <div class="episode-name">${episode.title}</div>
                        <div class="episode-podcast">${episode.podcast}</div>
                        <div class="episode-date">${this.formatDate(episode.date)}</div>
                    </div>
                    <div class="episode-duration">${this.formatTime(episode.duration)}</div>
                </div>
                <div class="episode-description">${episode.description}</div>
                <div class="episode-actions">
                    <button class="episode-action-btn play-episode">Play</button>
                    <button class="episode-action-btn add-queue" data-id="${episode.id}">Add to Queue</button>
                </div>
            </div>
        `).join('');

        document.querySelectorAll('.episode-item').forEach(item => {
            const episodeId = parseInt(item.dataset.id);

            item.querySelector('.play-episode').addEventListener('click', (e) => {
                e.stopPropagation();
                this.playEpisode(episodeId);
            });

            item.querySelector('.add-queue').addEventListener('click', (e) => {
                e.stopPropagation();
                this.addToQueue(episodeId);
            });
        });

        this.updateEpisodeUI();
    }

    playEpisode(episodeId) {
        const episode = PODCASTS.find(e => e.id === episodeId);
        if (!episode) return;

        this.currentEpisode = episode;
        this.generateAudioForEpisode(episode);
        this.audio.playbackRate = this.playbackSpeed;

        this.audio.play().catch(err => {
            console.error('Playback failed:', err);
        });

        this.updateUI();
        this.saveState();
    }

    generateAudioForEpisode(episode) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const duration = episode.duration;
        const sampleRate = audioContext.sampleRate;
        const numSamples = duration * sampleRate;
        const buffer = audioContext.createBuffer(1, numSamples, sampleRate);
        const channelData = buffer.getChannelData(0);

        const baseFreq = 220 + (episode.id * 30);
        for (let i = 0; i < numSamples; i++) {
            const t = i / sampleRate;
            const freq = baseFreq + Math.sin(t * 0.5) * 20;
            channelData[i] = Math.sin(2 * Math.PI * freq * t) * 0.05;
        }

        const offlineContext = new OfflineAudioContext(1, numSamples, sampleRate);
        const source = offlineContext.createBufferSource();
        source.buffer = buffer;
        source.connect(offlineContext.destination);
        source.start();

        offlineContext.startRendering().then(renderedBuffer => {
            const wavData = this.bufferToWave(renderedBuffer);
            const blob = new Blob([wavData], { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            this.audio.src = url;
        });
    }

    bufferToWave(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1;
        const bitDepth = 16;

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;

        const data = new Float32Array(buffer.length);
        buffer.copyFromChannel(data, 0);

        const dataLength = data.length * bytesPerSample;
        const bufferLength = 44 + dataLength;
        const arrayBuffer = new ArrayBuffer(bufferLength);
        const view = new DataView(arrayBuffer);

        const writeString = (offset, string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        writeString(0, 'RIFF');
        view.setUint32(4, bufferLength - 8, true);
        writeString(8, 'WAVE');
        writeString(12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(36, 'data');
        view.setUint32(40, dataLength, true);

        let offset = 44;
        for (let i = 0; i < data.length; i++) {
            const sample = Math.max(-1, Math.min(1, data[i]));
            const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
            view.setInt16(offset, intSample, true);
            offset += 2;
        }

        return arrayBuffer;
    }

    togglePlayPause() {
        if (!this.currentEpisode) {
            if (PODCASTS.length > 0) {
                this.playEpisode(PODCASTS[0].id);
            }
            return;
        }

        if (this.isPlaying) {
            this.audio.pause();
        } else {
            this.audio.play().catch(err => {
                console.error('Playback failed:', err);
            });
        }
    }

    playNext() {
        if (this.queue.length > 0) {
            const nextId = this.queue[0];
            this.removeFromQueue(0);
            this.playEpisode(nextId);
        } else if (this.currentEpisode) {
            const currentIndex = PODCASTS.findIndex(e => e.id === this.currentEpisode.id);
            const nextIndex = (currentIndex + 1) % PODCASTS.length;
            this.playEpisode(PODCASTS[nextIndex].id);
        }
    }

    playPrevious() {
        if (this.audio.currentTime > 3) {
            this.audio.currentTime = 0;
        } else if (this.currentEpisode) {
            const currentIndex = PODCASTS.findIndex(e => e.id === this.currentEpisode.id);
            const prevIndex = (currentIndex - 1 + PODCASTS.length) % PODCASTS.length;
            this.playEpisode(PODCASTS[prevIndex].id);
        }
    }

    skip(seconds) {
        if (this.audio.src) {
            this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, this.audio.currentTime + seconds));
        }
    }

    seekTo(value) {
        if (this.audio.src && this.audio.duration) {
            this.audio.currentTime = (value / 100) * this.audio.duration;
        }
    }

    addToQueue(episodeId) {
        if (!this.queue.includes(episodeId)) {
            this.queue.push(episodeId);
            this.updateQueueUI();
            this.saveState();
            this.updateEpisodeUI();
        }
    }

    removeFromQueue(index) {
        this.queue.splice(index, 1);
        this.updateQueueUI();
        this.saveState();
        this.updateEpisodeUI();
    }

    clearQueue() {
        this.queue = [];
        this.updateQueueUI();
        this.saveState();
        this.updateEpisodeUI();
    }

    setSpeed(speed) {
        this.playbackSpeed = speed;
        this.audio.playbackRate = speed;
        this.speedBtn.textContent = `${speed.toFixed(1)}x`;

        document.querySelectorAll('.speed-option').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.speed) === speed);
        });

        this.closeSpeedModal();
        this.saveState();
    }

    openSpeedModal() {
        this.speedModal.classList.add('active');
    }

    closeSpeedModal() {
        this.speedModal.classList.remove('active');
    }

    switchTab(tabName) {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        const tabMap = {
            'episodes': 'episodesTab',
            'chapters': 'chaptersTab',
            'queue': 'queueTab'
        };

        document.getElementById(tabMap[tabName]).classList.add('active');

        if (tabName === 'chapters') {
            this.updateChaptersUI();
        }
    }

    onTimeUpdate() {
        if (this.audio.duration) {
            const progress = (this.audio.currentTime / this.audio.duration) * 100;
            this.progressBar.value = progress;
            this.currentTimeEl.textContent = this.formatTime(this.audio.currentTime);

            this.updateCurrentChapter();
        }
    }

    onMetadataLoaded() {
        this.durationEl.textContent = this.formatTime(this.audio.duration);
        this.progressBar.value = 0;
    }

    onEnded() {
        this.playNext();
    }

    onPlay() {
        this.isPlaying = true;
        this.playIcon.style.display = 'none';
        this.pauseIcon.style.display = 'block';
    }

    onPause() {
        this.isPlaying = false;
        this.playIcon.style.display = 'block';
        this.pauseIcon.style.display = 'none';
    }

    updateCurrentChapter() {
        if (!this.currentEpisode || !this.currentEpisode.chapters) return;

        const currentTime = this.audio.currentTime;
        let activeChapter = null;

        for (let i = this.currentEpisode.chapters.length - 1; i >= 0; i--) {
            if (currentTime >= this.currentEpisode.chapters[i].time) {
                activeChapter = i;
                break;
            }
        }

        if (activeChapter !== this.currentChapter) {
            this.currentChapter = activeChapter;
            this.updateChaptersUI();
        }
    }

    updateUI() {
        if (this.currentEpisode) {
            this.podcastTitle.textContent = this.currentEpisode.podcast;
            this.episodeTitle.textContent = this.currentEpisode.title;
        } else {
            this.podcastTitle.textContent = 'Select an episode';
            this.episodeTitle.textContent = '';
        }

        this.updateEpisodeUI();
        this.updateChaptersUI();
        this.updateQueueUI();
    }

    updateEpisodeUI() {
        document.querySelectorAll('.episode-item').forEach(item => {
            const episodeId = parseInt(item.dataset.id);
            const isPlaying = this.currentEpisode && this.currentEpisode.id === episodeId;
            item.classList.toggle('playing', isPlaying);

            const queueBtn = item.querySelector('.add-queue');
            const inQueue = this.queue.includes(episodeId);
            queueBtn.classList.toggle('in-queue', inQueue);
            queueBtn.textContent = inQueue ? 'In Queue' : 'Add to Queue';
        });
    }

    updateChaptersUI() {
        if (!this.currentEpisode || !this.currentEpisode.chapters) {
            this.chaptersList.innerHTML = '<div class="empty-state">No episode selected</div>';
            return;
        }

        this.chaptersList.innerHTML = this.currentEpisode.chapters.map((chapter, index) => `
            <div class="chapter-item ${index === this.currentChapter ? 'active' : ''}" data-time="${chapter.time}">
                <div class="chapter-time">${this.formatTime(chapter.time)}</div>
                <div class="chapter-title">${chapter.title}</div>
            </div>
        `).join('');

        document.querySelectorAll('.chapter-item').forEach(item => {
            item.addEventListener('click', () => {
                const time = parseFloat(item.dataset.time);
                this.audio.currentTime = time;
            });
        });
    }

    updateQueueUI() {
        if (this.queue.length === 0) {
            this.queueList.style.display = 'none';
            this.emptyQueue.style.display = 'block';
            return;
        }

        this.queueList.style.display = 'flex';
        this.emptyQueue.style.display = 'none';

        this.queueList.innerHTML = this.queue.map((episodeId, index) => {
            const episode = PODCASTS.find(e => e.id === episodeId);
            if (!episode) return '';

            return `
                <div class="queue-item">
                    <div class="queue-number">${index + 1}</div>
                    <div class="queue-item-info">
                        <div class="queue-item-name">${episode.title}</div>
                        <div class="queue-item-podcast">${episode.podcast}</div>
                    </div>
                    <button class="queue-remove-btn" data-index="${index}">×</button>
                </div>
            `;
        }).join('');

        document.querySelectorAll('.queue-remove-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.removeFromQueue(parseInt(btn.dataset.index));
            });
        });
    }

    formatTime(seconds) {
        if (isNaN(seconds) || !isFinite(seconds)) return '0:00';

        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        const now = new Date();
        const diffTime = Math.abs(now - date);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays} days ago`;

        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    saveState() {
        const state = {
            currentEpisodeId: this.currentEpisode ? this.currentEpisode.id : null,
            currentTime: this.audio.currentTime || 0,
            queue: this.queue,
            playbackSpeed: this.playbackSpeed
        };
        localStorage.setItem('podcastPlayerState', JSON.stringify(state));
    }

    loadState() {
        const stateStr = localStorage.getItem('podcastPlayerState');
        if (!stateStr) return;

        try {
            const state = JSON.parse(stateStr);

            if (state.currentEpisodeId) {
                const episode = PODCASTS.find(e => e.id === state.currentEpisodeId);
                if (episode) {
                    this.currentEpisode = episode;
                    this.generateAudioForEpisode(episode);

                    this.audio.addEventListener('loadedmetadata', () => {
                        if (state.currentTime) {
                            this.audio.currentTime = state.currentTime;
                        }
                    }, { once: true });
                }
            }

            if (state.queue) {
                this.queue = state.queue;
            }

            if (state.playbackSpeed) {
                this.setSpeed(state.playbackSpeed);
            }
        } catch (e) {
            console.error('Failed to load state:', e);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new PodcastPlayer();
});
