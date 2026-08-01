// Data structure
let pets = [];
let currentPetId = null;
let editingPetId = null;

// Pet type emojis
const petEmojis = {
    dog: '🐕',
    cat: '🐈',
    bird: '🐦',
    rabbit: '🐰',
    fish: '🐠',
    other: '🐾'
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadData();
    initEventListeners();
    render();
});

// Load data from localStorage
function loadData() {
    const savedPets = localStorage.getItem('pawcare_pets');
    if (savedPets) {
        pets = JSON.parse(savedPets);
        if (pets.length > 0) {
            currentPetId = pets[0].id;
        }
    }
}

// Save data to localStorage
function saveData() {
    localStorage.setItem('pawcare_pets', JSON.stringify(pets));
}

// Initialize event listeners
function initEventListeners() {
    // Add pet button
    document.getElementById('addPetBtn').addEventListener('click', () => {
        editingPetId = null;
        document.getElementById('petModalTitle').textContent = 'Add Pet';
        document.getElementById('petForm').reset();
        showModal('petModal');
    });

    // Pet form submit
    document.getElementById('petForm').addEventListener('submit', (e) => {
        e.preventDefault();
        savePet();
    });

    // Cancel pet button
    document.getElementById('cancelPetBtn').addEventListener('click', () => {
        hideModal('petModal');
    });

    // Edit pet button
    document.getElementById('editPetBtn').addEventListener('click', () => {
        const pet = pets.find(p => p.id === currentPetId);
        if (pet) {
            editingPetId = currentPetId;
            document.getElementById('petModalTitle').textContent = 'Edit Pet';
            document.getElementById('petName').value = pet.name;
            document.getElementById('petType').value = pet.type;
            document.getElementById('petBreed').value = pet.breed || '';
            document.getElementById('petAge').value = pet.age || '';
            showModal('petModal');
        }
    });

    // Delete pet button
    document.getElementById('deletePetBtn').addEventListener('click', () => {
        if (confirm('Are you sure you want to delete this pet and all their data?')) {
            deletePet(currentPetId);
        }
    });

    // Tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            switchTab(btn.dataset.tab);
        });
    });

    // Feeding
    document.getElementById('addFeedingBtn').addEventListener('click', () => {
        document.getElementById('feedingForm').reset();
        showModal('feedingModal');
    });

    document.getElementById('feedingForm').addEventListener('submit', (e) => {
        e.preventDefault();
        addFeeding();
    });

    document.getElementById('cancelFeedingBtn').addEventListener('click', () => {
        hideModal('feedingModal');
    });

    // Appointments
    document.getElementById('addAppointmentBtn').addEventListener('click', () => {
        document.getElementById('appointmentForm').reset();
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('appointmentDate').value = today;
        showModal('appointmentModal');
    });

    document.getElementById('appointmentForm').addEventListener('submit', (e) => {
        e.preventDefault();
        addAppointment();
    });

    document.getElementById('cancelAppointmentBtn').addEventListener('click', () => {
        hideModal('appointmentModal');
    });

    // Medications
    document.getElementById('addMedicationBtn').addEventListener('click', () => {
        document.getElementById('medicationForm').reset();
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('medicationStartDate').value = today;
        showModal('medicationModal');
    });

    document.getElementById('medicationForm').addEventListener('submit', (e) => {
        e.preventDefault();
        addMedication();
    });

    document.getElementById('cancelMedicationBtn').addEventListener('click', () => {
        hideModal('medicationModal');
    });

    // Photo gallery
    document.getElementById('addPhotoBtn').addEventListener('click', () => {
        document.getElementById('photoInput').click();
    });

    document.getElementById('photoInput').addEventListener('change', (e) => {
        handlePhotoUpload(e);
    });
}

// Save/update pet
function savePet() {
    const name = document.getElementById('petName').value.trim();
    const type = document.getElementById('petType').value;
    const breed = document.getElementById('petBreed').value.trim();
    const age = document.getElementById('petAge').value.trim();

    if (!name || !type) return;

    if (editingPetId) {
        // Update existing pet
        const pet = pets.find(p => p.id === editingPetId);
        if (pet) {
            pet.name = name;
            pet.type = type;
            pet.breed = breed;
            pet.age = age;
        }
    } else {
        // Add new pet
        const newPet = {
            id: Date.now().toString(),
            name,
            type,
            breed,
            age,
            feedings: [],
            appointments: [],
            medications: [],
            photos: []
        };
        pets.push(newPet);
        currentPetId = newPet.id;
    }

    saveData();
    hideModal('petModal');
    render();
}

// Delete pet
function deletePet(petId) {
    pets = pets.filter(p => p.id !== petId);
    if (pets.length > 0) {
        currentPetId = pets[0].id;
    } else {
        currentPetId = null;
    }
    saveData();
    render();
}

// Add feeding
function addFeeding() {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const feeding = {
        id: Date.now().toString(),
        time: document.getElementById('feedingTime').value,
        foodType: document.getElementById('foodType').value.trim(),
        amount: document.getElementById('foodAmount').value.trim(),
        notes: document.getElementById('feedingNotes').value.trim()
    };

    pet.feedings.push(feeding);
    pet.feedings.sort((a, b) => a.time.localeCompare(b.time));

    saveData();
    hideModal('feedingModal');
    renderFeedings();
}

// Delete feeding
function deleteFeeding(feedingId) {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    pet.feedings = pet.feedings.filter(f => f.id !== feedingId);
    saveData();
    renderFeedings();
}

// Add appointment
function addAppointment() {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const appointment = {
        id: Date.now().toString(),
        date: document.getElementById('appointmentDate').value,
        time: document.getElementById('appointmentTime').value,
        vet: document.getElementById('appointmentVet').value.trim(),
        reason: document.getElementById('appointmentReason').value.trim(),
        notes: document.getElementById('appointmentNotes').value.trim()
    };

    pet.appointments.push(appointment);
    pet.appointments.sort((a, b) => {
        const dateA = new Date(a.date + ' ' + a.time);
        const dateB = new Date(b.date + ' ' + b.time);
        return dateA - dateB;
    });

    saveData();
    hideModal('appointmentModal');
    renderAppointments();
}

// Delete appointment
function deleteAppointment(appointmentId) {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    pet.appointments = pet.appointments.filter(a => a.id !== appointmentId);
    saveData();
    renderAppointments();
}

// Add medication
function addMedication() {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const medication = {
        id: Date.now().toString(),
        name: document.getElementById('medicationName').value.trim(),
        dosage: document.getElementById('medicationDosage').value.trim(),
        frequency: document.getElementById('medicationFrequency').value,
        startDate: document.getElementById('medicationStartDate').value,
        endDate: document.getElementById('medicationEndDate').value,
        notes: document.getElementById('medicationNotes').value.trim()
    };

    pet.medications.push(medication);
    pet.medications.sort((a, b) => {
        // Active medications first
        const aActive = !a.endDate || new Date(a.endDate) >= new Date();
        const bActive = !b.endDate || new Date(b.endDate) >= new Date();
        if (aActive && !bActive) return -1;
        if (!aActive && bActive) return 1;
        return new Date(b.startDate) - new Date(a.startDate);
    });

    saveData();
    hideModal('medicationModal');
    renderMedications();
}

// Delete medication
function deleteMedication(medicationId) {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    pet.medications = pet.medications.filter(m => m.id !== medicationId);
    saveData();
    renderMedications();
}

// Handle photo upload
function handlePhotoUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const photo = {
            id: Date.now().toString(),
            data: event.target.result,
            date: new Date().toISOString()
        };

        pet.photos.push(photo);
        saveData();
        renderGallery();
    };
    reader.readAsDataURL(file);
}

// Delete photo
function deletePhoto(photoId) {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    pet.photos = pet.photos.filter(p => p.id !== photoId);
    saveData();
    renderGallery();
}

// Switch tab
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    document.querySelectorAll('.tab-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    const tabMap = {
        schedule: 'scheduleTab',
        appointments: 'appointmentsTab',
        medications: 'medicationsTab',
        gallery: 'galleryTab'
    };

    document.getElementById(tabMap[tabName]).classList.add('active');
}

// Show modal
function showModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

// Hide modal
function hideModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// Format date
function formatDate(dateStr) {
    const date = new Date(dateStr);
    const options = { month: 'short', day: 'numeric', year: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// Format time
function formatTime(timeStr) {
    const [hours, minutes] = timeStr.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minutes} ${ampm}`;
}

// Format frequency
function formatFrequency(freq) {
    const map = {
        'once-daily': 'Once Daily',
        'twice-daily': 'Twice Daily',
        'three-times-daily': '3x Daily',
        'every-other-day': 'Every Other Day',
        'weekly': 'Weekly',
        'as-needed': 'As Needed'
    };
    return map[freq] || freq;
}

// Render everything
function render() {
    renderPetList();
    renderPetDetails();
}

// Render pet list
function renderPetList() {
    const petList = document.getElementById('petList');
    const noPetsState = document.getElementById('noPetsState');
    const petDetails = document.getElementById('petDetails');

    if (pets.length === 0) {
        petList.innerHTML = '';
        noPetsState.style.display = 'block';
        petDetails.classList.add('hidden');
        return;
    }

    noPetsState.style.display = 'none';
    petDetails.classList.remove('hidden');

    petList.innerHTML = pets.map(pet => `
        <div class="pet-card ${pet.id === currentPetId ? 'active' : ''}"
             onclick="selectPet('${pet.id}')">
            <div class="emoji">${petEmojis[pet.type]}</div>
            <div class="name">${pet.name}</div>
        </div>
    `).join('');
}

// Render pet details
function renderPetDetails() {
    if (!currentPetId) return;

    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const petInfo = document.getElementById('petInfo');
    let infoHtml = `<h2>${pet.name}</h2>`;
    const details = [];
    if (pet.breed) details.push(pet.breed);
    if (pet.age) details.push(pet.age);
    if (details.length > 0) {
        infoHtml += `<p>${details.join(' • ')}</p>`;
    }
    petInfo.innerHTML = infoHtml;

    renderFeedings();
    renderAppointments();
    renderMedications();
    renderGallery();
}

// Render feedings
function renderFeedings() {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const feedingList = document.getElementById('feedingList');

    if (pet.feedings.length === 0) {
        feedingList.innerHTML = `
            <div class="empty-state">
                <div class="emoji">🍽️</div>
                <p>No feeding times added yet</p>
            </div>
        `;
        return;
    }

    feedingList.innerHTML = pet.feedings.map(feeding => `
        <div class="feeding-item">
            <div class="item-time">${formatTime(feeding.time)}</div>
            <div class="item-title">${feeding.foodType}</div>
            ${feeding.amount ? `<div class="item-detail">Amount: ${feeding.amount}</div>` : ''}
            ${feeding.notes ? `<div class="item-notes">${feeding.notes}</div>` : ''}
            <button class="item-delete" onclick="deleteFeeding('${feeding.id}')">Delete</button>
        </div>
    `).join('');
}

// Render appointments
function renderAppointments() {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const appointmentList = document.getElementById('appointmentList');

    if (pet.appointments.length === 0) {
        appointmentList.innerHTML = `
            <div class="empty-state">
                <div class="emoji">📅</div>
                <p>No appointments scheduled</p>
            </div>
        `;
        return;
    }

    const now = new Date();
    appointmentList.innerHTML = pet.appointments.map(appt => {
        const apptDate = new Date(appt.date + ' ' + appt.time);
        const isPast = apptDate < now;

        return `
            <div class="appointment-item" style="${isPast ? 'opacity: 0.6;' : ''}">
                <div class="item-time">${formatDate(appt.date)} at ${formatTime(appt.time)}</div>
                <div class="item-title">${appt.vet}</div>
                ${appt.reason ? `<div class="item-detail">${appt.reason}</div>` : ''}
                ${appt.notes ? `<div class="item-notes">${appt.notes}</div>` : ''}
                <button class="item-delete" onclick="deleteAppointment('${appt.id}')">Delete</button>
            </div>
        `;
    }).join('');
}

// Render medications
function renderMedications() {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const medicationList = document.getElementById('medicationList');

    if (pet.medications.length === 0) {
        medicationList.innerHTML = `
            <div class="empty-state">
                <div class="emoji">💊</div>
                <p>No medications added</p>
            </div>
        `;
        return;
    }

    const today = new Date();
    medicationList.innerHTML = pet.medications.map(med => {
        const isActive = !med.endDate || new Date(med.endDate) >= today;

        return `
            <div class="medication-item">
                <div class="item-title">
                    ${med.name}
                    <span class="${isActive ? 'medication-active' : 'medication-ended'}">
                        ${isActive ? 'Active' : 'Ended'}
                    </span>
                </div>
                <div class="item-detail">Dosage: ${med.dosage}</div>
                <div class="item-detail">Frequency: ${formatFrequency(med.frequency)}</div>
                <div class="item-detail">Start: ${formatDate(med.startDate)}</div>
                ${med.endDate ? `<div class="item-detail">End: ${formatDate(med.endDate)}</div>` : ''}
                ${med.notes ? `<div class="item-notes">${med.notes}</div>` : ''}
                <button class="item-delete" onclick="deleteMedication('${med.id}')">Delete</button>
            </div>
        `;
    }).join('');
}

// Render gallery
function renderGallery() {
    const pet = pets.find(p => p.id === currentPetId);
    if (!pet) return;

    const photoGallery = document.getElementById('photoGallery');

    if (pet.photos.length === 0) {
        photoGallery.innerHTML = `
            <div class="empty-state">
                <div class="emoji">📸</div>
                <p>No photos added yet</p>
            </div>
        `;
        return;
    }

    photoGallery.innerHTML = pet.photos.map(photo => `
        <div class="photo-item">
            <img src="${photo.data}" alt="Pet photo">
            <button class="photo-delete" onclick="deletePhoto('${photo.id}')">×</button>
        </div>
    `).join('');
}

// Select pet (called from inline onclick)
function selectPet(petId) {
    currentPetId = petId;
    render();
}
