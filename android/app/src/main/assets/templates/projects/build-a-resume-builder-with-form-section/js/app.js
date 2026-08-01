/* ===== ResumeForge — Complete Application Logic ===== */

(function () {
  'use strict';

  // ===== State =====
  const sampleData = {
    personal: {
      fullName: 'Sarah Chen',
      jobTitle: 'Senior Full-Stack Developer',
      email: 'sarah.chen@email.com',
      phone: '+1 (415) 555-0192',
      location: 'San Francisco, CA',
      website: 'linkedin.com/in/sarahchen'
    },
    experience: [
      {
        id: 1,
        title: 'Senior Full-Stack Developer',
        company: 'TechFlow Inc.',
        startDate: 'Mar 2022',
        endDate: 'Present',
        current: true,
        location: 'San Francisco, CA',
        description: 'Led a team of 6 engineers to rebuild the core billing platform, reducing payment failures by 35%\nArchitected a real-time analytics dashboard serving 50K+ daily active users\nMentored 3 junior developers and established code review best practices'
      },
      {
        id: 2,
        title: 'Full-Stack Developer',
        company: 'DataBridge Solutions',
        startDate: 'Jun 2019',
        endDate: 'Feb 2022',
        current: false,
        location: 'Austin, TX',
        description: 'Built and maintained RESTful APIs handling 2M+ requests per day\nImplemented CI/CD pipelines that reduced deployment time from 2 hours to 15 minutes\nCollaborated with product and design teams to deliver 12 major feature releases'
      }
    ],
    education: [
      {
        id: 3,
        degree: 'Bachelor of Science',
        school: 'University of California, Berkeley',
        startDate: '2015',
        endDate: '2019',
        field: 'Computer Science',
        gpa: '3.7',
        description: ''
      }
    ],
    skills: [
      { id: 4, name: 'JavaScript', category: 'Technical', level: 5 },
      { id: 5, name: 'TypeScript', category: 'Technical', level: 5 },
      { id: 6, name: 'Python', category: 'Technical', level: 4 },
      { id: 7, name: 'React', category: 'Frameworks', level: 5 },
      { id: 8, name: 'Node.js', category: 'Frameworks', level: 5 },
      { id: 9, name: 'PostgreSQL', category: 'Tools', level: 4 },
      { id: 10, name: 'Docker', category: 'Tools', level: 4 },
      { id: 11, name: 'AWS', category: 'Tools', level: 3 },
      { id: 12, name: 'Team Leadership', category: 'Soft Skills', level: 4 },
      { id: 13, name: 'Agile/Scrum', category: 'Soft Skills', level: 4 }
    ],
    summary: 'Senior full-stack developer with 5+ years of experience building scalable web applications. Passionate about clean architecture, performance optimization, and mentoring engineers. Proven track record of leading cross-functional teams to deliver high-impact products on time.',
    template: 'modern',
    accentColor: '#6C63FF',
    fontScale: 1,
    darkMode: false
  };

  const state = {
    personal: { fullName: '', jobTitle: '', email: '', phone: '', location: '', website: '' },
    experience: [],
    education: [],
    skills: [],
    summary: '',
    template: 'modern',
    accentColor: '#6C63FF',
    fontScale: 1,
    darkMode: false
  };

  let idCounter = 100;
  function uid() { return ++idCounter; }

  // ===== Voice Input (Web Speech API) =====
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let activeRecognition = null;
  let activeMicBtn = null;

  function addVoiceButton(input) {
    if (!SpeechRecognition) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'voice-input-wrapper';
    input.parentNode.insertBefore(wrapper, input);
    wrapper.appendChild(input);

    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'btn-voice';
    micBtn.title = 'Voice input';
    micBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 10a2.5 2.5 0 002.5-2.5v-4a2.5 2.5 0 00-5 0v4A2.5 2.5 0 008 10zm4-2.5a4 4 0 01-3.5 3.97V13H10v1.5H6V13H7.5v-1.53A4 4 0 014 7.5h1.5a2.5 2.5 0 005 0H12z"/></svg>';
    wrapper.appendChild(micBtn);

    micBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (activeMicBtn === micBtn) {
        stopVoice();
        return;
      }
      if (activeRecognition) stopVoice();
      startVoice(input, micBtn);
    });
  }

  function startVoice(input, micBtn) {
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    activeRecognition = recognition;
    activeMicBtn = micBtn;
    micBtn.classList.add('recording');

    const isTextarea = input.tagName === 'TEXTAREA';
    const startVal = input.value;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      if (isTextarea && startVal) {
        input.value = startVal + (startVal.endsWith(' ') ? '' : ' ') + transcript;
      } else {
        input.value = startVal ? startVal + ' ' + transcript : transcript;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    recognition.onerror = () => stopVoice();
    recognition.onend = () => stopVoice();

    recognition.start();
  }

  function stopVoice() {
    if (activeRecognition) {
      try { activeRecognition.stop(); } catch (e) {}
      activeRecognition = null;
    }
    if (activeMicBtn) {
      activeMicBtn.classList.remove('recording');
      activeMicBtn = null;
    }
  }

  // ===== DOM refs =====
  const $ = (sel, ctx) => (ctx || document).querySelector(sel);
  const $$ = (sel, ctx) => [...(ctx || document).querySelectorAll(sel)];

  // Views
  const editorView = $('#editorView');
  const previewView = $('#previewView');
  const exportView = $('#exportView');
  const views = { editor: editorView, preview: previewView, export: exportView };

  // Preview targets
  const resumePreview = $('#resumePreview');
  const resumePreviewFull = $('#resumePreviewFull');
  const resumeExportPreview = $('#resumeExportPreview');

  // ===== Init =====
  function init() {
    loadState();
    bindNavigation();
    bindSectionTabs();
    bindPersonalForm();
    bindExperience();
    bindEducation();
    bindSkills();
    bindSummary();
    bindTemplates();
    bindExportOptions();
    bindDarkMode();
    bindSave();
    clonePreviewTemplateSwitcher();
    populateFormFromState();
    renderAllPreviews();
  }

  // ===== LocalStorage =====
  function loadState() {
    try {
      const saved = localStorage.getItem('resumeforge_data');
      if (saved) {
        const data = JSON.parse(saved);
        Object.assign(state, data);
      } else {
        Object.assign(state, JSON.parse(JSON.stringify(sampleData)));
      }
    } catch (e) {
      Object.assign(state, JSON.parse(JSON.stringify(sampleData)));
    }
    if (state.darkMode) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  }

  function saveState() {
    try {
      localStorage.setItem('resumeforge_data', JSON.stringify(state));
    } catch (e) { /* ignore */ }
  }

  function populateFormFromState() {
    // Personal
    $('#fullName').value = state.personal.fullName;
    $('#jobTitle').value = state.personal.jobTitle;
    $('#email').value = state.personal.email;
    $('#phone').value = state.personal.phone;
    $('#location').value = state.personal.location;
    $('#website').value = state.personal.website;

    // Summary
    $('#summary').value = state.summary;
    $('#summaryCount').textContent = state.summary.length;

    // Experience
    renderExperienceList();

    // Education
    renderEducationList();

    // Skills
    renderSkillsList();

    // Template
    setActiveTemplate(state.template);

    // Accent color
    setActiveColor(state.accentColor);

    // Font scale
    $('#fontSizeDisplay').textContent = Math.round(state.fontScale * 100) + '%';
  }

  // ===== Navigation =====
  function bindNavigation() {
    $$('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        $$('.nav-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Object.values(views).forEach(v => v.classList.add('hidden'));
        views[view].classList.remove('hidden');
        if (view === 'preview' || view === 'export') {
          renderAllPreviews();
        }
      });
    });
  }

  // ===== Section Tabs =====
  function bindSectionTabs() {
    $$('.section-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        $$('.section-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        $$('.form-section').forEach(s => s.classList.remove('active'));
        $(`#section-${tab.dataset.section}`).classList.add('active');
      });
    });
  }

  // ===== Personal Form =====
  function bindPersonalForm() {
    const fields = ['fullName', 'jobTitle', 'email', 'phone', 'location', 'website'];
    fields.forEach(field => {
      const el = $(`#${field}`);
      addVoiceButton(el);
      el.addEventListener('input', () => {
        state.personal[field] = el.value.trim();
        renderAllPreviews();
      });
    });
  }

  // ===== Experience =====
  function bindExperience() {
    $('#addExperience').addEventListener('click', () => {
      showExperienceForm();
    });
  }

  function showExperienceForm(entry = null) {
    const list = $('#experienceList');
    // Remove any open forms
    const openForm = list.querySelector('.entry-card.editing');
    if (openForm) openForm.remove();

    const card = document.createElement('div');
    card.className = 'entry-card editing';
    const isEdit = !!entry;

    card.innerHTML = `
      <div class="entry-form">
        <div class="form-row">
          <input type="text" placeholder="Job Title *" class="exp-title">
          <input type="text" placeholder="Company *" class="exp-company">
        </div>
        <div class="form-row">
          <input type="text" placeholder="Start Date (e.g. Jan 2020)" class="exp-start">
          <input type="text" placeholder="End Date (or Present)" class="exp-end">
        </div>
        <div class="checkbox-row">
          <input type="checkbox" class="exp-current"> I currently work here
        </div>
        <input type="text" placeholder="Location" class="exp-location">
        <textarea placeholder="Description / Achievements (one per line)" class="exp-desc" rows="4"></textarea>
        <div class="form-actions">
          <button class="btn-cancel-entry">Cancel</button>
          <button class="btn-save-entry">${isEdit ? 'Update' : 'Add'}</button>
        </div>
      </div>
    `;

    if (isEdit) {
      card.querySelector('.exp-title').value = entry.title || '';
      card.querySelector('.exp-company').value = entry.company || '';
      card.querySelector('.exp-start').value = entry.startDate || '';
      card.querySelector('.exp-end').value = entry.current ? 'Present' : (entry.endDate || '');
      card.querySelector('.exp-end').disabled = !!entry.current;
      card.querySelector('.exp-current').checked = !!entry.current;
      card.querySelector('.exp-location').value = entry.location || '';
      card.querySelector('.exp-desc').value = entry.description || '';
    }

    // Current checkbox toggles end date
    const currentCb = card.querySelector('.exp-current');
    const endInput = card.querySelector('.exp-end');
    currentCb.addEventListener('change', () => {
      endInput.disabled = currentCb.checked;
      if (currentCb.checked) endInput.value = 'Present';
      else endInput.value = '';
    });

    card.querySelector('.btn-cancel-entry').addEventListener('click', () => {
      if (isEdit) {
        renderExperienceList();
      } else {
        card.remove();
      }
    });

    card.querySelector('.btn-save-entry').addEventListener('click', () => {
      const title = card.querySelector('.exp-title').value.trim();
      const company = card.querySelector('.exp-company').value.trim();
      if (!title || !company) {
        if (!title) card.querySelector('.exp-title').classList.add('error');
        if (!company) card.querySelector('.exp-company').classList.add('error');
        showToast('Please fill in required fields');
        return;
      }

      const data = {
        id: isEdit ? entry.id : uid(),
        title,
        company,
        startDate: card.querySelector('.exp-start').value.trim(),
        endDate: currentCb.checked ? 'Present' : card.querySelector('.exp-end').value.trim(),
        current: currentCb.checked,
        location: card.querySelector('.exp-location').value.trim(),
        description: card.querySelector('.exp-desc').value.trim()
      };

      if (isEdit) {
        const idx = state.experience.findIndex(e => e.id === entry.id);
        if (idx !== -1) state.experience[idx] = data;
      } else {
        state.experience.push(data);
      }

      saveState();
      renderExperienceList();
      renderAllPreviews();
    });

    if (isEdit) {
      // Replace existing card
      const existingCard = list.querySelector(`[data-id="${entry.id}"]`);
      if (existingCard) existingCard.replaceWith(card);
    } else {
      list.prepend(card);
    }
  }

  function renderExperienceList() {
    const list = $('#experienceList');
    list.innerHTML = '';
    if (state.experience.length === 0) {
      list.innerHTML = '<div class="empty-state">No experience added yet. Click "+ Add Position" to get started.</div>';
      return;
    }
    state.experience.forEach(entry => {
      const card = document.createElement('div');
      card.className = 'entry-card';
      card.dataset.id = entry.id;
      card.innerHTML = `
        <div class="entry-header">
          <div>
            <div class="entry-title">${esc(entry.title)}</div>
            <div class="entry-subtitle">${esc(entry.company)}${entry.startDate ? ' · ' + esc(entry.startDate) + ' – ' + esc(entry.endDate || 'Present') : ''}</div>
          </div>
          <div class="entry-actions">
            <button class="btn-edit" title="Edit">&#9998;</button>
            <button class="btn-delete" title="Delete">&#10005;</button>
          </div>
        </div>
        ${entry.description ? `<div class="entry-desc-preview" style="font-size:.82rem;color:var(--text-secondary);white-space:pre-line;max-height:60px;overflow:hidden;">${esc(entry.description)}</div>` : ''}
      `;

      card.querySelector('.btn-edit').addEventListener('click', () => showExperienceForm(entry));
      card.querySelector('.btn-delete').addEventListener('click', () => {
        state.experience = state.experience.filter(e => e.id !== entry.id);
        saveState();
        renderExperienceList();
        renderAllPreviews();
      });

      list.appendChild(card);
    });
  }

  // ===== Education =====
  function bindEducation() {
    $('#addEducation').addEventListener('click', () => {
      showEducationForm();
    });
  }

  function showEducationForm(entry = null) {
    const list = $('#educationList');
    const openForm = list.querySelector('.entry-card.editing');
    if (openForm) openForm.remove();

    const card = document.createElement('div');
    card.className = 'entry-card editing';
    const isEdit = !!entry;

    card.innerHTML = `
      <div class="entry-form">
        <div class="form-row">
          <input type="text" placeholder="Degree *" class="edu-degree">
          <input type="text" placeholder="School / University *" class="edu-school">
        </div>
        <div class="form-row">
          <input type="text" placeholder="Start Year" class="edu-start">
          <input type="text" placeholder="End Year" class="edu-end">
        </div>
        <input type="text" placeholder="Field of Study" class="edu-field">
        <input type="text" placeholder="GPA (optional)" class="edu-gpa">
        <textarea placeholder="Additional details" class="edu-desc" rows="2"></textarea>
        <div class="form-actions">
          <button class="btn-cancel-entry">Cancel</button>
          <button class="btn-save-entry">${isEdit ? 'Update' : 'Add'}</button>
        </div>
      </div>
    `;

    if (isEdit) {
      card.querySelector('.edu-degree').value = entry.degree || '';
      card.querySelector('.edu-school').value = entry.school || '';
      card.querySelector('.edu-start').value = entry.startDate || '';
      card.querySelector('.edu-end').value = entry.endDate || '';
      card.querySelector('.edu-field').value = entry.field || '';
      card.querySelector('.edu-gpa').value = entry.gpa || '';
      card.querySelector('.edu-desc').value = entry.description || '';
    }

    card.querySelector('.btn-cancel-entry').addEventListener('click', () => {
      if (isEdit) {
        renderEducationList();
      } else {
        card.remove();
      }
    });

    card.querySelector('.btn-save-entry').addEventListener('click', () => {
      const degree = card.querySelector('.edu-degree').value.trim();
      const school = card.querySelector('.edu-school').value.trim();
      if (!degree || !school) {
        if (!degree) card.querySelector('.edu-degree').classList.add('error');
        if (!school) card.querySelector('.edu-school').classList.add('error');
        showToast('Please fill in required fields');
        return;
      }

      const data = {
        id: isEdit ? entry.id : uid(),
        degree,
        school,
        startDate: card.querySelector('.edu-start').value.trim(),
        endDate: card.querySelector('.edu-end').value.trim(),
        field: card.querySelector('.edu-field').value.trim(),
        gpa: card.querySelector('.edu-gpa').value.trim(),
        description: card.querySelector('.edu-desc').value.trim()
      };

      if (isEdit) {
        const idx = state.education.findIndex(e => e.id === entry.id);
        if (idx !== -1) state.education[idx] = data;
      } else {
        state.education.push(data);
      }

      saveState();
      renderEducationList();
      renderAllPreviews();
    });

    if (isEdit) {
      const existingCard = list.querySelector(`[data-id="${entry.id}"]`);
      if (existingCard) existingCard.replaceWith(card);
    } else {
      list.prepend(card);
    }
  }

  function renderEducationList() {
    const list = $('#educationList');
    list.innerHTML = '';
    state.education.forEach(entry => {
      const card = document.createElement('div');
      card.className = 'entry-card';
      card.dataset.id = entry.id;
      card.innerHTML = `
        <div class="entry-header">
          <div>
            <div class="entry-title">${esc(entry.degree)}${entry.field ? ' in ' + esc(entry.field) : ''}</div>
            <div class="entry-subtitle">${esc(entry.school)}${entry.startDate ? ' · ' + esc(entry.startDate) + ' – ' + esc(entry.endDate || 'Present') : ''}${entry.gpa ? ' · GPA: ' + esc(entry.gpa) : ''}</div>
          </div>
          <div class="entry-actions">
            <button class="btn-edit" title="Edit">&#9998;</button>
            <button class="btn-delete" title="Delete">&#10005;</button>
          </div>
        </div>
      `;

      card.querySelector('.btn-edit').addEventListener('click', () => showEducationForm(entry));
      card.querySelector('.btn-delete').addEventListener('click', () => {
        state.education = state.education.filter(e => e.id !== entry.id);
        saveState();
        renderEducationList();
        renderAllPreviews();
      });

      list.appendChild(card);
    });
  }

  // ===== Skills =====
  function bindSkills() {
    const input = $('#skillInput');
    const addBtn = $('#addSkillBtn');
    addVoiceButton(input);

    function addSkill() {
      const name = input.value.trim();
      if (!name) return;
      if (state.skills.find(s => s.name.toLowerCase() === name.toLowerCase())) {
        showToast('Skill already added');
        return;
      }

      state.skills.push({
        id: uid(),
        name,
        category: $('#skillCategory').value,
        level: parseInt($('#skillLevel').value)
      });

      input.value = '';
      saveState();
      renderSkillsList();
      renderAllPreviews();
      input.focus();
    }

    addBtn.addEventListener('click', addSkill);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addSkill(); }
    });
  }

  function renderSkillsList() {
    const container = $('#skillsList');
    container.innerHTML = '';

    // Group by category
    const groups = {};
    state.skills.forEach(skill => {
      const cat = skill.category || 'General';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(skill);
    });

    Object.keys(groups).forEach(cat => {
      const groupEl = document.createElement('div');
      groupEl.innerHTML = `<div class="skill-group-label">${esc(cat)}</div>`;
      const tagsContainer = document.createElement('div');
      tagsContainer.className = 'skill-tags-container';

      groups[cat].forEach(skill => {
        const tag = document.createElement('span');
        tag.className = 'skill-tag';

        let dots = '';
        for (let i = 1; i <= 5; i++) {
          dots += `<span class="skill-dot ${i <= skill.level ? 'filled' : ''}"></span>`;
        }

        tag.innerHTML = `
          ${esc(skill.name)}
          <span class="skill-dots">${dots}</span>
          <button class="remove-skill" title="Remove">&times;</button>
        `;

        tag.querySelector('.remove-skill').addEventListener('click', () => {
          state.skills = state.skills.filter(s => s.id !== skill.id);
          saveState();
          renderSkillsList();
          renderAllPreviews();
        });

        tagsContainer.appendChild(tag);
      });

      groupEl.appendChild(tagsContainer);
      container.appendChild(groupEl);
    });
  }

  // ===== Summary =====
  function bindSummary() {
    const textarea = $('#summary');
    const counter = $('#summaryCount');
    addVoiceButton(textarea);

    textarea.addEventListener('input', () => {
      if (textarea.value.length > 500) {
        textarea.value = textarea.value.substring(0, 500);
      }
      state.summary = textarea.value;
      counter.textContent = textarea.value.length;
      renderAllPreviews();
    });
  }

  // ===== Templates =====
  function bindTemplates() {
    // Editor preview template buttons
    $$('.template-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        state.template = btn.dataset.template;
        setActiveTemplate(state.template);
        saveState();
        renderAllPreviews();
      });
    });

    // Export template cards
    $$('.template-card').forEach(card => {
      card.addEventListener('click', () => {
        state.template = card.dataset.template;
        setActiveTemplate(state.template);
        saveState();
        renderAllPreviews();
      });
    });
  }

  function setActiveTemplate(template) {
    $$('.template-btn').forEach(b => b.classList.toggle('active', b.dataset.template === template));
    $$('.template-card').forEach(c => c.classList.toggle('active', c.dataset.template === template));
  }

  // ===== Export Options =====
  function bindExportOptions() {
    // Color swatches
    $$('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        state.accentColor = swatch.dataset.color;
        setActiveColor(state.accentColor);
        saveState();
        renderAllPreviews();
      });
    });

    // Font size
    $('#fontDecrease').addEventListener('click', () => {
      state.fontScale = Math.max(0.7, state.fontScale - 0.05);
      $('#fontSizeDisplay').textContent = Math.round(state.fontScale * 100) + '%';
      saveState();
      renderAllPreviews();
    });

    $('#fontIncrease').addEventListener('click', () => {
      state.fontScale = Math.min(1.3, state.fontScale + 0.05);
      $('#fontSizeDisplay').textContent = Math.round(state.fontScale * 100) + '%';
      saveState();
      renderAllPreviews();
    });

    // Print
    $('#btnPrint').addEventListener('click', () => {
      window.print();
    });

    // Download HTML
    $('#btnDownloadHTML').addEventListener('click', downloadHTML);
  }

  function setActiveColor(color) {
    $$('.color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === color));
  }

  // ===== Dark Mode =====
  function bindDarkMode() {
    $('#btnDarkMode').addEventListener('click', () => {
      state.darkMode = !state.darkMode;
      document.documentElement.setAttribute('data-theme', state.darkMode ? 'dark' : '');
      saveState();
    });
  }

  // ===== Save Button =====
  function bindSave() {
    $('#btnSave').addEventListener('click', () => {
      saveState();
      showToast('Resume saved successfully!');
    });
  }

  // ===== Clone Preview Template Switcher =====
  function clonePreviewTemplateSwitcher() {
    const source = $('.preview-panel .template-switcher');
    const target = $('#previewTemplateSwitcher');
    if (source && target) {
      target.innerHTML = source.innerHTML;
      $$('.template-btn', target).forEach(btn => {
        btn.addEventListener('click', () => {
          state.template = btn.dataset.template;
          setActiveTemplate(state.template);
          saveState();
          renderAllPreviews();
        });
      });
    }
  }

  // ===== Toast =====
  function showToast(msg) {
    const toast = $('#toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2500);
  }

  // ===== Render Resume =====
  function renderAllPreviews() {
    const html = generateResumeHTML();
    resumePreview.innerHTML = html;
    resumePreviewFull.innerHTML = html;
    resumeExportPreview.innerHTML = html;
  }

  function generateResumeHTML() {
    const p = state.personal;
    const hasContent = p.fullName || p.email || state.experience.length || state.education.length || state.skills.length || state.summary;

    if (!hasContent) {
      return `<div class="resume-placeholder">
        <svg width="64" height="64" viewBox="0 0 64 64" opacity=".3"><rect x="8" y="4" width="48" height="56" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><rect x="16" y="12" width="20" height="4" rx="2" fill="currentColor"/><rect x="16" y="20" width="32" height="2" rx="1" fill="currentColor" opacity=".5"/><rect x="16" y="26" width="32" height="2" rx="1" fill="currentColor" opacity=".5"/><rect x="16" y="32" width="24" height="2" rx="1" fill="currentColor" opacity=".3"/><rect x="16" y="40" width="32" height="2" rx="1" fill="currentColor" opacity=".5"/><rect x="16" y="46" width="28" height="2" rx="1" fill="currentColor" opacity=".3"/></svg>
        <p>Start filling in your details to see a live preview</p>
      </div>`;
    }

    const tmpl = state.template;

    // Contact line
    const contactItems = [];
    if (p.email) contactItems.push(esc(p.email));
    if (p.phone) contactItems.push(esc(p.phone));
    if (p.location) contactItems.push(esc(p.location));
    if (p.website) contactItems.push(esc(p.website));

    let contactHTML = '';
    if (tmpl === 'modern') {
      contactHTML = `<div class="resume-contact">${contactItems.map(c => `<span>${c}</span>`).join('')}</div>`;
    } else {
      contactHTML = `<div class="resume-contact">${contactItems.map(c => `<span>${c}</span>`).join('')}</div>`;
    }

    // Header
    const headerHTML = `
      <div class="resume-header">
        <div>
          <div class="resume-name">${esc(p.fullName) || 'Your Name'}</div>
          ${p.jobTitle ? `<div class="resume-title">${esc(p.jobTitle)}</div>` : ''}
          ${tmpl !== 'modern' ? contactHTML : ''}
        </div>
        ${tmpl === 'modern' ? contactHTML : ''}
      </div>
    `;

    // Summary
    let summaryHTML = '';
    if (state.summary) {
      summaryHTML = `
        <div class="section-title">Professional Summary</div>
        <div class="resume-summary">${esc(state.summary)}</div>
      `;
    }

    // Experience
    let experienceHTML = '';
    if (state.experience.length > 0) {
      experienceHTML = `<div class="section-title">Experience</div>`;
      state.experience.forEach(exp => {
        const dateRange = exp.startDate ? `${esc(exp.startDate)} – ${esc(exp.endDate || 'Present')}` : '';
        experienceHTML += `
          <div class="resume-entry">
            <div class="resume-entry-header">
              <div class="resume-entry-title">${esc(exp.title)}</div>
              <div class="resume-entry-date">${dateRange}</div>
            </div>
            <div class="resume-entry-org">${esc(exp.company)}${exp.location ? ' · ' + esc(exp.location) : ''}</div>
            ${exp.description ? `<div class="resume-entry-desc">${esc(exp.description)}</div>` : ''}
          </div>
        `;
      });
    }

    // Education
    let educationHTML = '';
    if (state.education.length > 0) {
      educationHTML = `<div class="section-title">Education</div>`;
      state.education.forEach(edu => {
        const dateRange = edu.startDate ? `${esc(edu.startDate)} – ${esc(edu.endDate || 'Present')}` : '';
        educationHTML += `
          <div class="resume-entry">
            <div class="resume-entry-header">
              <div class="resume-entry-title">${esc(edu.degree)}${edu.field ? ' in ' + esc(edu.field) : ''}</div>
              <div class="resume-entry-date">${dateRange}</div>
            </div>
            <div class="resume-entry-org">${esc(edu.school)}${edu.gpa ? ' · GPA: ' + esc(edu.gpa) : ''}</div>
            ${edu.description ? `<div class="resume-entry-desc">${esc(edu.description)}</div>` : ''}
          </div>
        `;
      });
    }

    // Skills
    let skillsHTML = '';
    if (state.skills.length > 0) {
      skillsHTML = `<div class="section-title">Skills</div>`;

      const groups = {};
      state.skills.forEach(s => {
        const cat = s.category || 'General';
        if (!groups[cat]) groups[cat] = [];
        groups[cat].push(s);
      });

      const catKeys = Object.keys(groups);
      if (catKeys.length === 1 && catKeys[0] === 'General') {
        // Single flat list
        skillsHTML += `<div class="resume-skills-grid">`;
        groups['General'].forEach(s => {
          skillsHTML += `<span class="resume-skill-chip">${esc(s.name)}</span>`;
        });
        skillsHTML += `</div>`;
      } else {
        catKeys.forEach(cat => {
          skillsHTML += `<div class="resume-skill-group">`;
          skillsHTML += `<div class="resume-skill-group-label">${esc(cat)}</div>`;
          skillsHTML += `<div class="resume-skills-grid">`;
          groups[cat].forEach(s => {
            skillsHTML += `<span class="resume-skill-chip">${esc(s.name)}</span>`;
          });
          skillsHTML += `</div></div>`;
        });
      }
    }

    return `<div class="resume-render template-${tmpl}" style="--accent:${state.accentColor};--font-scale:${state.fontScale}">
      ${headerHTML}
      ${summaryHTML}
      ${experienceHTML}
      ${educationHTML}
      ${skillsHTML}
    </div>`;
  }

  // ===== Download HTML =====
  function downloadHTML() {
    const resumeContent = generateResumeHTML();
    const fullHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(state.personal.fullName || 'Resume')}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f6fa; display: flex; justify-content: center; padding: 24px; }
  .resume-render { width: 100%; max-width: 680px; background: #fff; color: #1a1a2e; padding: 40px; border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.12); font-size: calc(.85rem * var(--font-scale)); line-height: 1.5; min-height: 800px; }
  .resume-render.template-modern .resume-header { display: flex; justify-content: space-between; align-items: flex-start; padding-bottom: 20px; border-bottom: 3px solid var(--accent); margin-bottom: 24px; }
  .resume-render.template-modern .resume-name { font-size: calc(1.8rem * var(--font-scale)); font-weight: 800; color: #1a1a2e; line-height: 1.1; }
  .resume-render.template-modern .resume-title { font-size: calc(1rem * var(--font-scale)); color: var(--accent); font-weight: 500; margin-top: 4px; }
  .resume-render.template-modern .resume-contact { text-align: right; font-size: calc(.78rem * var(--font-scale)); color: #6b7280; display: flex; flex-direction: column; gap: 3px; }
  .resume-render.template-modern .section-title { font-size: calc(.85rem * var(--font-scale)); font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 6px; margin-bottom: 14px; margin-top: 22px; }
  .resume-render.template-classic .resume-header { text-align: center; padding-bottom: 16px; border-bottom: 2px solid #333; margin-bottom: 20px; }
  .resume-render.template-classic .resume-name { font-size: calc(2rem * var(--font-scale)); font-weight: 700; color: #1a1a2e; text-transform: uppercase; letter-spacing: 3px; }
  .resume-render.template-classic .resume-title { font-size: calc(.95rem * var(--font-scale)); color: #555; margin-top: 2px; }
  .resume-render.template-classic .resume-contact { display: flex; justify-content: center; gap: 16px; font-size: calc(.78rem * var(--font-scale)); color: #666; margin-top: 8px; flex-wrap: wrap; }
  .resume-render.template-classic .section-title { font-size: calc(.9rem * var(--font-scale)); font-weight: 700; text-transform: uppercase; letter-spacing: 2px; color: #1a1a2e; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 12px; margin-top: 20px; }
  .resume-render.template-minimal { padding: 48px; }
  .resume-render.template-minimal .resume-header { margin-bottom: 30px; }
  .resume-render.template-minimal .resume-name { font-size: calc(2.2rem * var(--font-scale)); font-weight: 300; color: #1a1a2e; letter-spacing: -0.5px; }
  .resume-render.template-minimal .resume-title { font-size: calc(1rem * var(--font-scale)); color: #9ca3af; font-weight: 400; margin-top: 2px; }
  .resume-render.template-minimal .resume-contact { display: flex; gap: 16px; font-size: calc(.78rem * var(--font-scale)); color: #9ca3af; margin-top: 10px; flex-wrap: wrap; }
  .resume-render.template-minimal .section-title { font-size: calc(.78rem * var(--font-scale)); font-weight: 600; text-transform: uppercase; letter-spacing: 3px; color: #9ca3af; margin-bottom: 14px; margin-top: 28px; }
  .resume-render.template-creative { border-left: 6px solid var(--accent); border-radius: 0 10px 10px 0; }
  .resume-render.template-creative .resume-header { background: var(--accent); margin: -40px -40px 24px -40px; padding: 32px 40px; border-radius: 0 10px 0 0; }
  .resume-render.template-creative .resume-name { font-size: calc(1.8rem * var(--font-scale)); font-weight: 800; color: #fff; }
  .resume-render.template-creative .resume-title { font-size: calc(1rem * var(--font-scale)); color: rgba(255,255,255,.8); font-weight: 400; margin-top: 4px; }
  .resume-render.template-creative .resume-contact { display: flex; gap: 16px; font-size: calc(.78rem * var(--font-scale)); color: rgba(255,255,255,.7); margin-top: 10px; flex-wrap: wrap; }
  .resume-render.template-creative .section-title { font-size: calc(.85rem * var(--font-scale)); font-weight: 700; color: var(--accent); margin-bottom: 12px; margin-top: 22px; display: flex; align-items: center; gap: 8px; }
  .resume-render.template-creative .section-title::before { content: ''; width: 8px; height: 8px; background: var(--accent); border-radius: 50%; flex-shrink: 0; }
  .resume-summary { font-size: calc(.88rem * var(--font-scale)); color: #4b5563; line-height: 1.6; margin-bottom: 4px; }
  .resume-entry { margin-bottom: 16px; }
  .resume-entry-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 2px; }
  .resume-entry-title { font-weight: 700; font-size: calc(.9rem * var(--font-scale)); color: #1a1a2e; }
  .resume-entry-date { font-size: calc(.78rem * var(--font-scale)); color: #9ca3af; white-space: nowrap; }
  .resume-entry-org { font-size: calc(.85rem * var(--font-scale)); color: var(--accent); font-weight: 500; }
  .resume-entry-desc { font-size: calc(.83rem * var(--font-scale)); color: #4b5563; margin-top: 4px; line-height: 1.5; white-space: pre-line; }
  .resume-skills-grid { display: flex; flex-wrap: wrap; gap: 6px; }
  .resume-skill-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 12px; background: rgba(108,99,255,.08); color: var(--accent); border-radius: 16px; font-size: calc(.78rem * var(--font-scale)); font-weight: 500; }
  .resume-skill-group { margin-bottom: 10px; }
  .resume-skill-group-label { font-size: calc(.72rem * var(--font-scale)); font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .template-classic .resume-skill-chip { background: transparent; border: 1px solid #ccc; color: #555; }
  .template-minimal .resume-skill-chip { background: transparent; color: #6b7280; padding: 0; font-weight: 400; }
  @media print { body { background: #fff; padding: 0; } .resume-render { box-shadow: none; border-radius: 0; max-width: 100%; } }
</style>
</head>
<body>
${resumeContent}
</body>
</html>`;

    const blob = new Blob([fullHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(state.personal.fullName || 'resume').replace(/\s+/g, '_')}_resume.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Resume downloaded!');
  }

  // ===== Utils =====
  function esc(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ===== Start =====
  document.addEventListener('DOMContentLoaded', init);
})();
