/* ===== Service Booking App ===== */
(function () {
  'use strict';

  // ── Data ──────────────────────────────────────────────────
  const SERVICES = [
    {
      category: 'Hair',
      items: [
        { id: 'haircut', name: 'Haircut & Style', desc: 'Wash, cut, and blowdry', price: 45, duration: 45, color: '#EEF2FF', icon: '✂️' },
        { id: 'color', name: 'Hair Coloring', desc: 'Full color or highlights', price: 95, duration: 90, color: '#FEF3C7', icon: '🎨' },
        { id: 'treatment', name: 'Deep Treatment', desc: 'Keratin or conditioning', price: 65, duration: 60, color: '#ECFDF5', icon: '💆' },
      ]
    },
    {
      category: 'Skin & Body',
      items: [
        { id: 'facial', name: 'Classic Facial', desc: 'Cleanse, exfoliate, hydrate', price: 75, duration: 60, color: '#FFF1F2', icon: '🧖' },
        { id: 'massage', name: 'Relaxation Massage', desc: 'Full body 60-min session', price: 90, duration: 60, color: '#F0F9FF', icon: '💆‍♂️' },
        { id: 'manicure', name: 'Mani-Pedi Combo', desc: 'Nails, cuticles, polish', price: 55, duration: 50, color: '#FDF4FF', icon: '💅' },
      ]
    },
    {
      category: 'Premium',
      items: [
        { id: 'bridal', name: 'Bridal Package', desc: 'Hair, makeup & nails', price: 250, duration: 180, color: '#FFFBEB', icon: '👰' },
        { id: 'spa-day', name: 'Full Spa Day', desc: 'Massage, facial, mani-pedi', price: 199, duration: 240, color: '#F0FDFA', icon: '🌿' },
      ]
    }
  ];

  const TIME_SLOTS = {
    Morning: ['9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM'],
    Afternoon: ['12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM'],
    Evening: ['4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM', '6:00 PM']
  };

  // ── State ─────────────────────────────────────────────────
  let state = {
    step: 0,                // 0=services, 1=date/time, 2=details, 3=confirm
    selectedService: null,
    selectedDate: null,
    selectedTime: null,
    calendarMonth: new Date().getMonth(),
    calendarYear: new Date().getFullYear(),
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    customerNotes: '',
    bookings: JSON.parse(localStorage.getItem('bookings') || '[]')
  };

  // ── DOM refs ──────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ── Helpers ───────────────────────────────────────────────
  function getServiceById(id) {
    for (const cat of SERVICES) {
      const found = cat.items.find(s => s.id === id);
      if (found) return found;
    }
    return null;
  }

  function formatDate(d) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return `${days[d.getDay()]}, ${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  function formatDateShort(d) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  }

  function generateBookingId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let id = 'BK-';
    for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
    return id;
  }

  function showToast(msg) {
    const toast = $('#toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  function saveBookings() {
    localStorage.setItem('bookings', JSON.stringify(state.bookings));
  }

  // Generate pseudo-random unavailable slots for a given date
  function getUnavailableSlots(date) {
    const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
    const unavailable = new Set();
    let rng = seed;
    for (let i = 0; i < 5; i++) {
      rng = (rng * 9301 + 49297) % 233280;
      const allSlots = Object.values(TIME_SLOTS).flat();
      unavailable.add(allSlots[rng % allSlots.length]);
    }
    return unavailable;
  }

  // ── Render ────────────────────────────────────────────────
  function render() {
    renderStepper();
    renderScreens();
    renderBottomBar();
    renderHeader();
  }

  function renderHeader() {
    const backBtn = $('.header-back');
    if (state.step === 0) {
      backBtn.classList.add('hidden');
    } else {
      backBtn.classList.remove('hidden');
    }

    const titles = ['Select Service', 'Choose Date & Time', 'Your Details', 'Booking Confirmed'];
    $('.header-title').textContent = titles[state.step];
  }

  function renderStepper() {
    const steps = $$('.step-circle');
    const lines = $$('.step-line');
    steps.forEach((el, i) => {
      el.classList.remove('active', 'completed');
      if (i === state.step) {
        el.classList.add('active');
        el.textContent = i + 1;
      } else if (i < state.step) {
        el.classList.add('completed');
        el.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      } else {
        el.textContent = i + 1;
      }
    });
    lines.forEach((el, i) => {
      el.classList.toggle('active', i < state.step);
    });
  }

  function renderScreens() {
    $$('.screen').forEach(s => s.classList.remove('active'));
    const screens = ['screen-services', 'screen-datetime', 'screen-details', 'screen-confirm'];
    const activeScreen = $(`#${screens[state.step]}`);
    if (activeScreen) activeScreen.classList.add('active');

    if (state.step === 0) renderServices();
    if (state.step === 1) renderDateTime();
    if (state.step === 2) renderDetails();
    if (state.step === 3) renderConfirm();
  }

  // ── Services Screen ───────────────────────────────────────
  function renderServices() {
    const container = $('#services-list');
    container.innerHTML = '';

    SERVICES.forEach(cat => {
      const catDiv = document.createElement('div');
      catDiv.className = 'service-category';
      catDiv.innerHTML = `<div class="category-label">${cat.category}</div>`;

      cat.items.forEach(svc => {
        const card = document.createElement('div');
        card.className = `service-card${state.selectedService === svc.id ? ' selected' : ''}`;
        card.innerHTML = `
          <div class="service-icon" style="background:${svc.color}">${svc.icon}</div>
          <div class="service-info">
            <div class="service-name">${svc.name}</div>
            <div class="service-desc">${svc.desc}</div>
          </div>
          <div class="service-meta">
            <div class="service-price">$${svc.price}</div>
            <div class="service-duration">${svc.duration} min</div>
          </div>
          <div class="service-check">${state.selectedService === svc.id ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : ''}</div>
        `;
        card.addEventListener('click', () => {
          state.selectedService = svc.id;
          renderServices();
          renderBottomBar();
        });
        catDiv.appendChild(card);
      });

      container.appendChild(catDiv);
    });

    // My Bookings section
    renderMyBookings(container);
  }

  function renderMyBookings(container) {
    if (state.bookings.length === 0) return;

    const section = document.createElement('div');
    section.style.marginTop = '20px';
    section.innerHTML = `
      <div class="bookings-toggle" id="toggle-bookings">
        <span class="section-title" style="margin:0">My Bookings</span>
        <span class="bookings-count">${state.bookings.length}</span>
      </div>
      <div id="bookings-list" style="display:none"></div>
    `;
    container.appendChild(section);

    const toggle = section.querySelector('#toggle-bookings');
    const list = section.querySelector('#bookings-list');

    toggle.addEventListener('click', () => {
      list.style.display = list.style.display === 'none' ? 'block' : 'none';
    });

    state.bookings.forEach((b, idx) => {
      const item = document.createElement('div');
      item.className = 'booking-item';
      item.innerHTML = `
        <div class="booking-item-service">${b.serviceName}</div>
        <div class="booking-item-datetime">${b.dateFormatted} at ${b.time}</div>
        <div class="booking-item-id">${b.id}</div>
        <button class="booking-item-cancel" data-idx="${idx}">Cancel</button>
      `;
      item.querySelector('.booking-item-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('Cancel this booking?')) {
          state.bookings.splice(idx, 1);
          saveBookings();
          renderServices();
          showToast('Booking cancelled');
        }
      });
      list.appendChild(item);
    });
  }

  // ── Date & Time Screen ────────────────────────────────────
  function renderDateTime() {
    renderCalendar();
    renderTimeSlots();
  }

  function renderCalendar() {
    const container = $('#calendar');
    const year = state.calendarYear;
    const month = state.calendarMonth;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const months = ['January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December'];

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const prevDisabled = (year === today.getFullYear() && month <= today.getMonth());
    const maxDate = new Date(today);
    maxDate.setMonth(maxDate.getMonth() + 3);
    const nextDisabled = (year > maxDate.getFullYear() || (year === maxDate.getFullYear() && month >= maxDate.getMonth()));

    let calendarHTML = `
      <div class="calendar-header">
        <button class="calendar-nav" id="cal-prev" ${prevDisabled ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span class="calendar-month">${months[month]} ${year}</span>
        <button class="calendar-nav" id="cal-next" ${nextDisabled ? 'disabled' : ''}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div class="calendar-weekdays">
        ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="calendar-weekday">${d}</div>`).join('')}
      </div>
      <div class="calendar-days">
    `;

    // Empty cells before first day
    for (let i = 0; i < firstDay; i++) {
      calendarHTML += '<div class="calendar-day empty"></div>';
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const date = new Date(year, month, d);
      date.setHours(0, 0, 0, 0);
      const isPast = date < today;
      const isSunday = date.getDay() === 0;
      const isToday = date.getTime() === today.getTime();
      const isSelected = state.selectedDate && state.selectedDate.getTime() === date.getTime();
      const disabled = isPast || isSunday;

      let cls = 'calendar-day';
      if (disabled) cls += ' disabled';
      if (isToday) cls += ' today';
      if (isSelected) cls += ' selected';

      calendarHTML += `<button class="${cls}" data-day="${d}" ${disabled ? 'disabled' : ''}>${d}</button>`;
    }

    calendarHTML += '</div>';
    container.innerHTML = calendarHTML;

    // Event: calendar nav
    const prevBtn = container.querySelector('#cal-prev');
    const nextBtn = container.querySelector('#cal-next');
    if (prevBtn) prevBtn.addEventListener('click', () => {
      state.calendarMonth--;
      if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear--; }
      renderCalendar();
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
      state.calendarMonth++;
      if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear++; }
      renderCalendar();
    });

    // Event: day clicks
    container.querySelectorAll('.calendar-day:not(.disabled):not(.empty)').forEach(btn => {
      btn.addEventListener('click', () => {
        const day = parseInt(btn.dataset.day);
        state.selectedDate = new Date(year, month, day);
        state.selectedDate.setHours(0, 0, 0, 0);
        state.selectedTime = null;
        renderDateTime();
        renderBottomBar();
      });
    });
  }

  function renderTimeSlots() {
    const container = $('#time-slots');
    if (!state.selectedDate) {
      container.innerHTML = '<p class="section-subtitle">Select a date to see available times</p>';
      return;
    }

    const unavailable = getUnavailableSlots(state.selectedDate);
    let html = `<div class="time-slots-label">Available times for ${formatDateShort(state.selectedDate)}</div>`;

    for (const [period, slots] of Object.entries(TIME_SLOTS)) {
      html += `<div class="time-period"><div class="time-period-label">${period}</div><div class="time-slots-grid">`;
      slots.forEach(slot => {
        const isUnavailable = unavailable.has(slot);
        const isSelected = state.selectedTime === slot;
        let cls = 'time-slot';
        if (isUnavailable) cls += ' disabled';
        if (isSelected) cls += ' selected';
        html += `<button class="${cls}" data-time="${slot}" ${isUnavailable ? 'disabled' : ''}>${slot}</button>`;
      });
      html += '</div></div>';
    }

    container.innerHTML = html;

    container.querySelectorAll('.time-slot:not(.disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedTime = btn.dataset.time;
        renderTimeSlots();
        renderBottomBar();
      });
    });
  }

  // ── Details Screen ────────────────────────────────────────
  function renderDetails() {
    const container = $('#screen-details');
    const svc = getServiceById(state.selectedService);

    container.innerHTML = `
      <div class="summary-strip">
        <span class="summary-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          ${svc.name}
        </span>
        <span class="summary-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
          ${formatDateShort(state.selectedDate)}
        </span>
        <span class="summary-chip">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
          ${state.selectedTime}
        </span>
      </div>

      <div class="section-title">Your Information</div>

      <div class="form-group">
        <label class="form-label" for="input-name">Full Name *</label>
        <input class="form-input" type="text" id="input-name" placeholder="Jane Smith" value="${state.customerName}" autocomplete="name">
        <div class="form-error" id="error-name">Please enter your name</div>
      </div>

      <div class="form-group">
        <label class="form-label" for="input-email">Email Address *</label>
        <input class="form-input" type="email" id="input-email" placeholder="jane@example.com" value="${state.customerEmail}" autocomplete="email">
        <div class="form-error" id="error-email">Please enter a valid email</div>
      </div>

      <div class="form-group">
        <label class="form-label" for="input-phone">Phone Number *</label>
        <input class="form-input" type="tel" id="input-phone" placeholder="(555) 123-4567" value="${state.customerPhone}" autocomplete="tel">
        <div class="form-error" id="error-phone">Please enter a valid phone number</div>
      </div>

      <div class="form-group">
        <label class="form-label" for="input-notes">Special Requests</label>
        <textarea class="form-input" id="input-notes" placeholder="Any allergies, preferences, or special requests...">${state.customerNotes}</textarea>
      </div>
    `;

    // Live save form values
    const nameInput = $('#input-name');
    const emailInput = $('#input-email');
    const phoneInput = $('#input-phone');
    const notesInput = $('#input-notes');

    nameInput.addEventListener('input', () => { state.customerName = nameInput.value; clearError('name'); });
    emailInput.addEventListener('input', () => { state.customerEmail = emailInput.value; clearError('email'); });
    phoneInput.addEventListener('input', () => { state.customerPhone = phoneInput.value; formatPhone(phoneInput); clearError('phone'); });
    notesInput.addEventListener('input', () => { state.customerNotes = notesInput.value; });
  }

  function formatPhone(input) {
    let val = input.value.replace(/\D/g, '');
    if (val.length > 10) val = val.slice(0, 10);
    if (val.length >= 7) {
      input.value = `(${val.slice(0, 3)}) ${val.slice(3, 6)}-${val.slice(6)}`;
    } else if (val.length >= 4) {
      input.value = `(${val.slice(0, 3)}) ${val.slice(3)}`;
    } else if (val.length > 0) {
      input.value = `(${val}`;
    }
    state.customerPhone = input.value;
  }

  function clearError(field) {
    const input = $(`#input-${field}`);
    const error = $(`#error-${field}`);
    if (input) input.classList.remove('error');
    if (error) error.classList.remove('visible');
  }

  function validateForm() {
    let valid = true;

    if (!state.customerName.trim()) {
      $('#input-name').classList.add('error');
      $('#error-name').classList.add('visible');
      valid = false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(state.customerEmail)) {
      $('#input-email').classList.add('error');
      $('#error-email').classList.add('visible');
      valid = false;
    }

    const phoneDigits = state.customerPhone.replace(/\D/g, '');
    if (phoneDigits.length < 10) {
      $('#input-phone').classList.add('error');
      $('#error-phone').classList.add('visible');
      valid = false;
    }

    return valid;
  }

  // ── Confirm Screen ────────────────────────────────────────
  function renderConfirm() {
    const svc = getServiceById(state.selectedService);
    const booking = state.bookings[state.bookings.length - 1];
    const container = $('#screen-confirm');

    container.innerHTML = `
      <div class="confirm-card">
        <div class="confirm-status">
          <div class="confirm-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
          <div class="confirm-heading">Booking Confirmed!</div>
          <div class="confirm-subtext">A confirmation will be sent to ${state.customerEmail}</div>
        </div>
        <div class="confirm-details">
          <div class="confirm-row">
            <span class="confirm-label">Service</span>
            <span class="confirm-value">${svc.name}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Date</span>
            <span class="confirm-value">${formatDate(state.selectedDate)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Time</span>
            <span class="confirm-value">${state.selectedTime}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Duration</span>
            <span class="confirm-value">${svc.duration} minutes</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Name</span>
            <span class="confirm-value">${state.customerName}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">Phone</span>
            <span class="confirm-value">${state.customerPhone}</span>
          </div>
          ${state.customerNotes ? `<div class="confirm-row"><span class="confirm-label">Notes</span><span class="confirm-value">${state.customerNotes}</span></div>` : ''}
        </div>
        <div class="confirm-total">
          <span class="confirm-total-label">Total</span>
          <span class="confirm-total-price">$${svc.price}</span>
        </div>
      </div>

      <div class="booking-id">
        <div class="booking-id-label">Booking Reference</div>
        <div class="booking-id-value">${booking.id}</div>
      </div>
    `;
  }

  // ── Bottom Bar ────────────────────────────────────────────
  function renderBottomBar() {
    const bar = $('#bottom-bar');

    if (state.step === 0) {
      bar.innerHTML = `
        <button class="btn btn-primary" id="btn-next" ${!state.selectedService ? 'disabled' : ''}>
          Continue
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      `;
    } else if (state.step === 1) {
      const svc = getServiceById(state.selectedService);
      bar.innerHTML = `
        <button class="btn btn-primary" id="btn-next" ${!(state.selectedDate && state.selectedTime) ? 'disabled' : ''}>
          Continue — $${svc.price}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      `;
    } else if (state.step === 2) {
      const svc = getServiceById(state.selectedService);
      bar.innerHTML = `
        <button class="btn btn-accent" id="btn-book">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          Confirm Booking — $${svc.price}
        </button>
      `;
    } else if (state.step === 3) {
      bar.innerHTML = `
        <button class="btn btn-primary" id="btn-new">
          Book Another Service
        </button>
      `;
    }

    // Attach events
    const nextBtn = bar.querySelector('#btn-next');
    const bookBtn = bar.querySelector('#btn-book');
    const newBtn = bar.querySelector('#btn-new');

    if (nextBtn) nextBtn.addEventListener('click', goNext);
    if (bookBtn) bookBtn.addEventListener('click', confirmBooking);
    if (newBtn) newBtn.addEventListener('click', resetBooking);
  }

  // ── Navigation ────────────────────────────────────────────
  function goNext() {
    if (state.step === 0 && !state.selectedService) return;
    if (state.step === 1 && !(state.selectedDate && state.selectedTime)) return;
    state.step++;
    window.scrollTo(0, 0);
    render();
  }

  function goBack() {
    if (state.step > 0 && state.step < 3) {
      state.step--;
      window.scrollTo(0, 0);
      render();
    } else if (state.step === 3) {
      resetBooking();
    }
  }

  function confirmBooking() {
    if (!validateForm()) {
      showToast('Please fill in all required fields');
      return;
    }

    const svc = getServiceById(state.selectedService);
    const booking = {
      id: generateBookingId(),
      serviceId: state.selectedService,
      serviceName: svc.name,
      price: svc.price,
      duration: svc.duration,
      date: state.selectedDate.toISOString(),
      dateFormatted: formatDate(state.selectedDate),
      time: state.selectedTime,
      name: state.customerName,
      email: state.customerEmail,
      phone: state.customerPhone,
      notes: state.customerNotes,
      createdAt: new Date().toISOString()
    };

    state.bookings.push(booking);
    saveBookings();
    state.step = 3;
    window.scrollTo(0, 0);
    render();
    showToast('Booking confirmed!');
  }

  function resetBooking() {
    state.step = 0;
    state.selectedService = null;
    state.selectedDate = null;
    state.selectedTime = null;
    state.customerName = '';
    state.customerEmail = '';
    state.customerPhone = '';
    state.customerNotes = '';
    window.scrollTo(0, 0);
    render();
  }

  // ── Init ──────────────────────────────────────────────────
  function init() {
    // Back button
    $('.header-back').addEventListener('click', goBack);

    // Initial render
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
