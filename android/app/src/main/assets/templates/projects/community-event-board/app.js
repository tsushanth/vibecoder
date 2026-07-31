class EventBoard {
    constructor() {
        this.events = this.loadEvents();
        this.rsvps = this.loadRSVPs();
        this.currentDateFilter = 'all';
        this.currentCategoryFilter = 'all';
        this.init();
    }

    init() {
        this.renderEvents();
        this.setupEventListeners();
    }

    loadEvents() {
        const stored = localStorage.getItem('communityEvents');
        if (stored) {
            return JSON.parse(stored);
        }

        return [
            {
                id: 1,
                title: 'Summer Jazz Festival',
                date: '2026-06-15',
                time: '18:00',
                category: 'music',
                location: 'Central Park Amphitheater',
                description: 'Join us for an evening of smooth jazz under the stars! Featuring local and international artists.',
                rsvpCount: 127
            },
            {
                id: 2,
                title: 'Community Soccer Tournament',
                date: '2026-04-20',
                time: '09:00',
                category: 'sports',
                location: 'Riverside Sports Complex',
                description: 'Annual soccer tournament for all ages. Teams of 5-7 players. Prizes for winners!',
                rsvpCount: 89
            },
            {
                id: 3,
                title: 'Food Truck Festival',
                date: '2026-05-01',
                time: '12:00',
                category: 'food',
                location: 'Downtown Plaza',
                description: 'Over 30 food trucks serving cuisines from around the world. Live music and family activities!',
                rsvpCount: 234
            },
            {
                id: 4,
                title: 'Art Walk & Gallery Night',
                date: '2026-04-12',
                time: '17:00',
                category: 'arts',
                location: 'Historic Arts District',
                description: 'Explore local galleries and street art. Meet the artists and enjoy live painting demonstrations.',
                rsvpCount: 56
            },
            {
                id: 5,
                title: 'Tech Startup Meetup',
                date: '2026-04-18',
                time: '19:00',
                category: 'tech',
                location: 'Innovation Hub Co-Working',
                description: 'Network with entrepreneurs and developers. Featuring pitches from 3 local startups and Q&A.',
                rsvpCount: 42
            },
            {
                id: 6,
                title: 'Community Garden Day',
                date: '2026-04-11',
                time: '10:00',
                category: 'community',
                location: 'Sunrise Community Garden',
                description: 'Help plant spring vegetables and flowers. Tools and refreshments provided. All welcome!',
                rsvpCount: 31
            },
            {
                id: 7,
                title: 'Outdoor Movie Night',
                date: '2026-03-28',
                time: '20:00',
                category: 'community',
                location: 'Veterans Memorial Park',
                description: 'Classic film screening under the stars. Bring blankets and lawn chairs. Free popcorn!',
                rsvpCount: 156
            },
            {
                id: 8,
                title: 'Rock Concert: The Waves',
                date: '2026-05-22',
                time: '21:00',
                category: 'music',
                location: 'Underground Live Music Hall',
                description: 'Local rock band The Waves performs their greatest hits. Special guest opening act.',
                rsvpCount: 203
            }
        ];
    }

    loadRSVPs() {
        const stored = localStorage.getItem('eventRSVPs');
        return stored ? JSON.parse(stored) : {};
    }

    saveEvents() {
        localStorage.setItem('communityEvents', JSON.stringify(this.events));
    }

    saveRSVPs() {
        localStorage.setItem('eventRSVPs', JSON.stringify(this.rsvps));
    }

    setupEventListeners() {
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentDateFilter = e.target.dataset.filter;
                this.renderEvents();
            });
        });

        document.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.category-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentCategoryFilter = e.target.dataset.category;
                this.renderEvents();
            });
        });

        const addEventBtn = document.getElementById('addEventBtn');
        const addEventModal = document.getElementById('addEventModal');
        const eventDetailModal = document.getElementById('eventDetailModal');
        const closeBtns = document.querySelectorAll('.close');

        addEventBtn.addEventListener('click', () => {
            addEventModal.style.display = 'block';
        });

        closeBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                addEventModal.style.display = 'none';
                eventDetailModal.style.display = 'none';
            });
        });

        window.addEventListener('click', (e) => {
            if (e.target === addEventModal) {
                addEventModal.style.display = 'none';
            }
            if (e.target === eventDetailModal) {
                eventDetailModal.style.display = 'none';
            }
        });

        const eventForm = document.getElementById('eventForm');
        eventForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.createEvent();
        });
    }

    createEvent() {
        const title = document.getElementById('eventTitle').value;
        const date = document.getElementById('eventDate').value;
        const time = document.getElementById('eventTime').value;
        const category = document.getElementById('eventCategory').value;
        const location = document.getElementById('eventLocation').value;
        const description = document.getElementById('eventDescription').value;

        const newEvent = {
            id: Date.now(),
            title,
            date,
            time,
            category,
            location,
            description,
            rsvpCount: 0
        };

        this.events.push(newEvent);
        this.saveEvents();
        this.renderEvents();

        document.getElementById('eventForm').reset();
        document.getElementById('addEventModal').style.display = 'none';
    }

    filterEvents() {
        let filtered = [...this.events];

        if (this.currentCategoryFilter !== 'all') {
            filtered = filtered.filter(event => event.category === this.currentCategoryFilter);
        }

        if (this.currentDateFilter !== 'all') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            filtered = filtered.filter(event => {
                const eventDate = new Date(event.date);
                eventDate.setHours(0, 0, 0, 0);

                if (this.currentDateFilter === 'upcoming') {
                    return eventDate >= today;
                } else if (this.currentDateFilter === 'past') {
                    return eventDate < today;
                }
                return true;
            });
        }

        filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

        return filtered;
    }

    toggleRSVP(eventId) {
        if (this.rsvps[eventId]) {
            delete this.rsvps[eventId];
            const event = this.events.find(e => e.id === eventId);
            if (event) {
                event.rsvpCount = Math.max(0, event.rsvpCount - 1);
            }
        } else {
            this.rsvps[eventId] = true;
            const event = this.events.find(e => e.id === eventId);
            if (event) {
                event.rsvpCount++;
            }
        }
        this.saveRSVPs();
        this.saveEvents();
        this.renderEvents();
    }

    formatDate(dateStr) {
        const date = new Date(dateStr);
        const options = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' };
        return date.toLocaleDateString('en-US', options);
    }

    formatTime(timeStr) {
        const [hours, minutes] = timeStr.split(':');
        const hour = parseInt(hours);
        const ampm = hour >= 12 ? 'PM' : 'AM';
        const displayHour = hour % 12 || 12;
        return `${displayHour}:${minutes} ${ampm}`;
    }

    showEventDetail(eventId) {
        const event = this.events.find(e => e.id === eventId);
        if (!event) return;

        const modal = document.getElementById('eventDetailModal');
        const content = document.getElementById('eventDetailContent');

        const isRSVPed = this.rsvps[eventId] || false;

        content.innerHTML = `
            <h2 class="event-title">${event.title}</h2>
            <div class="event-category ${event.category}">${event.category}</div>

            <div class="event-stats">
                <div class="stat-item">
                    <span>📅</span>
                    <span>${this.formatDate(event.date)}</span>
                </div>
                <div class="stat-item">
                    <span>🕐</span>
                    <span>${this.formatTime(event.time)}</span>
                </div>
            </div>

            <div class="event-location">
                ${event.location}
            </div>

            <p class="event-description">${event.description}</p>

            <div class="map-preview">
                <div class="map-title">📍 Location Map Preview</div>
                <div class="map-grid">
                    ${Array(56).fill('').map((_, i) => `<div class="map-cell"></div>`).join('')}
                </div>
                <div class="map-marker" style="left: 45%; top: 40%;">📍</div>
            </div>

            <div class="event-footer">
                <div class="rsvp-count">👥 ${event.rsvpCount} attending</div>
                <button class="rsvp-btn ${isRSVPed ? 'rsvped' : ''}" onclick="eventBoard.toggleRSVP(${event.id}); eventBoard.showEventDetail(${event.id})">
                    ${isRSVPed ? '✓ You\'re Going!' : 'RSVP'}
                </button>
            </div>
        `;

        modal.style.display = 'block';
    }

    renderEvents() {
        const grid = document.getElementById('eventGrid');
        const filtered = this.filterEvents();

        if (filtered.length === 0) {
            grid.innerHTML = '<div class="no-events">No events found. Try adjusting your filters!</div>';
            return;
        }

        grid.innerHTML = filtered.map(event => {
            const isRSVPed = this.rsvps[event.id] || false;

            return `
                <div class="event-card ${event.category}" onclick="eventBoard.showEventDetail(${event.id})">
                    <div class="event-header">
                        <div class="event-title">${event.title}</div>
                        <div class="event-date-time">
                            ${this.formatDate(event.date)} • ${this.formatTime(event.time)}
                        </div>
                    </div>
                    <div class="event-body">
                        <div class="event-category">${event.category}</div>
                        <div class="event-location">${event.location}</div>
                        <p class="event-description">${event.description}</p>
                    </div>
                    <div class="event-footer">
                        <div class="rsvp-count">👥 ${event.rsvpCount}</div>
                        <button class="rsvp-btn ${isRSVPed ? 'rsvped' : ''}"
                                onclick="event.stopPropagation(); eventBoard.toggleRSVP(${event.id})">
                            ${isRSVPed ? '✓ Going' : 'RSVP'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

const eventBoard = new EventBoard();
