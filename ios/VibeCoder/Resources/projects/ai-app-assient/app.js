// App State
const appState = {
    currentView: 'chat',
    chatHistory: [],
    notes: [],
    tasks: [],
    taskFilter: 'all',
    calculator: {
        display: '0',
        currentValue: 0,
        previousValue: null,
        operation: null,
        shouldResetDisplay: false
    },
    timer: {
        mode: 'timer',
        seconds: 0,
        interval: null,
        isRunning: false
    },
    stopwatch: {
        seconds: 0,
        interval: null,
        isRunning: false,
        laps: []
    },
    converter: {
        type: 'length',
        fromUnit: null,
        toUnit: null
    }
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    loadStateFromStorage();
    initializeMenu();
    initializeChat();
    initializeCalculator();
    initializeNotes();
    initializeTasks();
    initializeTimer();
    initializeConverter();
    displayWelcomeMessage();
});

// Storage Functions
function loadStateFromStorage() {
    const saved = localStorage.getItem('aiAssistantState');
    if (saved) {
        const parsed = JSON.parse(saved);
        appState.chatHistory = parsed.chatHistory || [];
        appState.notes = parsed.notes || [];
        appState.tasks = parsed.tasks || [];
    }
}

function saveStateToStorage() {
    const toSave = {
        chatHistory: appState.chatHistory,
        notes: appState.notes,
        tasks: appState.tasks
    };
    localStorage.setItem('aiAssistantState', JSON.stringify(toSave));
}

// Menu Functions
function initializeMenu() {
    const menuBtn = document.getElementById('menuBtn');
    const closeMenu = document.getElementById('closeMenu');
    const sideMenu = document.getElementById('sideMenu');
    const menuItems = document.querySelectorAll('.menu-item');
    const clearDataBtn = document.getElementById('clearDataBtn');

    menuBtn.addEventListener('click', () => {
        sideMenu.classList.add('open');
    });

    closeMenu.addEventListener('click', () => {
        sideMenu.classList.remove('open');
    });

    menuItems.forEach(item => {
        item.addEventListener('click', () => {
            const view = item.dataset.view;
            switchView(view);
            menuItems.forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            sideMenu.classList.remove('open');
        });
    });

    clearDataBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all data? This cannot be undone.')) {
            localStorage.clear();
            location.reload();
        }
    });
}

function switchView(viewName) {
    appState.currentView = viewName;
    document.querySelectorAll('.view').forEach(view => {
        view.classList.remove('active');
    });
    document.getElementById(`${viewName}View`).classList.add('active');
}

// Chat Functions
function initializeChat() {
    const chatInput = document.getElementById('chatInput');
    const sendBtn = document.getElementById('sendBtn');
    const suggestions = document.querySelectorAll('.suggestion-chip');

    sendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    suggestions.forEach(chip => {
        chip.addEventListener('click', () => {
            chatInput.value = chip.textContent;
            sendMessage();
        });
    });

    renderChatHistory();
}

function displayWelcomeMessage() {
    if (appState.chatHistory.length === 0) {
        addMessage('assistant', 'Hello! I\'m your AI Assistant. I can help you with:\n\n• Calculations and math\n• Unit conversions\n• Taking notes\n• Managing tasks\n• Setting timers\n• And answering questions!\n\nHow can I help you today?');
    }
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();

    if (!message) return;

    addMessage('user', message);
    input.value = '';

    setTimeout(() => {
        const response = generateResponse(message);
        addMessage('assistant', response);
    }, 500);
}

function addMessage(role, content) {
    const timestamp = new Date().toISOString();
    appState.chatHistory.push({ role, content, timestamp });
    saveStateToStorage();
    renderChatHistory();
    scrollChatToBottom();
}

function renderChatHistory() {
    const container = document.getElementById('chatMessages');
    container.innerHTML = '';

    appState.chatHistory.forEach(msg => {
        const div = document.createElement('div');
        div.className = `message ${msg.role}`;
        div.textContent = msg.content;

        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = formatTime(new Date(msg.timestamp));
        div.appendChild(time);

        container.appendChild(div);
    });
}

function scrollChatToBottom() {
    const container = document.getElementById('chatMessages');
    container.scrollTop = container.scrollHeight;
}

function generateResponse(message) {
    const lower = message.toLowerCase();

    // Math calculations
    if (lower.match(/calculate|compute|what is|solve|\+|\-|\*|\/|\d+\s*[\+\-\*\/]\s*\d+/)) {
        return handleMathQuery(message);
    }

    // Unit conversions
    if (lower.match(/convert|km to|miles to|kg to|pounds to|celsius to|fahrenheit to/)) {
        return handleConversionQuery(message);
    }

    // Task management
    if (lower.match(/task|todo|remind me to/)) {
        return "I can help you manage tasks! Click the menu button (☰) and select 'Tasks' to create and manage your to-do list.";
    }

    // Notes
    if (lower.match(/note|write down|remember this/)) {
        return "You can take notes in the Notes section! Click the menu (☰) and select 'Notes' to create and save notes.";
    }

    // Timer
    if (lower.match(/timer|countdown|stopwatch|alarm/)) {
        return "I have a timer and stopwatch! Click the menu (☰) and select 'Timer' to set countdowns or use the stopwatch.";
    }

    // Calculator
    if (lower.match(/calculator/)) {
        return "You can use the calculator! Click the menu (☰) and select 'Calculator' for a full-featured calculator.";
    }

    // Capabilities
    if (lower.match(/what can you do|help|capabilities|features/)) {
        return "I can help you with:\n\n📱 Chat & answer questions\n🔢 Calculator for math\n📝 Notes for saving information\n✓ Task management & to-do lists\n⏱️ Timer & stopwatch\n🔄 Unit conversions (length, weight, temperature, volume)\n\nJust ask me anything or use the menu to access these features!";
    }

    // Time
    if (lower.match(/time|what time|current time/)) {
        const now = new Date();
        return `The current time is ${now.toLocaleTimeString()}.`;
    }

    // Date
    if (lower.match(/date|what day|today/)) {
        const now = new Date();
        return `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`;
    }

    // Greetings
    if (lower.match(/^(hi|hello|hey|greetings)/)) {
        return "Hello! How can I help you today?";
    }

    // Thanks
    if (lower.match(/thank|thanks/)) {
        return "You're welcome! Let me know if you need anything else.";
    }

    // Default response with helpful suggestions
    return "I'm here to help! I can assist with calculations, conversions, notes, tasks, and timers. Try asking me to:\n\n• Calculate something (e.g., 'calculate 25 * 8')\n• Convert units (e.g., 'convert 100 km to miles')\n• Or explore my features using the menu (☰)";
}

function handleMathQuery(query) {
    try {
        // Extract mathematical expression
        const match = query.match(/(\d+\.?\d*)\s*([\+\-\*\/×÷])\s*(\d+\.?\d*)/);
        if (match) {
            const num1 = parseFloat(match[1]);
            const op = match[2];
            const num2 = parseFloat(match[3]);

            let result;
            switch (op) {
                case '+': result = num1 + num2; break;
                case '-': result = num1 - num2; break;
                case '*':
                case '×': result = num1 * num2; break;
                case '/':
                case '÷':
                    if (num2 === 0) return "I can't divide by zero!";
                    result = num1 / num2;
                    break;
            }
            return `${num1} ${op} ${num2} = ${result}`;
        }

        // Try to evaluate simple expressions
        const expr = query.match(/[\d\+\-\*\/\.\(\)]+/);
        if (expr) {
            const sanitized = expr[0].replace(/[^0-9\+\-\*\/\.\(\)]/g, '');
            const result = Function('"use strict"; return (' + sanitized + ')')();
            return `${sanitized} = ${result}`;
        }
    } catch (e) {
        return "I couldn't calculate that. Try using the Calculator from the menu for complex calculations!";
    }

    return "I couldn't understand that calculation. Try something like 'calculate 25 * 8' or use the Calculator from the menu.";
}

function handleConversionQuery(query) {
    const lower = query.toLowerCase();

    // Length conversions
    if (lower.match(/(\d+\.?\d*)\s*km.*miles?/)) {
        const km = parseFloat(lower.match(/(\d+\.?\d*)/)[1]);
        const miles = (km * 0.621371).toFixed(2);
        return `${km} kilometers = ${miles} miles`;
    }
    if (lower.match(/(\d+\.?\d*)\s*miles?.*km/)) {
        const miles = parseFloat(lower.match(/(\d+\.?\d*)/)[1]);
        const km = (miles * 1.60934).toFixed(2);
        return `${miles} miles = ${km} kilometers`;
    }

    // Weight conversions
    if (lower.match(/(\d+\.?\d*)\s*kg.*pounds?/)) {
        const kg = parseFloat(lower.match(/(\d+\.?\d*)/)[1]);
        const lbs = (kg * 2.20462).toFixed(2);
        return `${kg} kilograms = ${lbs} pounds`;
    }
    if (lower.match(/(\d+\.?\d*)\s*pounds?.*kg/)) {
        const lbs = parseFloat(lower.match(/(\d+\.?\d*)/)[1]);
        const kg = (lbs * 0.453592).toFixed(2);
        return `${lbs} pounds = ${kg} kilograms`;
    }

    // Temperature conversions
    if (lower.match(/(\d+\.?\d*)\s*celsius.*fahrenheit/)) {
        const c = parseFloat(lower.match(/(\d+\.?\d*)/)[1]);
        const f = ((c * 9/5) + 32).toFixed(2);
        return `${c}°C = ${f}°F`;
    }
    if (lower.match(/(\d+\.?\d*)\s*fahrenheit.*celsius/)) {
        const f = parseFloat(lower.match(/(\d+\.?\d*)/)[1]);
        const c = ((f - 32) * 5/9).toFixed(2);
        return `${f}°F = ${c}°C`;
    }

    return "Use the Converter from the menu for detailed unit conversions!";
}

function formatTime(date) {
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

// Calculator Functions
function initializeCalculator() {
    const display = document.getElementById('calcDisplay');
    const buttons = document.querySelectorAll('.calc-btn');

    buttons.forEach(button => {
        button.addEventListener('click', () => {
            if (button.dataset.number !== undefined) {
                handleNumber(button.dataset.number);
            } else if (button.dataset.action) {
                handleAction(button.dataset.action);
            }
            updateCalculatorDisplay();
        });
    });
}

function handleNumber(num) {
    const calc = appState.calculator;

    if (calc.shouldResetDisplay) {
        calc.display = num;
        calc.shouldResetDisplay = false;
    } else {
        calc.display = calc.display === '0' ? num : calc.display + num;
    }
}

function handleAction(action) {
    const calc = appState.calculator;
    const current = parseFloat(calc.display);

    switch (action) {
        case 'clear':
            calc.display = '0';
            calc.currentValue = 0;
            calc.previousValue = null;
            calc.operation = null;
            break;

        case 'backspace':
            calc.display = calc.display.length > 1 ? calc.display.slice(0, -1) : '0';
            break;

        case 'decimal':
            if (!calc.display.includes('.')) {
                calc.display += '.';
            }
            break;

        case 'percent':
            calc.display = String(current / 100);
            break;

        case 'add':
        case 'subtract':
        case 'multiply':
        case 'divide':
            if (calc.operation && calc.previousValue !== null && !calc.shouldResetDisplay) {
                performCalculation();
            }
            calc.previousValue = current;
            calc.operation = action;
            calc.shouldResetDisplay = true;
            break;

        case 'equals':
            performCalculation();
            calc.operation = null;
            calc.previousValue = null;
            break;
    }
}

function performCalculation() {
    const calc = appState.calculator;
    const current = parseFloat(calc.display);
    const previous = calc.previousValue;

    if (previous === null || !calc.operation) return;

    let result;
    switch (calc.operation) {
        case 'add': result = previous + current; break;
        case 'subtract': result = previous - current; break;
        case 'multiply': result = previous * current; break;
        case 'divide': result = current !== 0 ? previous / current : 0; break;
    }

    calc.display = String(result);
    calc.currentValue = result;
    calc.shouldResetDisplay = true;
}

function updateCalculatorDisplay() {
    document.getElementById('calcDisplay').textContent = appState.calculator.display;
}

// Notes Functions
function initializeNotes() {
    const saveBtn = document.getElementById('saveNoteBtn');
    const addNoteBtn = document.getElementById('addNoteBtn');

    saveBtn.addEventListener('click', saveNote);
    addNoteBtn.addEventListener('click', clearNoteEditor);

    renderNotes();
}

function saveNote() {
    const title = document.getElementById('noteTitle').value.trim();
    const content = document.getElementById('noteContent').value.trim();

    if (!title && !content) return;

    const note = {
        id: Date.now(),
        title: title || 'Untitled Note',
        content: content,
        timestamp: new Date().toISOString()
    };

    appState.notes.unshift(note);
    saveStateToStorage();
    renderNotes();
    clearNoteEditor();
}

function clearNoteEditor() {
    document.getElementById('noteTitle').value = '';
    document.getElementById('noteContent').value = '';
}

function renderNotes() {
    const container = document.getElementById('notesList');
    container.innerHTML = '';

    if (appState.notes.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">No notes yet. Create your first note above!</p>';
        return;
    }

    appState.notes.forEach(note => {
        const div = document.createElement('div');
        div.className = 'note-item';

        div.innerHTML = `
            <div class="note-item-header">
                <div class="note-item-title">${escapeHtml(note.title)}</div>
                <div class="note-item-actions">
                    <button class="note-btn edit" onclick="editNote(${note.id})">Edit</button>
                    <button class="note-btn delete" onclick="deleteNote(${note.id})">Delete</button>
                </div>
            </div>
            <div class="note-item-content">${escapeHtml(note.content)}</div>
            <div class="note-item-date">${new Date(note.timestamp).toLocaleString()}</div>
        `;

        container.appendChild(div);
    });
}

function editNote(id) {
    const note = appState.notes.find(n => n.id === id);
    if (note) {
        document.getElementById('noteTitle').value = note.title;
        document.getElementById('noteContent').value = note.content;
        deleteNote(id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function deleteNote(id) {
    appState.notes = appState.notes.filter(n => n.id !== id);
    saveStateToStorage();
    renderNotes();
}

// Tasks Functions
function initializeTasks() {
    const addBtn = document.getElementById('addTaskBtn');
    const input = document.getElementById('taskInput');
    const filterBtns = document.querySelectorAll('.filter-btn');

    addBtn.addEventListener('click', addTask);
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addTask();
    });

    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            appState.taskFilter = btn.dataset.filter;
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTasks();
        });
    });

    renderTasks();
}

function addTask() {
    const input = document.getElementById('taskInput');
    const text = input.value.trim();

    if (!text) return;

    const task = {
        id: Date.now(),
        text: text,
        completed: false,
        timestamp: new Date().toISOString()
    };

    appState.tasks.push(task);
    saveStateToStorage();
    input.value = '';
    renderTasks();
}

function toggleTask(id) {
    const task = appState.tasks.find(t => t.id === id);
    if (task) {
        task.completed = !task.completed;
        saveStateToStorage();
        renderTasks();
    }
}

function deleteTask(id) {
    appState.tasks = appState.tasks.filter(t => t.id !== id);
    saveStateToStorage();
    renderTasks();
}

function renderTasks() {
    const container = document.getElementById('tasksList');
    const statsContainer = document.getElementById('tasksStats');

    let filtered = appState.tasks;
    if (appState.taskFilter === 'active') {
        filtered = appState.tasks.filter(t => !t.completed);
    } else if (appState.taskFilter === 'completed') {
        filtered = appState.tasks.filter(t => t.completed);
    }

    container.innerHTML = '';

    if (filtered.length === 0) {
        const msg = appState.taskFilter === 'completed' ? 'No completed tasks' : 'No tasks yet';
        container.innerHTML = `<p style="text-align: center; color: var(--text-secondary); padding: 2rem;">${msg}</p>`;
    } else {
        filtered.forEach(task => {
            const div = document.createElement('div');
            div.className = `task-item ${task.completed ? 'completed' : ''}`;

            div.innerHTML = `
                <input type="checkbox" class="task-checkbox" ${task.completed ? 'checked' : ''} onchange="toggleTask(${task.id})">
                <span class="task-text">${escapeHtml(task.text)}</span>
                <button class="task-delete" onclick="deleteTask(${task.id})">✕</button>
            `;

            container.appendChild(div);
        });
    }

    // Update stats
    const total = appState.tasks.length;
    const completed = appState.tasks.filter(t => t.completed).length;
    const active = total - completed;

    statsContainer.textContent = `${total} total • ${active} active • ${completed} completed`;
}

// Timer Functions
function initializeTimer() {
    const timerTabs = document.querySelectorAll('.timer-tab');
    const startTimerBtn = document.getElementById('startTimerBtn');
    const resetTimerBtn = document.getElementById('resetTimerBtn');
    const startStopwatchBtn = document.getElementById('startStopwatchBtn');
    const resetStopwatchBtn = document.getElementById('resetStopwatchBtn');
    const lapBtn = document.getElementById('lapBtn');

    timerTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            timerTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.timer-mode').forEach(m => m.classList.remove('active'));
            document.getElementById(`${mode}Mode`).classList.add('active');
        });
    });

    startTimerBtn.addEventListener('click', toggleTimer);
    resetTimerBtn.addEventListener('click', resetTimer);
    startStopwatchBtn.addEventListener('click', toggleStopwatch);
    resetStopwatchBtn.addEventListener('click', resetStopwatch);
    lapBtn.addEventListener('click', addLap);
}

function toggleTimer() {
    const btn = document.getElementById('startTimerBtn');

    if (appState.timer.isRunning) {
        clearInterval(appState.timer.interval);
        appState.timer.isRunning = false;
        btn.textContent = 'Start';
    } else {
        // Get input values
        const hours = parseInt(document.getElementById('hoursInput').value) || 0;
        const minutes = parseInt(document.getElementById('minutesInput').value) || 0;
        const seconds = parseInt(document.getElementById('secondsInput').value) || 0;

        if (!appState.timer.isRunning && appState.timer.seconds === 0) {
            appState.timer.seconds = (hours * 3600) + (minutes * 60) + seconds;
        }

        if (appState.timer.seconds === 0) return;

        appState.timer.isRunning = true;
        btn.textContent = 'Pause';

        appState.timer.interval = setInterval(() => {
            appState.timer.seconds--;
            updateTimerDisplay();

            if (appState.timer.seconds <= 0) {
                clearInterval(appState.timer.interval);
                appState.timer.isRunning = false;
                btn.textContent = 'Start';
                alert('Timer finished!');
            }
        }, 1000);
    }
}

function resetTimer() {
    clearInterval(appState.timer.interval);
    appState.timer.seconds = 0;
    appState.timer.isRunning = false;
    document.getElementById('startTimerBtn').textContent = 'Start';
    document.getElementById('hoursInput').value = 0;
    document.getElementById('minutesInput').value = 0;
    document.getElementById('secondsInput').value = 0;
    updateTimerDisplay();
}

function updateTimerDisplay() {
    const display = document.getElementById('timerDisplay');
    display.textContent = formatSeconds(appState.timer.seconds);
}

function toggleStopwatch() {
    const btn = document.getElementById('startStopwatchBtn');

    if (appState.stopwatch.isRunning) {
        clearInterval(appState.stopwatch.interval);
        appState.stopwatch.isRunning = false;
        btn.textContent = 'Start';
    } else {
        appState.stopwatch.isRunning = true;
        btn.textContent = 'Pause';

        appState.stopwatch.interval = setInterval(() => {
            appState.stopwatch.seconds++;
            updateStopwatchDisplay();
        }, 1000);
    }
}

function resetStopwatch() {
    clearInterval(appState.stopwatch.interval);
    appState.stopwatch.seconds = 0;
    appState.stopwatch.isRunning = false;
    appState.stopwatch.laps = [];
    document.getElementById('startStopwatchBtn').textContent = 'Start';
    updateStopwatchDisplay();
    renderLaps();
}

function updateStopwatchDisplay() {
    const display = document.getElementById('stopwatchDisplay');
    display.textContent = formatSeconds(appState.stopwatch.seconds);
}

function addLap() {
    if (appState.stopwatch.isRunning || appState.stopwatch.seconds > 0) {
        appState.stopwatch.laps.push(appState.stopwatch.seconds);
        renderLaps();
    }
}

function renderLaps() {
    const container = document.getElementById('lapsList');
    container.innerHTML = '';

    appState.stopwatch.laps.forEach((lap, index) => {
        const div = document.createElement('div');
        div.className = 'lap-item';
        div.innerHTML = `
            <span>Lap ${appState.stopwatch.laps.length - index}</span>
            <span>${formatSeconds(lap)}</span>
        `;
        container.appendChild(div);
    });
}

function formatSeconds(totalSeconds) {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Converter Functions
const conversionData = {
    length: {
        units: ['Meters', 'Kilometers', 'Miles', 'Feet', 'Inches', 'Centimeters'],
        toBase: {
            'Meters': 1,
            'Kilometers': 1000,
            'Miles': 1609.34,
            'Feet': 0.3048,
            'Inches': 0.0254,
            'Centimeters': 0.01
        }
    },
    weight: {
        units: ['Kilograms', 'Grams', 'Pounds', 'Ounces', 'Tons'],
        toBase: {
            'Kilograms': 1,
            'Grams': 0.001,
            'Pounds': 0.453592,
            'Ounces': 0.0283495,
            'Tons': 1000
        }
    },
    temperature: {
        units: ['Celsius', 'Fahrenheit', 'Kelvin'],
        convert: (value, from, to) => {
            let celsius;
            if (from === 'Celsius') celsius = value;
            else if (from === 'Fahrenheit') celsius = (value - 32) * 5/9;
            else celsius = value - 273.15;

            if (to === 'Celsius') return celsius;
            if (to === 'Fahrenheit') return (celsius * 9/5) + 32;
            return celsius + 273.15;
        }
    },
    volume: {
        units: ['Liters', 'Milliliters', 'Gallons', 'Cups', 'Fluid Ounces'],
        toBase: {
            'Liters': 1,
            'Milliliters': 0.001,
            'Gallons': 3.78541,
            'Cups': 0.236588,
            'Fluid Ounces': 0.0295735
        }
    }
};

function initializeConverter() {
    const typeTabs = document.querySelectorAll('.converter-tab');
    const fromValue = document.getElementById('fromValue');
    const swapBtn = document.getElementById('swapBtn');

    typeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const type = tab.dataset.type;
            appState.converter.type = type;
            typeTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            updateConverterUnits();
        });
    });

    fromValue.addEventListener('input', performConversion);
    document.getElementById('fromUnit').addEventListener('change', performConversion);
    document.getElementById('toUnit').addEventListener('change', performConversion);

    swapBtn.addEventListener('click', () => {
        const fromSelect = document.getElementById('fromUnit');
        const toSelect = document.getElementById('toUnit');
        const temp = fromSelect.value;
        fromSelect.value = toSelect.value;
        toSelect.value = temp;
        performConversion();
    });

    updateConverterUnits();
}

function updateConverterUnits() {
    const type = appState.converter.type;
    const data = conversionData[type];
    const fromSelect = document.getElementById('fromUnit');
    const toSelect = document.getElementById('toUnit');

    fromSelect.innerHTML = '';
    toSelect.innerHTML = '';

    data.units.forEach(unit => {
        fromSelect.add(new Option(unit, unit));
        toSelect.add(new Option(unit, unit));
    });

    if (data.units.length > 1) {
        toSelect.selectedIndex = 1;
    }

    performConversion();
}

function performConversion() {
    const type = appState.converter.type;
    const data = conversionData[type];
    const fromValue = parseFloat(document.getElementById('fromValue').value) || 0;
    const fromUnit = document.getElementById('fromUnit').value;
    const toUnit = document.getElementById('toUnit').value;

    let result;

    if (type === 'temperature') {
        result = data.convert(fromValue, fromUnit, toUnit);
    } else {
        const baseValue = fromValue * data.toBase[fromUnit];
        result = baseValue / data.toBase[toUnit];
    }

    document.getElementById('toValue').value = result.toFixed(4);
}

// Utility function
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
